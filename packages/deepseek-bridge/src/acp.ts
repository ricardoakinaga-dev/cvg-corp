import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import {
  client as createAcpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type InitializeResponse,
  type PromptResponse,
  type SessionNotification
} from "@agentclientprotocol/sdk";
import {
  id,
  type AiApproval,
  type AiDraft,
  type AiSession,
  type AiTurn,
  type AiTurnInput,
  type CvgContext,
  type OpaqueId
} from "@cvg/contracts";
import type { AgentDraftPromotion } from "@cvg/agent-runtime";
import {
  DeepSeekBridgeError,
  type DeepSeekNativeApprovalRequest,
  type DeepSeekNativeBaseRequest,
  type DeepSeekNativeHarnessPort,
  type DeepSeekNativePromotionRequest,
  type DeepSeekNativeReplayRequest,
  type DeepSeekNativeSessionRequest,
  type DeepSeekNativeTurnRequest
} from "./index.ts";
import { replayDigest } from "@cvg/agent-runtime";

const execFileAsync = promisify(execFile);
const ACP_AGENT_NAME = "deepseek-harness-acp";
const DEFAULT_MODEL = "deepseek-acp";
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_SESSION_QUEUE_DEPTH = 8;
const MAX_OUTPUT_CHUNKS = 4_096;
const MAX_OUTPUT_CHARS = 1_000_000;

export interface DeepSeekAcpNativeHarnessPortConfig {
  /** Executable is passed directly to spawn; no shell is ever used. */
  command: string;
  args: readonly string[];
  /** Git worktree whose HEAD is attested as the engine commit. */
  engineRoot: string;
  /** Workspace supplied to ACP session/new. */
  workspaceRoot: string;
  /** Exact profile manifest whose bytes are hashed for the profile digest. */
  manifestPath: string;
  environment?: Readonly<Record<string, string | undefined>>;
  expectedAgentName?: string;
  expectedAgentVersion?: string;
  modelName?: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  /**
   * CVG authority for tools, approvals and durable AI records. The ACP
   * process never receives authority directly; it only produces model output
   * after this boundary has authorized the exact request.
   */
  governance?: DeepSeekAcpGovernance;
}

export interface DeepSeekAcpTurnAuthorization {
  disposition: "ALLOW" | "DENY" | "APPROVAL_REQUIRED";
  /** A pending/denied result is already persisted by the governance layer. */
  result?: DeepSeekAcpGovernedTurn;
}

export interface DeepSeekAcpGovernedTurn {
  session: AiSession;
  turn: AiTurn;
  draft: AiDraft | null;
  approval: AiApproval | null;
}

export interface DeepSeekAcpReplay {
  session: AiSession;
  turns: AiTurn[];
  digest: string;
}

export interface DeepSeekAcpGovernance {
  /** Exact canonical catalog exposed to the native process. */
  readonly toolNames: readonly string[];
  createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): Promise<AiSession>;
  /** Reloads a durable CVG session after the ACP child process is restarted. */
  loadSession(context: CvgContext, sessionId: OpaqueId): Promise<AiSession | null>;
  authorizeTurn(context: CvgContext, session: AiSession, input: AiTurnInput, approvalId: OpaqueId | null): Promise<DeepSeekAcpTurnAuthorization>;
  recordTurn(context: CvgContext, session: AiSession, input: AiTurnInput, outcome: { status: "COMPLETED" | "DENIED" | "OUTCOME_UNKNOWN"; response: string | null; model: string; inputTokens: number; outputTokens: number; correlationId: string; reason?: string }): Promise<DeepSeekAcpGovernedTurn>;
  approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval>;
  promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion>;
  replay(context: CvgContext, sessionId: OpaqueId): Promise<DeepSeekAcpReplay>;
}

interface AcpSessionRecord {
  readonly session: AiSession;
  readonly acpSessionId: string;
  lastUsage: { inputTokens: number; outputTokens: number };
}

interface SessionOutput {
  chunks: string[];
  chunkChars: number;
  toolCallObserved: boolean;
  outputLimitExceeded: boolean;
}

