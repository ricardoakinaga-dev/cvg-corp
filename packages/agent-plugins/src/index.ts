import { createHash } from "node:crypto";

/**
 * Plugin runtime.  Plugins provide executable capability and receive only the
 * capabilities the runtime grants: never database, filesystem, secrets or an
 * unrestricted HTTP client.  There is no ambient authority.
 */

export const PLUGIN_API_VERSION = "cvg-agent-plugin/1";

export type PluginRisk = "LOW" | "MEDIUM" | "HIGH" | "UNTRUSTED";

export type AgentPluginPermission = "logger" | "metrics" | "scoped-config" | "approved-tools" | "clock";

export const AGENT_PLUGIN_PERMISSIONS: readonly AgentPluginPermission[] = ["logger", "metrics", "scoped-config", "approved-tools", "clock"];

export interface AgentPluginDependency {
  capability: string;
  minVersion: string | null;
}

export interface AgentPluginManifest {
  name: string;
  version: string;
  publisher: string;
  apiVersion: string;
  digest: string;
  permissions: readonly AgentPluginPermission[];
  capabilities: readonly { name: string; version: string }[];
  dependencies: readonly AgentPluginDependency[];
  risk: PluginRisk;
}

export interface AgentPluginLogger {
  info(message: string, metadata?: Record<string, string | number | boolean | null>): void;
  warn(message: string, metadata?: Record<string, string | number | boolean | null>): void;
  error(message: string, metadata?: Record<string, string | number | boolean | null>): void;
}

export interface AgentPluginMetrics {
  increment(metric: string, value?: number): void;
}

export interface AgentToolClient {
  /** Every call crosses the CVG Tool Gateway; the plugin never executes domain writes. */
  request(input: { tool: string; payload: Record<string, unknown> }): Promise<{ status: "COMPLETED" | "DENIED" | "OUTCOME_UNKNOWN"; resultDigest: string | null }>;
}

export interface AgentPluginContext {
  logger: AgentPluginLogger;
  metrics: AgentPluginMetrics;
  scopedConfig: Readonly<Record<string, string | number | boolean | null>>;
  approvedToolClient: AgentToolClient | null;
  clock: { now(): number };
}

