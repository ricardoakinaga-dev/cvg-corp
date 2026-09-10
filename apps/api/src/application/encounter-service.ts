import type { CvgContext, Encounter, EncounterInput } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

/** Repository port for encounter commands. The durable request owns the SQL unit of work. */
export interface EncounterRepository {
  create(context: CvgContext, input: EncounterInput): Promise<Encounter>;
}

export class StoreEncounterRepository implements EncounterRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: EncounterInput): Promise<Encounter> {
    return this.store.createEncounter(context, input);
  }
}

export class PostgresEncounterRepository implements EncounterRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: EncounterInput): Promise<Encounter> {
    // The request commit owns the PostgreSQL transaction and receives the
    // returned encounter as its command-owned normalized write.
    return this.store.createEncounter(context, input);
  }
}

export class EncounterApplicationService {
  constructor(private readonly repository: EncounterRepository) {}

  async create(context: CvgContext, input: EncounterInput): Promise<Encounter> {
    enforceApplicationPolicy(context, "encounters.create", { resourceId: input.patientId });
    return this.repository.create(context, input);
  }
}