interface AttestedFacts {
  engineCommit: string;
  manifestVersion: string;
  agentName: string;
  agentVersion: string;
  reason: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function profileDigest(content: string): string {
  return `sha256:${digest(content)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => sortedJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pathConfig(value: string, label: string): string {
  const normalized = resolve(value.trim());
  if (!isAbsolute(normalized)) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", `${label} ACP deve ser absoluto.`);
  return normalized;
}

function safeDependencyMessage(error: unknown): string {
  if (error instanceof DeepSeekBridgeError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return "DeepSeek Harness ACP indisponível.";
}

function stopReasonStatus(stopReason: PromptResponse["stopReason"]): "COMPLETED" | "DENIED" | "OUTCOME_UNKNOWN" {
  if (stopReason === "refusal") return "DENIED";
  if (stopReason === "end_turn") return "COMPLETED";
  return "OUTCOME_UNKNOWN";
}

function toolNamesFromManifest(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.dsh) || !isRecord(value.dsh.profile) || !Array.isArray(value.dsh.profile.bundles)) return [];
  return value.dsh.profile.bundles.filter((entry): entry is string => typeof entry === "string").sort();
}

export async function readAcpManifestVersion(manifestPath: string): Promise<string> {
  const content = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(content);
  const bundles = toolNamesFromManifest(parsed);
  if (!bundles.includes("@deepseek-ai/dsh-acp-app")) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O manifesto ACP não declara o bundle @deepseek-ai/dsh-acp-app.");
  return profileDigest(content);
}

async function gitHead(engineRoot: string): Promise<string> {
  const result = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: engineRoot, timeout: 3_000, maxBuffer: 1_024 });
  const commit = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O engine ACP não forneceu um git commit verificável.");
  return commit;
}

function parseArgsJson(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 64 || parsed.some((entry) => typeof entry !== "string" || entry.length > 2_000)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function environmentString(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function childEnvironment(overrides: Readonly<Record<string, string | undefined>> | undefined): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "NODE_ENV", "TERM", "TZ",
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
    "DSH_HOME", "DSH_AGENTS_HOME", "DSH_PERMISSION_MODE", "DSH_TELEMETRY_DISABLED", "NO_COLOR"
  ];
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name];
  }
  return { ...inherited, ...overrides };
}

/**
 * Builds the real ACP port only from a complete, explicit deployment contract.
 * Missing or malformed configuration returns undefined so the bridge remains
 * unavailable and never guesses a command, cwd, workspace or credential path.
 */
export function createAcpNativeHarnessPortFromEnvironment(environment: NodeJS.ProcessEnv = process.env, governance?: DeepSeekAcpGovernance): DeepSeekNativeHarnessPort | undefined {
  const command = environmentString(environment, "CVG_DEEPSEEK_ACP_COMMAND");
  const engineRoot = environmentString(environment, "CVG_DEEPSEEK_ACP_ENGINE_ROOT");
  const workspaceRoot = environmentString(environment, "CVG_DEEPSEEK_ACP_WORKSPACE_ROOT");
  const manifestPath = environmentString(environment, "CVG_DEEPSEEK_ACP_MANIFEST_PATH");
  const expectedCommit = environmentString(environment, "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT");
  const expectedManifest = environmentString(environment, "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION");
  const expectedAgentVersion = environmentString(environment, "CVG_DEEPSEEK_ACP_EXPECTED_AGENT_VERSION");
  const args = parseArgsJson(environment.CVG_DEEPSEEK_ACP_ARGS_JSON);
  if (!command || !engineRoot || !workspaceRoot || !manifestPath || !expectedCommit || !expectedManifest || !args) return undefined;
  const permissionMode = environmentString(environment, "CVG_DEEPSEEK_ACP_PERMISSION_MODE") ?? "read-only";
  if (permissionMode !== "read-only") return undefined;
  const dshHome = environmentString(environment, "CVG_DEEPSEEK_ACP_DSH_HOME");
  return new DeepSeekAcpNativeHarnessPort({
    command,
    args,
    engineRoot,
    workspaceRoot,
    manifestPath,
    expectedAgentName: environmentString(environment, "CVG_DEEPSEEK_ACP_EXPECTED_AGENT_NAME") ?? ACP_AGENT_NAME,
    modelName: environmentString(environment, "CVG_DEEPSEEK_ACP_MODEL") ?? DEFAULT_MODEL,
    startupTimeoutMs: Number(environment.CVG_DEEPSEEK_ACP_STARTUP_TIMEOUT_MS) || DEFAULT_STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs: Number(environment.CVG_DEEPSEEK_ACP_SHUTDOWN_TIMEOUT_MS) || DEFAULT_SHUTDOWN_TIMEOUT_MS,
    ...(expectedAgentVersion ? { expectedAgentVersion } : {}),
    ...(governance ? { governance } : {}),
    environment: {
      ...(dshHome ? { DSH_HOME: dshHome } : {}),
      DSH_PERMISSION_MODE: permissionMode
    }
  });
}

export class DeepSeekAcpNativeHarnessPort implements DeepSeekNativeHarnessPort {
  private readonly config: Required<Pick<DeepSeekAcpNativeHarnessPortConfig, "command" | "args" | "engineRoot" | "workspaceRoot" | "manifestPath" | "expectedAgentName" | "modelName" | "startupTimeoutMs" | "shutdownTimeoutMs">> & DeepSeekAcpNativeHarnessPortConfig;
  private child: ChildProcessWithoutNullStreams | undefined;
  private connection: ClientConnection | undefined;
  private initialized: InitializeResponse | undefined;
  private startInFlight: Promise<InitializeResponse> | undefined;
  private shuttingDown = false;
  private readonly sessions = new Map<string, AcpSessionRecord>();
  private readonly outputs = new Map<string, SessionOutput>();
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private readonly sessionQueueDepth = new Map<string, number>();

  constructor(config: DeepSeekAcpNativeHarnessPortConfig) {
    if (!config.command.trim() || !config.args || !config.expectedAgentName?.trim() || !config.modelName?.trim()) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Configuração ACP incompleta.");
    this.config = {
      ...config,
      args: [...config.args],
      engineRoot: pathConfig(config.engineRoot, "engineRoot"),
      workspaceRoot: pathConfig(config.workspaceRoot, "workspaceRoot"),
      manifestPath: pathConfig(config.manifestPath, "manifestPath"),
      expectedAgentName: config.expectedAgentName ?? ACP_AGENT_NAME,
      modelName: config.modelName ?? DEFAULT_MODEL,
      startupTimeoutMs: config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      shutdownTimeoutMs: config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
    };
    if (this.config.startupTimeoutMs < 100 || this.config.startupTimeoutMs > 120_000 || this.config.shutdownTimeoutMs < 100 || this.config.shutdownTimeoutMs > 30_000) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Deadline ACP fora do intervalo permitido.");
  }

  async health(request: DeepSeekNativeBaseRequest): Promise<unknown> {
    if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Health ACP cancelado.");
    try {
      await this.ensureConnection(request.signal);
      const facts = await this.attest();
      return {
        status: facts.reason ? "UNAVAILABLE" : "READY",
        engineCommit: facts.engineCommit,
        manifestVersion: facts.manifestVersion,
        tools: this.config.governance ? [...this.config.governance.toolNames] : [],
        supports: { cancellation: true, approvals: Boolean(this.config.governance), replay: Boolean(this.config.governance), provenance: true },
        ...(facts.reason ? { reason: facts.reason } : {})
      };
    } catch (error) {
      if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Health ACP cancelado.");
      const reason = safeDependencyMessage(error);
      return {
        status: "UNAVAILABLE",
        engineCommit: "unavailable",
        manifestVersion: "unavailable",
        tools: this.config.governance ? [...this.config.governance.toolNames] : [],
        supports: { cancellation: true, approvals: Boolean(this.config.governance), replay: Boolean(this.config.governance), provenance: true },
        reason
      };
    }
  }

  async createSession(request: DeepSeekNativeSessionRequest): Promise<unknown> {
    await this.requireReady(request.signal);
    const response = await this.connection!.agent.request(methods.agent.session.new, { cwd: this.config.workspaceRoot, mcpServers: [] }, { cancellationSignal: request.signal });
    const facts = await this.attest();
    const session = this.config.governance
      ? await this.config.governance.createSession(request.context, request.input)
      : {
          id: id(randomUUID()),
          organizationId: request.context.organizationId,
          actorId: request.context.actorId,
          unitId: request.context.unitId,
          workspaceId: request.context.workspaceId,
          patientId: request.input.patientId,
          encounterId: request.input.encounterId,
          purpose: request.input.purpose,
          engineCommit: facts.engineCommit,
          profileDigest: facts.manifestVersion,
          status: "ACTIVE" as const,
          createdAt: nowIso()
        };
    if (session.organizationId !== request.context.organizationId || session.actorId !== request.context.actorId || session.unitId !== request.context.unitId || session.workspaceId !== request.context.workspaceId || session.patientId !== request.input.patientId || session.encounterId !== request.input.encounterId || session.purpose !== request.input.purpose || session.engineCommit !== facts.engineCommit || session.profileDigest !== facts.manifestVersion || session.status !== "ACTIVE") {
      throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A governança ACP retornou uma sessão fora do contexto ou do profile atestado.");
    }
    this.sessions.set(session.id, { session, acpSessionId: response.sessionId, lastUsage: { inputTokens: 0, outputTokens: 0 } });
    this.outputs.set(response.sessionId, this.newSessionOutput());
    return session;
  }

  async executeTurn(request: DeepSeekNativeTurnRequest): Promise<unknown> {
    if (!this.config.governance) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Turn ACP bloqueado: nenhum boundary de governança CVG foi injetado.");
    await this.requireReady(request.signal);
    const session = await this.resolveOrCreateSession(request);
    await this.assertSessionAttestation(session.session);
    const authorization = await this.config.governance.authorizeTurn(request.context, session.session, request.input, request.approvalId ?? request.input.approvalId);
    if (authorization.disposition !== "ALLOW") {
      if (!authorization.result) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A governança ACP negou o turno sem registrar um resultado vinculável.");
      return this.wireGovernedResult(authorization.result, request.context.policyRevision, request.correlationId);
    }
    return this.executeTurnOnce(request, session);
  }

  async approve(request: DeepSeekNativeApprovalRequest): Promise<unknown> {
    if (!this.config.governance) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Approval ACP bloqueado: nenhum boundary de governança CVG foi injetado.");
    await this.requireReady(request.signal);
    const approval = await this.config.governance.approve(request.context, request.approvalId, request.decision, request.reason);
    if (approval.id !== request.approvalId || approval.organizationId !== request.context.organizationId || approval.actorId !== request.context.actorId || approval.decidedBy !== request.context.actorId || approval.decision !== request.decision || approval.reason !== request.reason || approval.policyRevision !== request.context.policyRevision || approval.unitId !== request.context.unitId || approval.workspaceId !== request.context.workspaceId || approval.patientId !== request.context.patientId || approval.encounterId !== request.context.encounterId || approval.purpose !== request.context.purpose) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A governança ACP retornou uma aprovação fora do contexto decidido.");
    return approval;
  }

  async promoteDraft(request: DeepSeekNativePromotionRequest): Promise<unknown> {
    if (!this.config.governance) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Promoção ACP bloqueada: nenhum boundary de governança CVG foi injetado.");
    await this.requireReady(request.signal);
    const promotion = await this.config.governance.promoteDraft(request.context, request.draftId);
    if (promotion.draft.id !== request.draftId || promotion.draft.status !== "PROMOTED") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A promoção ACP retornou um draft fora do contexto solicitado.");
    return promotion;
  }

  async replay(request: DeepSeekNativeReplayRequest): Promise<unknown> {
    if (!this.config.governance) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Replay ACP bloqueado: nenhum ledger de governança CVG foi injetado.");
    await this.requireReady(request.signal);
    const replay = await this.config.governance.replay(request.context, request.sessionId);
    const facts = await this.attest();
    if (facts.reason) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", facts.reason);
    if (replay.session.id !== request.sessionId || replay.session.organizationId !== request.context.organizationId || replay.session.actorId !== request.context.actorId || replay.session.unitId !== request.context.unitId || replay.session.workspaceId !== request.context.workspaceId || replay.session.engineCommit !== facts.engineCommit || replay.session.profileDigest !== facts.manifestVersion || replay.turns.some((turn) => turn.sessionId !== request.sessionId) || replay.digest !== replayDigest(replay.session, replay.turns)) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O replay ACP retornou registros fora da sessão, do profile atestado ou do digest canônico.");
    return {
      session: replay.session,
      turns: replay.turns,
      digest: replay.digest,
      provenance: {
        adapterId: "deepseek-harness-acp",
        provider: "deepseek",
        engineCommit: facts.engineCommit,
        manifestVersion: facts.manifestVersion,
        toolNames: [...this.config.governance.toolNames],
        supports: { cancellation: true, approvals: true, replay: true, provenance: true }
      }
    };
  }

  async shutdown(request: DeepSeekNativeBaseRequest): Promise<unknown> {
    if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Shutdown ACP cancelado.");
    this.shuttingDown = true;
    const connection = this.connection;
    const child = this.child;
    this.connection = undefined;
    this.initialized = undefined;
    this.child = undefined;
    if (connection) connection.close();
    if (child) await this.terminate(child);
    this.sessions.clear();
    this.outputs.clear();
    this.sessionLocks.clear();
    this.sessionQueueDepth.clear();
    return undefined;
  }

  private async executeTurnOnce(request: DeepSeekNativeTurnRequest, knownSession?: AcpSessionRecord): Promise<unknown> {
    await this.requireReady(request.signal);
    if (!this.config.governance) throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Turn ACP bloqueado: nenhum boundary de governança CVG foi injetado.");
    const governance = this.config.governance;
    const session = knownSession ?? await this.resolveOrCreateSession(request);
    return this.withSessionLock(session.session.id, async () => {
      const output = this.outputs.get(session.acpSessionId);
      if (!output) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "Sessão ACP perdeu seu canal de saída.", true);
      output.chunks = [];
      output.chunkChars = 0;
      output.toolCallObserved = false;
      output.outputLimitExceeded = false;
      let promptResponse: PromptResponse | undefined;
      let promptFailed = false;
      try {
        promptResponse = await this.connection!.agent.request(methods.agent.session.prompt, {
          sessionId: session.acpSessionId,
          prompt: [{ type: "text", text: request.input.prompt }]
        }, { cancellationSignal: request.signal });
        if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Turn ACP cancelado.");
      } catch (error) {
        if (request.signal.aborted) {
          const cancelledResponse = output.chunks.join("") || null;
          const cancelledUsage = this.turnUsage(session, promptResponse);
          await governance.recordTurn(request.context, session.session, request.input, { status: "OUTCOME_UNKNOWN", response: cancelledResponse, model: this.config.modelName, inputTokens: cancelledUsage.inputTokens, outputTokens: cancelledUsage.outputTokens, correlationId: request.correlationId, reason: "ACP_PROMPT_CANCELLED" });
          throw error;
        }
        promptFailed = true;
        // A rejected prompt can leave the ACP transport half-open. Detach
        // that generation before any later call can reuse its session ID;
        // the next turn will reload the durable CVG session and create a new
        // native binding.
        await this.abortConnection();
      }
      const response = output.chunks.join("") || null;
      const usage = this.turnUsage(session, promptResponse);
      const toolCallObserved = output.toolCallObserved;
      const outputLimitExceeded = output.outputLimitExceeded;
      const usageUnavailable = !usage.available;
      const status = promptFailed || toolCallObserved || outputLimitExceeded || usageUnavailable ? "OUTCOME_UNKNOWN" : stopReasonStatus(promptResponse!.stopReason);
      const reason = promptFailed
        ? "ACP_PROMPT_OUTCOME_UNKNOWN"
        : toolCallObserved
          ? "ACP_TOOL_CALL_WITHOUT_CVG_EXECUTOR"
          : outputLimitExceeded
            ? "ACP_OUTPUT_LIMIT_EXCEEDED"
            : usageUnavailable
              ? usage.reason ?? "ACP_USAGE_UNAVAILABLE"
              : undefined;
      const governed = await governance.recordTurn(request.context, session.session, request.input, { status, response, model: this.config.modelName, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, correlationId: request.correlationId, ...(reason ? { reason } : {}) });
      if (governed.turn.status !== status) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A governança ACP retornou um estado de turno diferente do resultado observado.");
      const failedGenerationFacts = promptFailed
        ? { engineCommit: session.session.engineCommit, manifestVersion: session.session.profileDigest }
        : undefined;
      return this.wireGovernedResult(governed, request.context.policyRevision, request.correlationId, failedGenerationFacts);
    });
  }

  private async resolveOrCreateSession(request: DeepSeekNativeTurnRequest): Promise<AcpSessionRecord> {
    if (request.input.sessionId) {
      const existing = this.sessions.get(request.input.sessionId);
      if (existing) {
        this.assertSessionContext(existing.session, request.context, request.input);
        return existing;
      }
      if (!this.config.governance) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "A sessão ACP solicitada não existe neste processo.", true);
      const durable = await this.config.governance.loadSession(request.context, request.input.sessionId);
      if (!durable) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "A sessão CVG solicitada não existe no ledger durável.", true);
      this.assertSessionContext(durable, request.context, request.input);
      await this.assertSessionAttestation(durable);
      const response = await this.connection!.agent.request(methods.agent.session.new, { cwd: this.config.workspaceRoot, mcpServers: [] }, { cancellationSignal: request.signal });
      const record: AcpSessionRecord = { session: durable, acpSessionId: response.sessionId, lastUsage: { inputTokens: 0, outputTokens: 0 } };
      this.sessions.set(durable.id, record);
      this.outputs.set(response.sessionId, this.newSessionOutput());
      return record;
    }
    const created = await this.createSession({
      correlationId: request.correlationId,
      signal: request.signal,
      context: request.context,
      input: request.input
    });
    const session = created as AiSession;
    const record = this.sessions.get(session.id);
    if (!record) throw new DeepSeekBridgeError("INVALID_RESPONSE", "O adapter ACP perdeu a sessão recém-criada.");
    return record;
  }

  private async wireGovernedResult(result: DeepSeekAcpGovernedTurn, policyRevision: string, correlationId: string, generationFacts?: Pick<AttestedFacts, "engineCommit" | "manifestVersion">): Promise<unknown> {
    const facts = generationFacts ? { ...generationFacts, reason: null } : await this.attest();
    if (facts.reason) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", facts.reason);
    if (result.session.engineCommit !== facts.engineCommit || result.session.profileDigest !== facts.manifestVersion || result.turn.sessionId !== result.session.id || result.turn.provenance?.provider !== "deepseek" || result.turn.provenance?.engineCommit !== facts.engineCommit || result.turn.provenance?.manifestVersion !== facts.manifestVersion || result.turn.provenance?.policyRevision !== policyRevision || result.turn.provenance?.correlationId !== correlationId) {
      throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O resultado persistido pela governança ACP não está vinculado ao profile, policy ou correlation atual.");
    }
    return {
      session: result.session,
      turn: result.turn,
      draft: result.draft,
      approval: result.approval,
      provenance: {
        provider: "deepseek",
        engineCommit: facts.engineCommit,
        manifestVersion: facts.manifestVersion,
        profileDigest: facts.manifestVersion,
        policyRevision,
        references: result.turn.references,
        correlationId
      }
    };
  }

  private assertSessionContext(session: AiSession, context: CvgContext, input: AiTurnInput): void {
    if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId || session.purpose !== input.purpose || session.patientId !== input.patientId || session.encounterId !== input.encounterId || session.status !== "ACTIVE") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão ACP escapou do contexto autenticado.");
  }

  private async assertSessionAttestation(session: AiSession): Promise<void> {
    const facts = await this.attest();
    if (facts.reason || session.engineCommit !== facts.engineCommit || session.profileDigest !== facts.manifestVersion) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão ACP não corresponde ao engine ou profile atualmente atestado.");
  }

  private turnUsage(session: AcpSessionRecord, response: PromptResponse | undefined): { inputTokens: number; outputTokens: number; available: boolean; reason?: string } {
    const usage = response?.usage;
    if (!usage || !Number.isInteger(usage.totalTokens) || !Number.isInteger(usage.inputTokens) || !Number.isInteger(usage.outputTokens) || usage.totalTokens < 0 || usage.inputTokens < 0 || usage.outputTokens < 0 || usage.totalTokens < usage.inputTokens + usage.outputTokens) return { inputTokens: 0, outputTokens: 0, available: false, reason: "ACP_USAGE_UNAVAILABLE" };
    if (usage.inputTokens < session.lastUsage.inputTokens || usage.outputTokens < session.lastUsage.outputTokens) return { inputTokens: 0, outputTokens: 0, available: false, reason: "ACP_USAGE_COUNTER_REGRESSION" };
    const inputTokens = usage.inputTokens - session.lastUsage.inputTokens;
    const outputTokens = usage.outputTokens - session.lastUsage.outputTokens;
    session.lastUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    if (inputTokens + outputTokens <= 0) return { inputTokens: 0, outputTokens: 0, available: false, reason: "ACP_USAGE_ZERO" };
    return { inputTokens, outputTokens, available: true };
  }

  private async requireReady(signal: AbortSignal): Promise<void> {
    const health = await this.health({ correlationId: "acp-health", signal });
    if (!isRecord(health) || health.status !== "READY") {
      const reason = isRecord(health) && typeof health.reason === "string" ? health.reason : "DeepSeek Harness ACP indisponível.";
      throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", reason, true);
    }
  }

  private async attest(): Promise<AttestedFacts> {
    const initialized = this.initialized;
    if (!initialized) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "ACP ainda não foi inicializado.", true);
    const engineCommit = await gitHead(this.config.engineRoot);
    const content = await readFile(this.config.manifestPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    const bundles = toolNamesFromManifest(parsed);
    if (!bundles.includes("@deepseek-ai/dsh-acp-app")) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "O manifesto ACP não declara o bundle @deepseek-ai/dsh-acp-app.");
    const manifestVersion = profileDigest(content);
    const agentName = initialized.agentInfo?.name ?? "";
    const agentVersion = initialized.agentInfo?.version ?? "";
    let reason: string | null = null;
    if (agentName !== this.config.expectedAgentName) reason = "O nome do agente ACP não corresponde ao esperado.";
    else if (this.config.expectedAgentVersion && agentVersion !== this.config.expectedAgentVersion) reason = "A versão do agente ACP não corresponde ao esperado.";
    return { engineCommit, manifestVersion, agentName, agentVersion, reason };
  }

  private async ensureConnection(signal: AbortSignal): Promise<InitializeResponse> {
    if (signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Inicialização ACP cancelada.");
    if (this.initialized && this.connection && this.child && this.child.exitCode === null && !this.shuttingDown) return this.initialized;
    if (this.child && (this.child.exitCode !== null || this.child.signalCode !== null)) {
      // Detach the dead generation before starting its replacement.  The
      // old ACP close callback must never be allowed to clear the new
      // connection's attestation or session bindings.
      this.connection = undefined;
      this.initialized = undefined;
      this.child = undefined;
      this.clearTransientBindings();
    }
    if (this.startInFlight) return this.awaitAbort(this.startInFlight, signal);
    this.shuttingDown = false;
    const operation = this.startConnection();
    this.startInFlight = operation;
    try {
      return await this.awaitAbort(operation, signal);
    } catch (error) {
      if (signal.aborted) await this.abortConnection();
      throw error;
    } finally {
      if (this.startInFlight === operation) this.startInFlight = undefined;
    }
  }

  private async abortConnection(): Promise<void> {
    const connection = this.connection;
    const child = this.child;
    this.connection = undefined;
    this.initialized = undefined;
    this.child = undefined;
    if (connection) connection.close();
    if (child) await this.terminate(child);
    this.clearTransientBindings();
  }

  private async startConnection(): Promise<InitializeResponse> {
    const child = spawn(this.config.command, [...this.config.args], {
      cwd: this.config.engineRoot,
      env: childEnvironment(this.config.environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child = child;
    // Drain stderr so a noisy child cannot deadlock on a full pipe. Never
    // expose it: Harness stderr may contain paths, provider details or secrets.
    child.stderr.on("data", () => undefined);
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    );
    const app = createAcpClient({ name: "cvg-deepseek-bridge" })
      .onRequest(methods.client.session.requestPermission, () => Promise.resolve({ outcome: { outcome: "cancelled" } }))
      .onNotification(methods.client.session.update, ({ params }) => {
        this.captureUpdate(params);
        return Promise.resolve();
      });
    const connection = app.connect(stream);
    this.connection = connection;
    void connection.closed.then(() => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.initialized = undefined;
        this.clearTransientBindings();
      }
    }, () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.initialized = undefined;
        this.clearTransientBindings();
      }
    });
    try {
      const initialized = await this.withDeadline(connection.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }), this.config.startupTimeoutMs);
      this.initialized = initialized;
      return initialized;
    } catch (error) {
      connection.close(error);
      await this.terminate(child);
      throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", `Falha ao inicializar ACP: ${safeDependencyMessage(error)}`, true);
    }
  }

  private captureUpdate(notification: SessionNotification): void {
    const output = this.outputs.get(notification.sessionId);
    if (!output) return;
    const update = notification.update;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      if (output.chunks.length >= MAX_OUTPUT_CHUNKS || output.chunkChars + update.content.text.length > MAX_OUTPUT_CHARS) output.outputLimitExceeded = true;
      else {
        output.chunks.push(update.content.text);
        output.chunkChars += update.content.text.length;
      }
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") output.toolCallObserved = true;
  }

  private newSessionOutput(): SessionOutput {
    return { chunks: [], chunkChars: 0, toolCallObserved: false, outputLimitExceeded: false };
  }

  private clearTransientBindings(): void {
    this.sessions.clear();
    this.outputs.clear();
    this.sessionLocks.clear();
    this.sessionQueueDepth.clear();
  }

  private async withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const depth = this.sessionQueueDepth.get(sessionId) ?? 0;
    if (depth >= MAX_SESSION_QUEUE_DEPTH) throw new DeepSeekBridgeError("DEPENDENCY_UNAVAILABLE", "A fila ACP por sessão atingiu o limite seguro.", true);
    this.sessionQueueDepth.set(sessionId, depth + 1);
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionLocks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.sessionLocks.get(sessionId) === current) this.sessionLocks.delete(sessionId);
      const remaining = (this.sessionQueueDepth.get(sessionId) ?? 1) - 1;
      if (remaining > 0) this.sessionQueueDepth.set(sessionId, remaining);
      else this.sessionQueueDepth.delete(sessionId);
    }
  }

  private async awaitAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Operação ACP cancelada.");
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const onAbort = () => rejectPromise(new DeepSeekBridgeError("CANCELLED", "Operação ACP cancelada."));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(value);
      }, (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        rejectPromise(error);
      });
    });
  }

  private async withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolvePromise, rejectPromise) => {
          timer = setTimeout(() => rejectPromise(new DeepSeekBridgeError("TIMEOUT", "Inicialização ACP excedeu o deadline.", true)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, this.config.shutdownTimeoutMs))
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