export interface AgentPluginHook {
  name: string;
  phase: "PRE_CONTEXT" | "POST_TOOL" | "PRE_TURN" | "POST_TURN";
  handler: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface AgentPlugin {
  manifest: AgentPluginManifest;
  initialize(context: AgentPluginContext): Promise<void>;
  capabilities(): readonly string[];
  hooks(): readonly AgentPluginHook[];
  shutdown(): Promise<void>;
}

export type PluginLifecycleState = "DISCOVERED" | "VALIDATED" | "LOADED" | "INITIALIZED" | "READY" | "DEGRADED" | "DISABLED" | "FAILED";

export interface PluginRecord {
  name: string;
  version: string;
  state: PluginLifecycleState;
  risk: PluginRisk;
  permissions: readonly AgentPluginPermission[];
  capabilities: readonly string[];
  reason: string | null;
  failures: number;
  updatedAt: string;
}

export interface PluginAllowlistEntry {
  name: string;
  version: string;
  digest: string;
}

export interface PluginRuntimeOptions {
  allowlist: readonly PluginAllowlistEntry[];
  apiVersion?: string;
  clock?: { now(): number };
  logger?: AgentPluginLogger;
  metrics?: AgentPluginMetrics;
  scopedConfig?: Readonly<Record<string, string | number | boolean | null>>;
  approvedToolClient?: AgentToolClient | null;
  /** HIGH/UNTRUSTED plugins additionally require an explicit runtime approval token. */
  approvedRiskyPlugins?: readonly string[];
}

export interface PluginDependencyResolution {
  order: readonly string[];
  cycles: readonly string[][];
  missing: readonly { plugin: string; capability: string }[];
  conflicts: readonly { capability: string; providers: readonly string[] }[];
  ok: boolean;
}

export function pluginManifestDigest(manifest: Omit<AgentPluginManifest, "digest">): string {
  const canonical = {
    name: manifest.name,
    version: manifest.version,
    publisher: manifest.publisher,
    apiVersion: manifest.apiVersion,
    permissions: [...manifest.permissions].sort(),
    capabilities: [...manifest.capabilities].map((capability) => `${capability.name}@${capability.version}`).sort(),
    dependencies: [...manifest.dependencies].map((dependency) => `${dependency.capability}@${dependency.minVersion ?? "*"}`).sort(),
    risk: manifest.risk
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export class PluginRuntime {
  private readonly plugins = new Map<string, AgentPlugin>();
  private readonly records = new Map<string, PluginRecord>();
  private readonly hooksByPhase = new Map<AgentPluginHook["phase"], { plugin: string; hook: AgentPluginHook }[]>();

  constructor(private readonly options: PluginRuntimeOptions) {}

  register(plugin: AgentPlugin): PluginRecord {
    const manifest = plugin.manifest;
    const now = this.iso();
    const fail = (reason: string): PluginRecord => {
      const record: PluginRecord = { name: manifest.name, version: manifest.version, state: "FAILED", risk: manifest.risk, permissions: manifest.permissions, capabilities: [], reason, failures: 1, updatedAt: now };
      this.records.set(manifest.name, record);
      return record;
    };
    if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(manifest.name)) return fail("INVALID_MANIFEST_NAME");
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) return fail("INVALID_MANIFEST_VERSION");
    if (manifest.apiVersion !== (this.options.apiVersion ?? PLUGIN_API_VERSION)) return fail(`INCOMPATIBLE_API_VERSION:${manifest.apiVersion}`);
    for (const permission of manifest.permissions) {
      if (!AGENT_PLUGIN_PERMISSIONS.includes(permission)) return fail(`FORBIDDEN_PERMISSION:${String(permission)}`);
    }
    const { digest, ...rest } = manifest;
    if (pluginManifestDigest(rest) !== digest) return fail("MANIFEST_DIGEST_MISMATCH");
    const allowlisted = this.options.allowlist.find((entry) => entry.name === manifest.name && entry.version === manifest.version);
    if (!allowlisted) return fail("NOT_ALLOWLISTED");
    if (allowlisted.digest !== digest) return fail("ALLOWLIST_DIGEST_MISMATCH");
    if ((manifest.risk === "HIGH" || manifest.risk === "UNTRUSTED") && !(this.options.approvedRiskyPlugins ?? []).includes(manifest.name)) {
      return fail("RISKY_PLUGIN_NOT_APPROVED");
    }
    this.plugins.set(manifest.name, plugin);
    const record: PluginRecord = { name: manifest.name, version: manifest.version, state: "VALIDATED", risk: manifest.risk, permissions: manifest.permissions, capabilities: manifest.capabilities.map((capability) => capability.name), reason: null, failures: 0, updatedAt: now };
    this.records.set(manifest.name, record);
    return record;
  }

  resolveDependencies(): PluginDependencyResolution {
    const validated = [...this.records.values()].filter((record) => record.state !== "FAILED");
    const providers = new Map<string, string[]>();
    const capabilityVersions = new Map<string, Set<string>>();
    for (const record of validated) {
      const plugin = this.plugins.get(record.name);
      for (const capability of plugin?.manifest.capabilities ?? []) {
        providers.set(capability.name, [...(providers.get(capability.name) ?? []), record.name]);
        capabilityVersions.set(capability.name, new Set([...(capabilityVersions.get(capability.name) ?? []), capability.version]));
      }
    }
    const missing: { plugin: string; capability: string }[] = [];
    const edges = new Map<string, string[]>();
    for (const record of validated) {
      const plugin = this.plugins.get(record.name);
      if (!plugin) continue;
      for (const dependency of plugin.manifest.dependencies) {
        const candidateProviders = providers.get(dependency.capability) ?? [];
        if (candidateProviders.length === 0) missing.push({ plugin: record.name, capability: dependency.capability });
        edges.set(record.name, [...(edges.get(record.name) ?? []), ...candidateProviders.filter((provider) => provider !== record.name)]);
      }
    }
    const conflicts = [...capabilityVersions.entries()]
      .filter(([, versions]) => versions.size > 1)
      .map(([capability]) => ({ capability, providers: providers.get(capability) ?? [] }));
    const cycles: string[][] = [];
    const order: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (name: string, path: string[]): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        cycles.push([...path.slice(path.indexOf(name)), name]);
        return;
      }
      visiting.add(name);
      for (const next of edges.get(name) ?? []) visit(next, [...path, name]);
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };
    for (const record of validated) visit(record.name, []);
    return { order, cycles, missing, conflicts, ok: missing.length === 0 && cycles.length === 0 && conflicts.length === 0 };
  }

  async initializeAll(): Promise<PluginRecord[]> {
    const resolution = this.resolveDependencies();
    if (!resolution.ok) {
      for (const record of this.records.values()) {
        if (record.state === "VALIDATED") this.records.set(record.name, { ...record, state: "FAILED", reason: "DEPENDENCY_RESOLUTION_FAILED", failures: record.failures + 1, updatedAt: this.iso() });
      }
      return [...this.records.values()];
    }
    for (const name of resolution.order) {
      const plugin = this.plugins.get(name);
      if (!plugin) continue;
      this.records.set(name, { ...this.requireRecord(name), state: "LOADED", updatedAt: this.iso() });
      try {
        await plugin.initialize(this.buildContext(plugin));
        this.records.set(name, { ...this.requireRecord(name), state: "INITIALIZED", updatedAt: this.iso() });
        for (const hook of plugin.hooks()) {
          const list = this.hooksByPhase.get(hook.phase) ?? [];
          list.push({ plugin: name, hook });
          this.hooksByPhase.set(hook.phase, list);
        }
        this.records.set(name, { ...this.requireRecord(name), state: "READY", reason: null, updatedAt: this.iso() });
      } catch (error) {
        this.records.set(name, { ...this.requireRecord(name), state: "FAILED", reason: error instanceof Error ? error.message : "INITIALIZATION_FAILED", failures: this.requireRecord(name).failures + 1, updatedAt: this.iso() });
      }
    }
    return [...this.records.values()];
  }

  async disable(name: string, reason: string): Promise<PluginRecord | null> {
    const record = this.records.get(name);
    const plugin = this.plugins.get(name);
    if (!record || !plugin) return null;
    if (record.state === "READY" || record.state === "DEGRADED") {
      try {
        await plugin.shutdown();
      } catch {
        // A failed shutdown must not keep capabilities alive.
      }
    }
    for (const [phase, entries] of this.hooksByPhase) this.hooksByPhase.set(phase, entries.filter((entry) => entry.plugin !== name));
    const disabled: PluginRecord = { ...record, state: "DISABLED", capabilities: [], reason, updatedAt: this.iso() };
    this.records.set(name, disabled);
    return disabled;
  }

  /** Only READY plugins expose capabilities: FAILED/DISABLED never do. */
  availableCapabilities(): string[] {
    const capabilities: string[] = [];
    for (const record of this.records.values()) {
      if (record.state === "READY" || record.state === "DEGRADED") capabilities.push(...record.capabilities);
    }
    return capabilities.sort();
  }

  hooks(phase: AgentPluginHook["phase"]): readonly { plugin: string; hook: AgentPluginHook }[] {
    return [...(this.hooksByPhase.get(phase) ?? [])].filter((entry) => {
      const record = this.records.get(entry.plugin);
      return record?.state === "READY" || record?.state === "DEGRADED";
    });
  }

  snapshot(): PluginRecord[] {
    return [...this.records.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async shutdownAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      const record = this.records.get(name);
      if (!record || (record.state !== "READY" && record.state !== "DEGRADED")) continue;
      try {
        await plugin.shutdown();
        this.records.set(name, { ...record, state: "DISABLED", capabilities: [], reason: "SHUTDOWN", updatedAt: this.iso() });
      } catch {
        this.records.set(name, { ...record, state: "FAILED", capabilities: [], reason: "SHUTDOWN_FAILED", failures: record.failures + 1, updatedAt: this.iso() });
      }
    }
  }

  private buildContext(plugin: AgentPlugin): AgentPluginContext {
    const permissions = new Set(plugin.manifest.permissions);
    const logger = this.options.logger ?? { info: () => undefined, warn: () => undefined, error: () => undefined };
    const redact = (metadata?: Record<string, string | number | boolean | null>) => {
      if (!metadata) return undefined;
      const safe: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(metadata)) {
        safe[key] = /secret|token|password|credential/i.test(key) ? "[REDACTED]" : value;
      }
      return safe;
    };
    return {
      logger: permissions.has("logger")
        ? { info: (message, metadata) => logger.info(`[plugin:${plugin.manifest.name}] ${message}`, redact(metadata)), warn: (message, metadata) => logger.warn(`[plugin:${plugin.manifest.name}] ${message}`, redact(metadata)), error: (message, metadata) => logger.error(`[plugin:${plugin.manifest.name}] ${message}`, redact(metadata)) }
        : { info: () => undefined, warn: () => undefined, error: () => undefined },
      metrics: permissions.has("metrics") ? (this.options.metrics ?? { increment: () => undefined }) : { increment: () => undefined },
      scopedConfig: permissions.has("scoped-config") ? (this.options.scopedConfig ?? {}) : {},
      approvedToolClient: permissions.has("approved-tools") ? (this.options.approvedToolClient ?? null) : null,
      clock: permissions.has("clock") ? (this.options.clock ?? { now: () => Date.now() }) : { now: () => Date.now() }
    };
  }

  private requireRecord(name: string): PluginRecord {
    const record = this.records.get(name);
    if (!record) throw new Error(`plugin record missing: ${name}`);
    return record;
  }

  private iso(): string {
    return new Date(this.options.clock ? this.options.clock.now() : Date.now()).toISOString();
  }
}
