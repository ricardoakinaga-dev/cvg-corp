import type { CvgContext, Guardian, GuardianInput } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

/** Repository port for guardian commands; persistence owns the transaction. */
export interface GuardianRepository {
  create(context: CvgContext, input: GuardianInput): Promise<Guardian>;
}

export class StoreGuardianRepository implements GuardianRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: GuardianInput): Promise<Guardian> {
    return this.store.createGuardian(context, input);
  }
}

export class PostgresGuardianRepository implements GuardianRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: GuardianInput): Promise<Guardian> {
    // The request commit receives this command-owned row and writes it to the
    // normalized table in the same transaction as the canonical snapshot.
    return this.store.createGuardian(context, input);
  }
}

export class GuardianApplicationService {
  constructor(private readonly repository: GuardianRepository) {}

  async create(context: CvgContext, input: GuardianInput): Promise<Guardian> {
    enforceApplicationPolicy(context, "guardians.create");
    return this.repository.create(context, input);
  }
}
