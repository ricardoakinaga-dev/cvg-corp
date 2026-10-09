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

interface ContentSignal {
  code: ContextFirewallCode;
  pattern: RegExp;
  detail: string;
  accepts?: (match: RegExpExecArray) => boolean;
}

function hasProseCredentialShape(value: string): boolean {
  // Sentence punctuation, ordinary hyphenation, title case and all-caps words
  // alone are not evidence of a supplied credential. Internal case changes,
  // digits and other symbols are signals, not proof that a value is a secret.
  return /\p{N}/u.test(value) || /[^\p{L}\p{N}.-]/u.test(value) || /\p{Ll}\p{Lu}/u.test(value);
}

function trimProseSentencePunctuation(value: string): string {
  // Inspect the suffix once. An unanchored /[.!?:]+$/ can retry from every
  // punctuation position when a long run is followed by a nonmatching letter.
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 46 && code !== 33 && code !== 63 && code !== 58) break;
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

function proseContainsValue(match: RegExpExecArray): boolean {
  // Quoted values keep the explicit-value signal. Unquoted plain words and
  // all-letter passphrases are deliberately outside this heuristic; source
  // redaction must protect them. Do not replace this policy with a word list.
  if (match[1]) return true;
  const raw = match[2]!;
  const value = trimProseSentencePunctuation(raw);
  if (value.length >= 6 && hasProseCredentialShape(value)) return true;
  // Peek at one adjoining fragment for values such as "abc 12345", without
  // consuming it: a following password clause must remain searchable. Never
  // scan the rest of a sentence looking for unrelated numbers or symbols.
  const next = match[3] === undefined ? undefined : trimProseSentencePunctuation(match[3]);
  return raw === value && /^\p{L}+$/u.test(value) && next !== undefined
    && value.length + next.length >= 6 && hasProseCredentialShape(next);
}

