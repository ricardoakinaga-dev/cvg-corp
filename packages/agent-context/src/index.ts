import { createHash } from "node:crypto";
import type { DataClass } from "@cvg/contracts";

/**
 * Governed Context Builder.  It decides WHAT reaches the model: every item
 * carries a trust level, a data class and a priority, and untrusted content is
 * emitted as delimited data that can never become policy, grant permissions,
 * enable tools, approve actions or reach secrets.
 */

export const CONTEXT_BUILDER_VERSION = "agent-context/1.0.0";

export type TrustLevel =
  | "SYSTEM_TRUSTED"
  | "CVG_TRUSTED"
  | "USER_SUPPLIED"
  | "RETRIEVED_UNTRUSTED"
  | "EXTERNAL_UNTRUSTED"
  | "TOOL_RESULT";

export const TRUST_LEVELS: readonly TrustLevel[] = ["SYSTEM_TRUSTED", "CVG_TRUSTED", "USER_SUPPLIED", "RETRIEVED_UNTRUSTED", "EXTERNAL_UNTRUSTED", "TOOL_RESULT"];

export const CONTEXT_PRIORITY = {
  SYSTEM_POLICY: 1_000,
  ACTIVE_TASK: 900,
  CRITICAL_BUSINESS: 800,
  TOOL_CONTRACTS: 700,
  RECENT_CONVERSATION: 600,
  RETRIEVAL: 500,
  HISTORICAL: 400
} as const;

export type ContextPriority = (typeof CONTEXT_PRIORITY)[keyof typeof CONTEXT_PRIORITY];

export interface ContextProvenance {
  source: string;
  owner: string;
  version: string | null;
  digest: string;
  retrievedAt: string | null;
}

export interface ContextItem {
  id: string;
  /** Stable label such as system.policy, agent.profile, task.state, retrieval.document. */
  kind: string;
  trust: TrustLevel;
  priority: ContextPriority;
  content: string;
  dataClass: DataClass;
  tokens: number;
  provenance: ContextProvenance;
}

export interface ContextToolContract {
  name: string;
  version: string;
  description: string;
  risk: "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT";
  inputSchemaDigest: string;
}

export interface ContextBuildRequest {
  systemInstructions: string;
  agentProfile: { name: string; version: string; digest: string; instructions: string; allowedTools: readonly string[]; allowedDataClasses: readonly DataClass[]; allowedSkills: readonly string[] };
  actor: { actorId: string; roles: readonly string[]; organizationId: string; unitId: string | null; workspaceId: string | null; purpose: string };
  task: { objective: string; state: string; completedObjectives: readonly string[]; pendingObjectives: readonly string[] };
  toolContracts: readonly ContextToolContract[];
  conversation: readonly { role: "user" | "assistant" | "tool"; content: string; turn: number; dataClass?: DataClass }[];
  retrieval: readonly ContextItem[];
  criticalBusinessContext: readonly ContextItem[];
  tokenBudget: number;
  maxUntrustedItems: number;
}

export type ContextFirewallCode =
  | "INSTRUCTION_OVERRIDE"
  | "SYSTEM_PROMPT_PROBE"
  | "TOOL_ENABLEMENT_ATTEMPT"
  | "APPROVAL_SYNTHESIS_ATTEMPT"
  | "PERMISSION_ESCALATION"
  | "SECRET_MATERIAL"
  | "CROSS_TENANT_REFERENCE"
  | "DISALLOWED_DATA_CLASS"
  | "UNTRUSTED_AS_POLICY";

export interface ContextFirewallFinding {
  code: ContextFirewallCode;
  itemId: string;
  source: string;
  trust: TrustLevel;
  detail: string;
}

export interface ModelContextItem {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  trust: TrustLevel;
  kind: string;
  tokens: number;
  /** Data class actually present in this item; drives provider data-policy routing. */
  dataClass: DataClass;
}

export interface ModelContext {
  systemInstructions: string;
  items: readonly ModelContextItem[];
  toolContracts: readonly ContextToolContract[];
  tokens: {
    system: number;
    task: number;
    business: number;
    tools: number;
    conversation: number;
    retrieval: number;
    historical: number;
    total: number;
    budget: number;
  };
  digest: string;
  sanitized: boolean;
  quarantined: readonly { itemId: string; reason: ContextFirewallCode }[];
  findings: readonly ContextFirewallFinding[];
  retrievalReferences: readonly { title: string; source: string; digest: string }[];
}

