import { id } from "@cvg/contracts";
import type { AiSession, CvgContext } from "@cvg/contracts";
import { CvgStore, digest, isInContext } from "@cvg/domain";
import type { GovernedTool } from "@cvg/harness";
import type { EmbeddedToolExecution, EmbeddedToolExecutor } from "@cvg/embedded-agent-runtime";

/**
 * Application binding for the embedded agent runtime tools.  This is the only
 * place where an authorized tool request becomes a governed application read.
 *
 * Security properties:
 * - the authoritative resource comes from the authenticated tool request
 *   (`parsedInput.resourceId`), never from model-provided arguments;
 * - every read re-validates organization/unit/workspace scope against the live
 *   store before returning, mirroring the application read services;
 * - only minimal projections leave this boundary (data minimization);
 * - tools without a bound application operation fail closed instead of
 *   reporting a synthetic success.
 */

export class AgentToolExecutorNotBoundError extends Error {
  constructor(tool: string) {
    super(`Nenhum executor de aplicação está vinculado para ${tool}; nenhum efeito foi executado.`);
    this.name = "AgentToolExecutorNotBoundError";
  }
}

export class AgentToolScopeError extends Error {
  constructor(tool: string) {
    super(`O recurso solicitado por ${tool} não pertence ao escopo autorizado.`);
    this.name = "AgentToolScopeError";
  }
}

export class AgentToolIdentityDivergenceError extends AgentToolScopeError {
  readonly code = "DIVERGENT" as const;

  constructor(tool: string) {
    super(tool);
    this.name = "AgentToolIdentityDivergenceError";
  }
}

export interface AgentToolExecutorOptions {
  store: CvgStore;
  /** Maximum agenda rows returned to the model. */
  agendaLimit?: number;
}

interface ToolRequestInput {
  aiSessionId?: string;
  prompt?: string;
  purpose?: string;
  patientId?: string | null;
  encounterId?: string | null;
  resourceId?: string | null;
  toolInput?: unknown;
}

function readInput(parsedInput: unknown): ToolRequestInput {
  return typeof parsedInput === "object" && parsedInput !== null ? (parsedInput as ToolRequestInput) : {};
}

function complete(payload: unknown): EmbeddedToolExecution {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    status: "COMPLETED",
    resultDigest: digest(payload),
    resultPreview: text.length > 240 ? `${text.slice(0, 240)}…` : text
  };
}

export function createAgentToolExecutor(options: AgentToolExecutorOptions): EmbeddedToolExecutor {
  const { store } = options;
  const agendaLimit = Math.min(Math.max(options.agendaLimit ?? 20, 1), 50);

  const readPatient = (context: CvgContext, input: ToolRequestInput): EmbeddedToolExecution => {
    const resolution = store.resolveAgentResource({ resourceId: input.resourceId ? id(input.resourceId) : null, encounterId: input.encounterId ? id(input.encounterId) : null, patientId: input.patientId ? id(input.patientId) : null });
    if (resolution.status === "DIVERGENT") throw new AgentToolIdentityDivergenceError("cvg.patient.read");
    if (resolution.status !== "RESOLVED" || resolution.resource.kind !== "PATIENT") throw new AgentToolScopeError("cvg.patient.read");
    const patient = store.patients.get(resolution.resource.resourceId);
    if (!patient || !isInContext(patient, context)) throw new AgentToolScopeError("cvg.patient.read");
    // Minimal projection: identifiers, clinical detail and guardian links stay behind.
    return complete({ resource: "patient", id: patient.id, name: patient.name, species: patient.species, status: patient.status });
  };

  const readAgenda = (context: CvgContext): EmbeddedToolExecution => {
    const appointments = [...store.appointments.values()]
      .filter((appointment) => isInContext(appointment, context))
      .sort((left, right) => (left.startsAt < right.startsAt ? -1 : left.startsAt > right.startsAt ? 1 : 0))
      .slice(0, agendaLimit)
      .map((appointment) => ({ id: appointment.id, startsAt: appointment.startsAt, status: appointment.status, patientId: appointment.patientId }));
    return complete({ resource: "agenda", window: context.unitId ? "unit" : "organization", items: appointments });
  };

  const readEncounter = (context: CvgContext, input: ToolRequestInput): EmbeddedToolExecution => {
    const resourceId = input.encounterId ?? input.resourceId ?? null;
    if (!resourceId) throw new AgentToolScopeError("cvg.clinical.draft");
    // The resource is resolved against the live repository: organization,
    // unit, workspace and patient ownership all come from the record, never
    // from the caller's context (CVG-AUD19-006/AUD-2026-001).
    const resolution = store.resolveAgentResource({ resourceId: id(input.resourceId ?? resourceId), encounterId: id(input.encounterId ?? resourceId), patientId: input.patientId ? id(input.patientId) : null });
    if (resolution.status === "DIVERGENT") throw new AgentToolIdentityDivergenceError("cvg.clinical.draft");
    if (resolution.status !== "RESOLVED" || resolution.resource.kind !== "ENCOUNTER") throw new AgentToolScopeError("cvg.clinical.draft");
    const encounter = store.encounters.get(id(resourceId));
    if (!encounter || encounter.id !== resolution.resource.resourceId || !isInContext(encounter, context)) throw new AgentToolScopeError("cvg.clinical.draft");
    return complete({ resource: "encounter", id: encounter.id, patientId: encounter.patientId, status: encounter.status });
  };

  return async ({ tool, parsedInput, context }: { tool: GovernedTool; parsedInput: unknown; context: CvgContext; session: AiSession; signal: AbortSignal }): Promise<EmbeddedToolExecution> => {
    const input = readInput(parsedInput);
    switch (tool.name) {
      case "cvg.patient.read":
        return readPatient(context, input);
      case "cvg.agenda.read":
        return readAgenda(context);
      case "cvg.clinical.draft":
        return readEncounter(context, input);
      default:
        // communication.stage, stock.dispense and finance.refund are effects:
        // they require their own governed application command binding, which is
        // intentionally absent.  A synthetic success here would be a lie.
        throw new AgentToolExecutorNotBoundError(tool.name);
    }
  };
}
