import { createHash } from "node:crypto";

/**
 * Skill runtime.  A skill is knowledge/procedure, not executable capability:
 * it can declare required tools and capabilities but never grants authority.
 */

export const SKILL_SCHEMA_VERSION = "cvg-agent-skill/1";

export type SkillRisk = "LOW" | "MEDIUM" | "HIGH";

export interface AgentSkillManifest {
  name: string;
  version: string;
  publisher: string;
  schemaVersion: string;
  digest: string;
  instructions: string;
  examples: readonly string[];
  references: readonly { title: string; source: string }[];
  requiredTools: readonly string[];
  requiredCapabilities: readonly string[];
  dataClasses: readonly string[];
  risk: SkillRisk;
}

export interface SkillRecord {
  manifest: AgentSkillManifest;
  approvalStatus: "DRAFT" | "APPROVED" | "QUARANTINED";
  reviewDate: string | null;
  reason: string | null;
}

export interface SkillSelection {
  selected: readonly AgentSkillManifest[];
  unavailable: readonly { name: string; reason: string }[];
}

export function skillDigest(manifest: Omit<AgentSkillManifest, "digest">): string {
  const canonical = {
    name: manifest.name,
    version: manifest.version,
    publisher: manifest.publisher,
    schemaVersion: manifest.schemaVersion,
    instructions: manifest.instructions,
    examples: [...manifest.examples],
    references: [...manifest.references].map((reference) => `${reference.title}|${reference.source}`).sort(),
    requiredTools: [...manifest.requiredTools].sort(),
    requiredCapabilities: [...manifest.requiredCapabilities].sort(),
    dataClasses: [...manifest.dataClasses].sort(),
    risk: manifest.risk
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface SkillFrontmatter {
  name?: string;
  version?: string;
  publisher?: string;
  risk?: string;
  requiredTools?: string[];
  requiredCapabilities?: string[];
  dataClasses?: string[];
}

/**
 * Parses a `SKILL.md`-style document.  The frontmatter is declarative data; the
 * body is untrusted knowledge and is only used with a low-privilege trust level.
 */
export function parseSkillMarkdown(markdown: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown.trim() };
  const frontmatter: SkillFrontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const list = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : null;
    if (["requiredTools", "requiredCapabilities", "dataClasses"].includes(key) && list) {
      (frontmatter as Record<string, unknown>)[key] = list;
    } else if (["name", "version", "publisher", "risk"].includes(key)) {
      (frontmatter as Record<string, unknown>)[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body: match[2]!.trim() };
}

export class SkillRegistry {
  private readonly records = new Map<string, SkillRecord>();

  register(input: Omit<AgentSkillManifest, "digest"> & { digest?: string }): SkillRecord {
    const manifest: AgentSkillManifest = { ...input, digest: input.digest ?? skillDigest(input) };
    const expected = skillDigest(input);
    if (manifest.digest !== expected) throw new Error(`SKILL_DIGEST_MISMATCH:${manifest.name}`);
    if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(manifest.name)) throw new Error(`SKILL_INVALID_NAME:${manifest.name}`);
    if (manifest.schemaVersion !== SKILL_SCHEMA_VERSION) throw new Error(`SKILL_SCHEMA_UNSUPPORTED:${manifest.schemaVersion}`);
    const record: SkillRecord = { manifest, approvalStatus: "DRAFT", reviewDate: null, reason: null };
    this.records.set(manifest.name, record);
    return record;
  }

  approve(name: string, reviewDate: string): SkillRecord {
    const record = this.require(name);
    const approved: SkillRecord = { ...record, approvalStatus: "APPROVED", reviewDate, reason: null };
    this.records.set(name, approved);
    return approved;
  }

  quarantine(name: string, reason: string): SkillRecord {
    const record = this.require(name);
    const quarantined: SkillRecord = { ...record, approvalStatus: "QUARANTINED", reason };
    this.records.set(name, quarantined);
    return quarantined;
  }

  /**
   * Skills are selected only when approved and when their declared requirements
   * are fully satisfied.  A skill never enables a tool or capability by itself.
   */
  select(input: { availableTools: readonly string[]; availableCapabilities: readonly string[]; allowedDataClasses: readonly string[]; limit?: number }): SkillSelection {
    const selected: AgentSkillManifest[] = [];
    const unavailable: { name: string; reason: string }[] = [];
    for (const record of [...this.records.values()].sort((a, b) => (a.manifest.name < b.manifest.name ? -1 : 1))) {
      if (record.approvalStatus !== "APPROVED") {
        unavailable.push({ name: record.manifest.name, reason: `NOT_APPROVED:${record.approvalStatus}` });
        continue;
      }
      const missingTool = record.manifest.requiredTools.find((tool) => !input.availableTools.includes(tool));
      if (missingTool) {
        unavailable.push({ name: record.manifest.name, reason: `MISSING_TOOL:${missingTool}` });
        continue;
      }
      const missingCapability = record.manifest.requiredCapabilities.find((capability) => !input.availableCapabilities.includes(capability));
      if (missingCapability) {
        unavailable.push({ name: record.manifest.name, reason: `MISSING_CAPABILITY:${missingCapability}` });
        continue;
      }
      const disallowed = record.manifest.dataClasses.find((dataClass) => !input.allowedDataClasses.includes(dataClass));
      if (disallowed) {
        unavailable.push({ name: record.manifest.name, reason: `DATA_CLASS_NOT_ALLOWED:${disallowed}` });
        continue;
      }
      selected.push(record.manifest);
      if (input.limit !== undefined && selected.length >= input.limit) break;
    }
    return { selected, unavailable };
  }

  get(name: string): SkillRecord | null {
    return this.records.get(name) ?? null;
  }

  snapshot(): SkillRecord[] {
    return [...this.records.values()];
  }

  private require(name: string): SkillRecord {
    const record = this.records.get(name);
    if (!record) throw new Error(`SKILL_NOT_FOUND:${name}`);
    return record;
  }
}