/** Deterministic, dependency-free token estimate (conservative). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const SECRET_PATTERNS: readonly { code: ContextFirewallCode; pattern: RegExp; detail: string }[] = [
  { code: "INSTRUCTION_OVERRIDE", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i, detail: "instruction override attempt" },
  { code: "INSTRUCTION_OVERRIDE", pattern: /desconsidere\s+(todas\s+)?(as\s+)?instru[cç][õo]es\s+(anteriores|acima)/i, detail: "tentativa de sobrescrever instruções" },
  { code: "SYSTEM_PROMPT_PROBE", pattern: /(reveal|print|show|repeat)\s+(the\s+)?(system\s*prompt|hidden\s*instructions|developer\s*message)/i, detail: "system prompt probe" },
  { code: "TOOL_ENABLEMENT_ATTEMPT", pattern: /(enable|unlock|grant|activate)\s+(the\s+)?(tool|capability|function)\b/i, detail: "tool enablement attempt" },
  { code: "APPROVAL_SYNTHESIS_ATTEMPT", pattern: /(approve|authorize)\s+(this|the)\s+(action|request|operation)\b/i, detail: "approval synthesis attempt" },
  { code: "PERMISSION_ESCALATION", pattern: /(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(an?\s+)?(admin|administrator|root|superuser)/i, detail: "role escalation attempt" },
  { code: "SECRET_MATERIAL", pattern: /(api[_-]?key|secret|password|bearer\s+token)\s*[:=]\s*\S{6,}/i, detail: "secret-like material" }
];

/**
 * Structural prompt firewall.  Regex is only a signal for quarantine and audit;
 * the structural guarantee is that untrusted content is emitted as delimited
 * data (see `renderUntrusted`) and can never populate trusted sections.
 */
export function inspectUntrustedContent(content: string, item: Pick<ContextItem, "id" | "provenance" | "trust">): ContextFirewallFinding[] {
  const findings: ContextFirewallFinding[] = [];
  for (const candidate of SECRET_PATTERNS) {
    if (candidate.pattern.test(content)) {
      findings.push({ code: candidate.code, itemId: item.id, source: item.provenance.source, trust: item.trust, detail: candidate.detail });
    }
  }
  return findings;
}

export function renderUntrusted(item: ContextItem): string {
  return [`[UNTRUSTED_DATA id=${item.id} trust=${item.trust} source=${item.provenance.source} digest=${item.provenance.digest}]`, item.content, "[/UNTRUSTED_DATA]"].join("\n");
}

export interface KnowledgeDocumentGovernance {
  id: string;
  title: string;
  source: string;
  owner: string;
  classification: DataClass;
  scope: { organizationId: string; unitId: string | null; workspaceId: string | null };
  version: number;
  digest: string;
  approvalStatus: "DRAFT" | "APPROVED" | "QUARANTINED";
  reviewDate: string | null;
}

export class KnowledgeGovernor {
  private readonly documents = new Map<string, KnowledgeDocumentGovernance>();

  register(document: KnowledgeDocumentGovernance): KnowledgeDocumentGovernance {
    if (!/^[a-f0-9]{64}$/.test(document.digest)) throw new Error("knowledge document requires a sha-256 digest");
    this.documents.set(document.id, document);
    return document;
  }

  approve(id: string, reviewDate: string): KnowledgeDocumentGovernance {
    const document = this.require(id);
    const approved: KnowledgeDocumentGovernance = { ...document, approvalStatus: "APPROVED", reviewDate };
    this.documents.set(id, approved);
    return approved;
  }

  quarantine(id: string): KnowledgeDocumentGovernance {
    const document = this.require(id);
    const quarantined: KnowledgeDocumentGovernance = { ...document, approvalStatus: "QUARANTINED" };
    this.documents.set(id, quarantined);
    return quarantined;
  }

  select(input: { organizationId: string; unitId: string | null; workspaceId: string | null; allowedDataClasses: readonly DataClass[]; limit: number }): KnowledgeDocumentGovernance[] {
    return [...this.documents.values()]
      .filter((document) => document.approvalStatus === "APPROVED")
      .filter((document) => document.scope.organizationId === input.organizationId)
      .filter((document) => document.scope.unitId === null || document.scope.unitId === input.unitId)
      .filter((document) => document.scope.workspaceId === null || document.scope.workspaceId === input.workspaceId)
      .filter((document) => input.allowedDataClasses.includes(document.classification))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, input.limit);
  }

  get(id: string): KnowledgeDocumentGovernance | null {
    return this.documents.get(id) ?? null;
  }

  private require(id: string): KnowledgeDocumentGovernance {
    const document = this.documents.get(id);
    if (!document) throw new Error(`knowledge document not found: ${id}`);
    return document;
  }
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function contextDigest(items: readonly ModelContextItem[], systemInstructions: string, toolContracts: readonly ContextToolContract[]): string {
  const canonical = {
    systemInstructions,
    items: items.map((item) => ({ role: item.role, kind: item.kind, trust: item.trust, digest: sha256Hex(item.content) })),
    tools: toolContracts.map((tool) => `${tool.name}@${tool.version}:${tool.inputSchemaDigest}`).sort()
  };
  return sha256Hex(JSON.stringify(canonical));
}

