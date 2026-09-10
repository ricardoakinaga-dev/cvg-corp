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
  type AiSession,
  type AiTurnInput,
  type CvgContext,
  type OpaqueId
} from "@cvg/contracts";
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

const execFileAsync = promisify(execFile);
const ACP_AGENT_NAME = "deepseek-harness-acp";
const DEFAULT_MODEL = "deepseek-acp";
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;

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
}

interface AcpSessionRecord {
  readonly session: AiSession;
  readonly acpSessionId: string;
  lastUsage: { inputTokens: number; outputTokens: number };
}

interface SessionOutput {
  chunks: string[];
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
export function createAcpNativeHarnessPortFromEnvironment(environment: NodeJS.ProcessEnv = process.env): DeepSeekNativeHarnessPort | undefined {
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
  private readonly idempotency = new Map<string, { fingerprint: string; result: unknown }>();
  private readonly idempotencyInFlight = new Map<string, Promise<unknown>>();

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
        tools: [],
        supports: { cancellation: true, approvals: false, replay: false, provenance: true },
        ...(facts.reason ? { reason: facts.reason } : {})
      };
    } catch (error) {
      if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Health ACP cancelado.");
      const reason = safeDependencyMessage(error);
      return {
        status: "UNAVAILABLE",
        engineCommit: "unavailable",
        manifestVersion: "unavailable",
        tools: [],
        supports: { cancellation: true, approvals: false, replay: false, provenance: true },
        reason
      };
    }
  }

  async createSession(request: DeepSeekNativeSessionRequest): Promise<unknown> {
    await this.requireReady(request.signal);
    const response = await this.connection!.agent.request(methods.agent.session.new, { cwd: this.config.workspaceRoot, mcpServers: [] }, { cancellationSignal: request.signal });
    const facts = await this.attest();
    const session: AiSession = {
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
      status: "ACTIVE",
      createdAt: nowIso()
    };
    this.sessions.set(session.id, { session, acpSessionId: response.sessionId, lastUsage: { inputTokens: 0, outputTokens: 0 } });
    this.outputs.set(response.sessionId, { chunks: [] });
    return session;
  }

  async executeTurn(request: DeepSeekNativeTurnRequest): Promise<unknown> {
    void request;
    throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "Turn ACP bloqueado: o ToolGateway CVG ainda não governa tools, approval, replay, provenance e egress.");
  }

  async approve(_request: DeepSeekNativeApprovalRequest): Promise<unknown> {
    throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "ACP está em default-deny: a ponte de aprovação CVG ainda não está implementada.");
  }

  async promoteDraft(_request: DeepSeekNativePromotionRequest): Promise<unknown> {
    throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "ACP não expõe promoção de draft no contrato atual.");
  }

  async replay(_request: DeepSeekNativeReplayRequest): Promise<unknown> {
    throw new DeepSeekBridgeError("CAPABILITY_DISABLED", "ACP não expõe replay auditável no contrato atual.");
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
    return undefined;
  }

  private async executeTurnOnce(request: DeepSeekNativeTurnRequest): Promise<unknown> {
    await this.requireReady(request.signal);
    if (request.approvalId || request.input.approvalId || request.input.requestedTool) {
      const session = await this.resolveOrCreateSession(request);
      return this.wireResult(session, request.input, request.context.policyRevision, request.correlationId, "DENIED", null, 0, 0);
    }
    const session = await this.resolveOrCreateSession(request);
    return this.withSessionLock(session.session.id, async () => {
      const output = this.outputs.get(session.acpSessionId);
      if (!output) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "Sessão ACP perdeu seu canal de saída.", true);
      const start = output.chunks.length;
      let promptResponse: PromptResponse | undefined;
      let promptFailed = false;
      try {
        promptResponse = await this.connection!.agent.request(methods.agent.session.prompt, {
          sessionId: session.acpSessionId,
          prompt: [{ type: "text", text: request.input.prompt }]
        }, { cancellationSignal: request.signal });
        if (request.signal.aborted) throw new DeepSeekBridgeError("CANCELLED", "Turn ACP cancelado.");
      } catch (error) {
        if (request.signal.aborted) throw error;
        promptFailed = true;
      }
      const response = output.chunks.slice(start).join("") || null;
      const usage = this.turnUsage(session, promptResponse);
      const status = promptFailed ? "OUTCOME_UNKNOWN" : stopReasonStatus(promptResponse!.stopReason);
      return this.wireResult(session, request.input, request.context.policyRevision, request.correlationId, status, response, usage.inputTokens, usage.outputTokens);
    });
  }

  private async resolveOrCreateSession(request: DeepSeekNativeTurnRequest): Promise<AcpSessionRecord> {
    if (request.input.sessionId) {
      const existing = this.sessions.get(request.input.sessionId);
      if (!existing) throw new DeepSeekBridgeError("NATIVE_UNAVAILABLE", "A sessão ACP solicitada não existe neste processo.", true);
      this.assertSessionContext(existing.session, request.context, request.input);
      return existing;
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

  private assertSessionContext(session: AiSession, context: CvgContext, input: AiTurnInput): void {
    if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId || session.purpose !== input.purpose || session.patientId !== input.patientId || session.encounterId !== input.encounterId || session.status !== "ACTIVE") throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "A sessão ACP escapou do contexto autenticado.");
  }

  private async wireResult(session: AcpSessionRecord, input: AiTurnInput, policyRevision: string, correlationId: string, status: "COMPLETED" | "DENIED" | "OUTCOME_UNKNOWN", response: string | null, inputTokens: number, outputTokens: number): Promise<unknown> {
    const facts = await this.attest();
    if (facts.reason) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", facts.reason);
    const turnId = id(randomUUID());
    return {
      session: session.session,
      turn: {
        id: turnId,
        sessionId: session.session.id,
        prompt: input.prompt,
        response,
        status,
        model: this.config.modelName,
        inputTokens,
        outputTokens,
        references: [],
        createdAt: nowIso()
      },
      draft: null,
      approval: null,
      provenance: {
        provider: "deepseek",
        engineCommit: facts.engineCommit,
        manifestVersion: facts.manifestVersion,
        profileDigest: facts.manifestVersion,
        policyRevision,
        references: [],
        correlationId
      }
    };
  }

  private turnUsage(session: AcpSessionRecord, response: PromptResponse | undefined): { inputTokens: number; outputTokens: number } {
    const usage = response?.usage;
    if (!usage) return { inputTokens: 0, outputTokens: 0 };
    const inputTokens = Math.max(0, usage.inputTokens - session.lastUsage.inputTokens);
    const outputTokens = Math.max(0, usage.outputTokens - session.lastUsage.outputTokens);
    session.lastUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    return { inputTokens, outputTokens };
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
      }
    }, () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.initialized = undefined;
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
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") output.chunks.push(update.content.text);
  }

  private async withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionLocks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.sessionLocks.get(sessionId) === current) this.sessionLocks.delete(sessionId);
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