function pwdContainsCredential(match: RegExpExecArray): boolean {
  const start = match.input.lastIndexOf("\n", match.index - 1) + 1;
  const end = match.input.indexOf("\n", match.index);
  const line = match.input.slice(start, end < 0 ? undefined : end).trim();
  // Only a standalone terminal-directory line is exempt. JSON, assignments,
  // prose, and other credential signals in the same input are still inspected.
  return !/^pwd:[ \t]*(?:\/|~\/|[a-z]:[\\/])[^\s"'<>|]*$/i.test(line);
}

function basicContainsCredential(match: RegExpExecArray): boolean {
  const decoded = Buffer.from(match[1]!, "base64");
  return decoded.includes(58) && decoded.every((byte) => byte >= 32 && byte !== 127);
}

function credentialUrlHasScheme(match: RegExpExecArray): boolean {
  // Search the literal :// first, then inspect its preceding scheme once.
  // Starting an unbounded scheme regex at every word boundary made a-a-a-
  // near-misses quadratic. Slashes delimit both this lookback and userinfo
  // candidates, so later delimiters do not rescan the same growing suffix.
  for (let index = match.index - 1; index >= 0; index -= 1) {
    const character = match.input[index]!;
    if (!/[a-z0-9+.-]/i.test(character)) return false;
    if (/[a-z]/i.test(character) && (index === 0 || !/[a-z0-9_]/i.test(match.input[index - 1]!))) return true;
  }
  return false;
}

function matchesSignal(content: string, signal: ContentSignal): boolean {
  if (!signal.accepts) return signal.pattern.test(content);
  // Each search owns its cursor; ignoring one benign occurrence must not hide
  // another credential later in the same text or affect a subsequent call.
  const pattern = new RegExp(signal.pattern.source, `${signal.pattern.flags}g`);
  for (const match of content.matchAll(pattern)) {
    if (signal.accepts(match)) return true;
  }
  return false;
}

const SECRET_PATTERNS: readonly ContentSignal[] = [
  { code: "INSTRUCTION_OVERRIDE", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)/i, detail: "instruction override attempt" },
  { code: "INSTRUCTION_OVERRIDE", pattern: /desconsidere\s+(todas\s+)?(as\s+)?instru[cç][õo]es\s+(anteriores|acima)/i, detail: "tentativa de sobrescrever instruções" },
  { code: "SYSTEM_PROMPT_PROBE", pattern: /(reveal|print|show|repeat)\s+(the\s+)?(system\s*prompt|hidden\s*instructions|developer\s*message)/i, detail: "system prompt probe" },
  { code: "TOOL_ENABLEMENT_ATTEMPT", pattern: /(enable|unlock|grant|activate)\s+(the\s+)?(tool|capability|function)\b/i, detail: "tool enablement attempt" },
  { code: "APPROVAL_SYNTHESIS_ATTEMPT", pattern: /(approve|authorize)\s+(this|the)\s+(action|request|operation)\b/i, detail: "approval synthesis attempt" },
  { code: "PERMISSION_ESCALATION", pattern: /(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(an?\s+)?(admin|administrator|root|superuser)/i, detail: "role escalation attempt" },
  // Cover common pasted credential formats at both admission and context assembly.
  // Findings describe the signal, never the matched value. This remains heuristic
  // and does not replace data minimization and secret redaction at the source.
  // Preserve prefixed field names and partial pastes; closing quotes are not required.
  { code: "SECRET_MATERIAL", pattern: /(?:api[_-]?key|secret[_-]?access[_-]?key|(?:client[_-]?)?secret|segredo|password|passwd|senha|(?:(?:access|refresh|auth|id)[_-]?)?token|private[_-]?key|bearer\s+token)["']?\s*[:=]\s*(?:"[^"\r\n]{6,}|'[^'\r\n]{6,}|[^\s"'`,;{}[\]]{6,})/i, detail: "credential assignment" },
  { code: "SECRET_MATERIAL", pattern: /pwd["']?\s*[:=]\s*(?:"[^"\r\n]{6,}|'[^'\r\n]{6,}|[^\s"'`,;{}[\]]{6,})/i, accepts: pwdContainsCredential, detail: "password shorthand assignment" },
  // Consume only the introducer. Candidate lookahead leaves even its first
  // word searchable when rejection reveals an overlapping credential clause.
  { code: "SECRET_MATERIAL", pattern: /\b(?:senha(?:[ \t]+(?:dele|dela|deles|delas))?|password)[ \t]+(?:é|eh|e|is)(?:[ \t]+(?::[ \t]*)?|:[ \t]*)(?=(?:["'`]([^\r\n"'`]{6,})|([^\s"'`,;{}[\]]+)(?=(?:[ \t]+([^\s"'`,;{}[\]]+))?)))/i, accepts: proseContainsValue, detail: "password supplied in prose" },
  { code: "SECRET_MATERIAL", pattern: /\b(?:use|utilize)[ \t]+(?:(?:a|the)[ \t]+)?(?:senha|password)(?:[ \t]+(?::[ \t]*)?|:[ \t]*)(?=(?:["'`]([^\r\n"'`]{6,})|([^\s"'`,;{}[\]]+)(?=(?:[ \t]+([^\s"'`,;{}[\]]+))?)))/i, accepts: proseContainsValue, detail: "password supplied in an instruction" },
  { code: "SECRET_MATERIAL", pattern: /\bbearer[ \t]+[a-z0-9._~+/-]{6,}={0,2}/i, detail: "bearer credential" },
  { code: "SECRET_MATERIAL", pattern: /\bauthorization["']?\s*[:=]\s*["']?basic[ \t]+[a-z0-9+/_-]{6,}={0,2}/i, detail: "basic authorization credential" },
  { code: "SECRET_MATERIAL", pattern: /\bbasic[ \t]+([a-z0-9+/_-]{6,}={0,2})/i, accepts: basicContainsCredential, detail: "bare basic credential" },
  { code: "SECRET_MATERIAL", pattern: /\b(?:sk-(?:proj-|ant-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})\b/i, detail: "API credential prefix" },
  { code: "SECRET_MATERIAL", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/, detail: "AWS credential identifier" },
  { code: "SECRET_MATERIAL", pattern: /\bxox[a-z]-[a-z0-9-]{10,}/i, detail: "Slack credential prefix" },
  { code: "SECRET_MATERIAL", pattern: /\bAIza[a-zA-Z0-9_-]{35}(?![a-zA-Z0-9_-])/, detail: "Google API credential prefix" },
  { code: "SECRET_MATERIAL", pattern: /\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i, detail: "JWT-shaped credential" },
  { code: "SECRET_MATERIAL", pattern: /-----BEGIN\s+(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED)\s+)?PRIVATE\s+KEY-----/i, detail: "private key material" },
  { code: "SECRET_MATERIAL", pattern: /:\/\/[^/\s:@]+:[^/\s@]+@/i, accepts: credentialUrlHasScheme, detail: "credential-bearing URL" }
];

/** Uses the same secret signals at admission and model-context boundaries. */
export function containsSecretMaterial(content: string): boolean {
  return SECRET_PATTERNS.some((candidate) => candidate.code === "SECRET_MATERIAL" && matchesSignal(content, candidate));
}

/**
 * Structural prompt firewall.  Regex is only a signal for quarantine and audit;
 * the structural guarantee is that untrusted content is emitted as delimited
 * data (see `renderUntrusted`) and can never populate trusted sections.
 */
export function inspectUntrustedContent(content: string, item: Pick<ContextItem, "id" | "provenance" | "trust">): ContextFirewallFinding[] {
  const findings: ContextFirewallFinding[] = [];
  for (const candidate of SECRET_PATTERNS) {
    if (matchesSignal(content, candidate)) {
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
    const toolTokens = request.toolContracts.reduce((total, tool) => total + estimateTokens(`${tool.name} ${tool.description}`), 0);

    const evaluate = (item: ContextItem, kind: string): ModelContextItem | null => {
      if (!allowedDataClasses.includes(item.dataClass)) {
        findings.push({ code: "DISALLOWED_DATA_CLASS", itemId: item.id, source: item.provenance.source, trust: item.trust, detail: `data class ${item.dataClass} is not allowed for ${request.agentProfile.name}` });
        quarantined.push({ itemId: item.id, reason: "DISALLOWED_DATA_CLASS" });
        sanitized = true;
        return null;
      }
      const itemFindings = inspectUntrustedContent(item.content, item);
      // A trusted origin or a tool-result label does not authorize disclosure
      // of secret material, including copies of already quarantined content.
      if (itemFindings.some((finding) => finding.code === "SECRET_MATERIAL")) {
        findings.push(...itemFindings);
        quarantined.push({ itemId: item.id, reason: "SECRET_MATERIAL" });
        sanitized = true;
        return null;
      }
      if (item.trust === "RETRIEVED_UNTRUSTED" || item.trust === "EXTERNAL_UNTRUSTED" || item.trust === "TOOL_RESULT" || item.trust === "USER_SUPPLIED") {
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

    const taskContent = `[TASK]\n${request.task.objective}\n[STATE]\n${request.task.state}`;
    const task = evaluate({
      id: "task.state", kind: "task.state", trust: "USER_SUPPLIED",
      priority: CONTEXT_PRIORITY.ACTIVE_TASK, content: taskContent, dataClass: "D2",
      tokens: estimateTokens(taskContent),
      provenance: { source: "task.objective", owner: "CVG session", version: null, digest: sha256Hex(taskContent), retrievedAt: null }
    }, "task.state");
    const taskTokens = task?.tokens ?? 0;
    const items: ModelContextItem[] = [];
    const budget = Math.max(0, request.tokenBudget);
    let used = systemTokens + taskTokens + toolTokens;
    items.push({ role: "system", content: request.systemInstructions, trust: "SYSTEM_TRUSTED", kind: "system.instructions", tokens: estimateTokens(request.systemInstructions), dataClass: "D0" });
    items.push({ role: "system", content: request.agentProfile.instructions, trust: "SYSTEM_TRUSTED", kind: "agent.profile", tokens: estimateTokens(request.agentProfile.instructions), dataClass: "D0" });
    if (task) items.push(task);
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