export interface ContextBuilderOptions {
  clock?: { now(): number };
  maxUntrustedItems?: number;
}

export class ContextBuilder {
  constructor(private readonly options: ContextBuilderOptions = {}) {}

  build(request: ContextBuildRequest): ModelContext {
    const findings: ContextFirewallFinding[] = [];
    const quarantined: { itemId: string; reason: ContextFirewallCode }[] = [];
    const allowedDataClasses = request.agentProfile.allowedDataClasses;
    let sanitized = false;

    const systemTokens = estimateTokens(request.systemInstructions) + estimateTokens(request.agentProfile.instructions);
    const taskTokens = estimateTokens(`${request.task.objective}\n${request.task.state}\n${request.task.pendingObjectives.join("\n")}`);
    const toolTokens = request.toolContracts.reduce((total, tool) => total + estimateTokens(`${tool.name} ${tool.description}`), 0);

    const evaluate = (item: ContextItem, kind: string): ModelContextItem | null => {
      if (!allowedDataClasses.includes(item.dataClass)) {
        findings.push({ code: "DISALLOWED_DATA_CLASS", itemId: item.id, source: item.provenance.source, trust: item.trust, detail: `data class ${item.dataClass} is not allowed for ${request.agentProfile.name}` });
        quarantined.push({ itemId: item.id, reason: "DISALLOWED_DATA_CLASS" });
        sanitized = true;
        return null;
      }
      if (item.trust === "RETRIEVED_UNTRUSTED" || item.trust === "EXTERNAL_UNTRUSTED" || item.trust === "TOOL_RESULT" || item.trust === "USER_SUPPLIED") {
        const itemFindings = inspectUntrustedContent(item.content, item);
        if (itemFindings.length > 0) {
          findings.push(...itemFindings);
          sanitized = true;
          if (item.trust !== "TOOL_RESULT") {
            quarantined.push({ itemId: item.id, reason: itemFindings[0]!.code });
            return null;
          }
        }
        return { role: "user", content: renderUntrusted(item), trust: item.trust, kind, tokens: item.tokens, dataClass: item.dataClass };
      }
      return { role: "user", content: item.content, trust: item.trust, kind, tokens: item.tokens, dataClass: item.dataClass };
    };

    const items: ModelContextItem[] = [];
    const budget = Math.max(0, request.tokenBudget);
    let used = systemTokens + taskTokens + toolTokens;
    items.push({ role: "system", content: request.systemInstructions, trust: "SYSTEM_TRUSTED", kind: "system.instructions", tokens: estimateTokens(request.systemInstructions), dataClass: "D0" });
    items.push({ role: "system", content: request.agentProfile.instructions, trust: "SYSTEM_TRUSTED", kind: "agent.profile", tokens: estimateTokens(request.agentProfile.instructions), dataClass: "D0" });
    items.push({ role: "user", content: `[TASK]\n${request.task.objective}\n[STATE]\n${request.task.state}`, trust: "CVG_TRUSTED", kind: "task.state", tokens: taskTokens, dataClass: "D0" });
    for (const contract of request.toolContracts) {
      items.push({ role: "system", content: `[TOOL] ${contract.name}@${contract.version} risk=${contract.risk} ${contract.description}`, trust: "CVG_TRUSTED", kind: "tool.contract", tokens: estimateTokens(contract.name + contract.description), dataClass: "D0" });
    }

    let businessTokens = 0;
    for (const item of [...request.criticalBusinessContext].sort(byPriority)) {
      if (used + item.tokens > budget) break;
      const evaluated = evaluate(item, "business.context");
      if (!evaluated) continue;
      items.push(evaluated);
      used += item.tokens;
      businessTokens += item.tokens;
    }

    let conversationTokens = 0;
    for (const message of [...request.conversation].slice(-12)) {
      const tokens = estimateTokens(message.content);
      if (used + tokens > budget) break;
      // Conversation and tool history are untrusted data: assistant/tool
      // content is delimited and inspected exactly like retrieval, so an
      // indirect injection carried by a tool result cannot become policy.
      const trust: TrustLevel = message.role === "user" ? "USER_SUPPLIED" : "TOOL_RESULT";
      const historyItem: ContextItem = {
        id: `conversation:${message.turn}:${message.role}`,
        kind: "conversation",
        trust,
        priority: CONTEXT_PRIORITY.RECENT_CONVERSATION,
        content: message.content,
        dataClass: message.dataClass ?? "D2",
        tokens,
        provenance: { source: `conversation.turn.${message.turn}`, owner: "CVG session", version: null, digest: sha256Hex(`${message.turn}:${message.role}:${message.content}`), retrievedAt: null }
      };
      const evaluated = evaluate(historyItem, "conversation");
      if (!evaluated) continue;
      items.push(evaluated);
      used += tokens;
      conversationTokens += tokens;
    }

    let retrievalTokens = 0;
    const retrievalReferences: { title: string; source: string; digest: string }[] = [];
    const maxUntrusted = this.options.maxUntrustedItems ?? request.maxUntrustedItems;
    let untrustedCount = 0;
    for (const item of [...request.retrieval].sort(byPriority)) {
      if (untrustedCount >= maxUntrusted) break;
      if (used + item.tokens > budget) break;
      const evaluated = evaluate(item, "retrieval.document");
      if (!evaluated) continue;
      items.push(evaluated);
      used += item.tokens;
      retrievalTokens += item.tokens;
      untrustedCount += 1;
      retrievalReferences.push({ title: item.kind, source: item.provenance.source, digest: item.provenance.digest });
    }

    const totals = {
      system: systemTokens,
      task: taskTokens,
      business: businessTokens,
      tools: toolTokens,
      conversation: conversationTokens,
      retrieval: retrievalTokens,
      historical: 0,
      total: used,
      budget
    };

    return {
      systemInstructions: request.systemInstructions,
      items,
      toolContracts: request.toolContracts,
      tokens: totals,
      digest: contextDigest(items, request.systemInstructions, request.toolContracts),
      sanitized,
      quarantined,
      findings,
      retrievalReferences
    };
  }
}

