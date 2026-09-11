# Addendum — M-03/H-05/M-04 closure rerun

**Date:** 2026-09-11  
**Mode:** fresh audit-only, read-only review  
**Scope:** product identity and execution actors; parser/recovery parity; duplicate IDs; audit/receipt/AI/signed-by foreign keys; canonical registry/import direction; and current local evidence state.

Only this report was written. No source, test, control, metric, snapshot, or evidence artifact was edited or regenerated.

## Verdict

**Architecture/security repair: PASS_WITH_LIMITATIONS.** H-05 and M-04 are repaired in the current validator and covered by focused domain/persistence tests. The parser, in-memory recovery, durable snapshot recovery, and persistence wrapper use the shared semantic validator; duplicate identifiers and the newly covered foreign keys fail closed before `clearData` or normalized DML. The domain package has no runtime or package dependency on persistence.

**Local evidence gate: FAIL.** `verify:static` and the read-only evidence verifier currently reject three operational-proof artifacts because their bytes and mtimes differ from `evidence-snapshot.json`. The snapshot was intentionally not regenerated in this audit, so the local evidence bundle is not release-clean.

**Global: AAA_NOT_PROVEN.** External provider/DeepSeek receipts, remote CI/OCI provenance, secret authority, staging transaction/restart, independent review, and human approval remain absent.

## Checks executed

- `npm run typecheck` — passed.
- `node --import tsx --test tests/unit/domain.test.ts` — **29 passed, 0 failed**. This includes product mismatch, cross-organization execution actor, duplicate collection IDs, audit/receipt FKs, AI approval FKs, signed clinical actor, parser, hydrate, and restore cases.
- `npm run verify:authoritative-writes` — passed: `domains=32`, organization/parent/scope/child/quarantine tamper rejection.
- Targeted persistence tests — **4 passed**: registry coverage, cross-parent/tenant rejection, scope drift, and medication product/actor drift.
- Registry/cycle probe — passed: `32` unique registry entries, contracts and persistence exports share the same registry object, snapshot collection coverage is complete, and direct imports of contracts/domain/persistence succeed without a domain→persistence cycle.
- `git diff --check` over the repaired contracts/domain/persistence/tests — passed.
- `npm run verify:static` — **failed only on stale evidence entries**.
- Direct read-only `verifyEvidenceSnapshot` — failed with the same three byte/mtime mismatches; it was called without the writing entry point.

The current snapshot still binds the preserved prompt SHA `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3` and contains ten artifacts. The mismatches are:

```text
artifacts/operational-proof/security-red-team-local.json
artifacts/operational-proof/resource-pressure-local.json
artifacts/operational-proof/runbook-execution-local.json
```

## Repair verification

### Product and actor identity

The shared validator now compares `order.productId` with `lot.productId` for every dispensation. It also resolves and organization-binds `stockMovements.createdBy`, `dispensations.dispensedBy`, and `administrationOccurrences.administeredBy`. The normal command path and the snapshot/recovery path therefore enforce the same product and actor ownership constraints. The focused tests exercised both `CvgStore.hydrate` and `validateAuthoritativeSnapshot`.

### Parser and recovery parity

`parseSnapshot` applies the top-level allowlist, collection shape/ID checks, normalization, and then calls `validateDomainSnapshot`, which delegates to `validateSnapshotSemantics`. `CvgStore.hydrate` and `restore` call the same validator before clearing stores. Persistence `snapshotFromJson`, `validateRecoveryBundle`, and `hydrateRecoveryBundle` all parse through this boundary; `validateAuthoritativeSnapshot` is a thin `PersistenceCorruptionError` wrapper over the same pure validator before `projectIdentity`/`projectDomain`.

### Duplicate IDs and foreign keys

`SNAPSHOT_ARRAY_KEYS` covers every `StoreSnapshot` array and is checked with `satisfies` against the interface. Each collection is required to be an array of non-empty IDs with no duplicates. The validator then checks organization/parent/scope relationships, audit actor, command-receipt actor/audit links, signed clinical actor, AI session/turn/draft/approval links, medication product/actor links, and the existing diagnostic quarantine/status chain. The new duplicate-ID and FK tests passed.

## Residual risks

### H-03 — stale operational evidence snapshot (HIGH, local gate)

The three artifacts above have current bytes and mtimes different from the recorded snapshot. This blocks a clean local evidence verdict and any promotion using that bundle. Refreshing the evidence snapshot requires the authorized evidence-generation process; this audit deliberately did not perform it.

### C-01 — external and human AAA gates unavailable (CRITICAL, global)

No externally executed provider/DeepSeek proof, trusted release provenance, secret-authority confirmation, staging smoke/restart transaction, independent reviewer, or human approval was present. Global status remains **AAA_NOT_PROVEN**.

The prior H-05 product-binding and M-04 actor-organization findings are **CLOSED/REPAIRED locally**. No new encapsulation, registry-drift, parser/recovery-parity, duplicate-ID, or domain→persistence-cycle finding was observed in this rerun.

## Final disposition

The requested M-03/H-05/M-04 implementation is locally repaired and independently exercised. The current worktree still cannot receive a clean local evidence verdict until the three stale operational artifacts are regenerated and reverified, and it cannot receive a global AAA verdict without the external and human gates.