function byPriority(a: ContextItem, b: ContextItem): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface CompactionInput {
  messages: readonly { role: "user" | "assistant" | "tool"; content: string; turn: number }[];
  keepRecent: number;
  tokenBudget: number;
}

export interface CompactionResult {
  messages: readonly { role: "user" | "assistant" | "tool"; content: string; turn: number }[];
  summary: { text: string; provenance: { kind: "DETERMINISTIC_COMPACTION"; firstTurn: number; lastTurn: number; replacedMessages: number; digest: string; at: string } } | null;
}

/**
 * Deterministic, extractive compaction.  It never invents clinical content and
 * never replaces governed records; the summary is derived metadata with
 * provenance that the UI can distinguish from recorded facts.
 */
export function compactConversation(input: CompactionInput, at = new Date().toISOString()): CompactionResult {
  const keep = Math.max(0, input.keepRecent);
  if (input.messages.length <= keep) return { messages: input.messages, summary: null };
  const older = input.messages.slice(0, input.messages.length - keep);
  const recent = input.messages.slice(input.messages.length - keep);
  const digest = sha256Hex(older.map((message) => `${message.turn}:${message.role}:${sha256Hex(message.content)}`).join("|"));
  const summaryText = `[COMPACTION older messages=${older.length} firstTurn=${older[0]!.turn} lastTurn=${older.at(-1)!.turn} digest=${digest}]`;
  const tokens = estimateTokens(summaryText);
  const kept = tokens <= input.tokenBudget ? [{ role: "user" as const, content: summaryText, turn: older[0]!.turn }, ...recent] : recent;
  return {
    messages: kept,
    summary: {
      text: summaryText,
      provenance: { kind: "DETERMINISTIC_COMPACTION", firstTurn: older[0]!.turn, lastTurn: older.at(-1)!.turn, replacedMessages: older.length, digest, at }
    }
  };
}

/**
 * Data minimization: reduces a business object to the minimal field projection
 * before it can reach the model.  Unknown fields are dropped, never passed through.
 */
export function projectMinimalFields<T extends Record<string, unknown>>(value: T, allowedFields: readonly (keyof T & string)[]): Partial<T> {
  const projection: Partial<T> = {};
  for (const field of allowedFields) {
    if (field in value) projection[field] = value[field];
  }
  return projection;
}

export interface DataProjectionRule {
  resource: string;
  purpose: string;
  allowedFields: readonly string[];
}

export const DEFAULT_DATA_PROJECTIONS: readonly DataProjectionRule[] = [
  { resource: "patient", purpose: "OPERATIONS", allowedFields: ["id", "name", "species", "unitId"] },
  { resource: "patient", purpose: "SUMMARY", allowedFields: ["id", "name", "species", "unitId"] },
  { resource: "appointment", purpose: "OPERATIONS", allowedFields: ["id", "startsAt", "status", "patientId", "unitId"] },
  { resource: "guardian", purpose: "OPERATIONS", allowedFields: ["id", "displayName", "phone"] }
];

export function projectionFor(resource: string, purpose: string): readonly string[] | null {
  return DEFAULT_DATA_PROJECTIONS.find((rule) => rule.resource === resource && rule.purpose === purpose)?.allowedFields ?? null;
}
