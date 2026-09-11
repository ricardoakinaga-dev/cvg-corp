# Addendum — H-04 closure and evidence-snapshot rerun

**Date:** 2026-09-11  
**Mode:** fresh audit-only, read-only review  
**Scope:** `packages/domain/src/index.ts`, `packages/persistence/src/index.ts`, diagnostic snapshot parsing/validation, hydrate/restore behavior, request/specimen/patient integrity, and the current evidence snapshot/static gate.

Only this report was written. No source, test, control, evidence artifact, snapshot, or runtime state was edited or regenerated. The normal `verify:evidence-snapshot` entry point was not invoked because its main path writes the snapshot; the read-only `verifyEvidenceSnapshot` function was called directly against the existing file.

## Verdict

**Local: PASS_WITH_LIMITATIONS.** The H-04 repair is effective for all requested invariants. Unknown top-level snapshot fields, `QUARANTINED` diagnostic rows, unknown diagnostic statuses, and broken request/specimen/patient chains are rejected before the in-memory authority is replaced. The existing evidence snapshot is current and `verify:static` passes. A broader schema limitation remains: `parseSnapshot` performs structural checks and selected normalization, while full cross-collection authoritative validation is guaranteed at persistence commit; this rerun does not establish complete semantic validation for every possible non-diagnostic entity through `CvgStore.hydrate/restore`.

**Global: AAA_NOT_PROVEN.** External provider/DeepSeek receipts, remote CI/OCI provenance, secret authority, staging execution, authenticated transactional/restart smoke, independent human approval, and production resilience evidence remain absent. No global release or production approval is implied.

## Read-only evidence

- `npm run typecheck` — passed.
- `node --import tsx --test tests/unit/domain.test.ts` — **22 passed, 0 failed**. This includes the new unknown-top-level, quarantined-row, hydrate, normal quarantine, and restore cases.
- `npm run verify:authoritative-writes` — passed: `domains=32`, organization/parent/scope/child/quarantine invariants, tamper rejected.
- `npm run verify:static` — passed: `120` required artifacts and `164` source files.
- Direct read-only `verifyEvidenceSnapshot` — passed: `10` artifacts, prompt SHA `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`, run ID `bc595e975f907f9ec4b7cad59a685afa4db6620e60064cabfc48e020dd471770`.
- An ephemeral fixture exercised the repaired paths and produced:

  ```text
  H04_MATRIX_VERIFIED parseUnknown=REJECTED parseQuarantined=REJECTED validateQuarantined=REJECTED hydrate=REJECTED restore=REJECTED unknownStatus=REJECTED orphanChain=REJECTED
  ```

- A separate ephemeral valid diagnostic graph with a missing request parent was rejected by `validateAuthoritativeSnapshot` as `PersistenceCorruptionError` (`REQUEST_SPECIMEN_PATIENT_CHAIN_VERIFIED validate=REJECTED_ORPHAN`).

## H-04 verification

### Unknown top-level fields

`parseSnapshot` now has an explicit allowlist consisting of `healthStatus`, `authChallenges`, and the declared collection fields. An injected `unexpected` field is rejected with `DomainError(INVALID_INPUT)` before hydration.

### Diagnostic status and hydrate/restore

The hydratable status set is explicitly `RECEIVED`, `VALID`, and `REJECTED`. `parseSnapshot` rejects `QUARANTINED` and arbitrary status values. `CvgStore.hydrate` and `CvgStore.restore` call the same status and parent-chain guard before `clearData()`/`loadSnapshot()`, so a rejected snapshot cannot replace the current authority. The unit test also confirms the pre-existing store remains `READY` after a rejected hydrate.

`validateAuthoritativeSnapshot` independently rejects any diagnostic result outside the same three statuses before normalized DML and then resolves request, specimen, and patient parents, checking organization, request/specimen identity, and patient consistency.

### Request/specimen/patient chain

The domain hydrate/restore guard requires all three parents, matching organization IDs, `request.id === specimen.requestId`, `request.patientId === specimen.patientId`, and `request.patientId === result.patientId`. The persistence validator separately rejects missing parents and cross-parent/cross-tenant mismatches. The read-only orphan fixture was rejected by both the domain hydrate path and the persistence validator.

### Evidence snapshot

All ten snapshot artifact entries currently match their recorded bytes and mtimes, the prompt binding matches the preserved prompt, and the run ID recomputes correctly. The earlier stale-snapshot finding is closed for this current state. The worktree remains modified, as recorded in the snapshot; that is expected for this local audit and does not constitute external proof.

## Findings and disposition

### H-04 — diagnostic quarantine re-entry and unknown snapshot fields: CLOSED/REPAIRED locally

The previously demonstrated path that accepted an injected `QUARANTINED` diagnostic result and an unknown top-level field no longer reproduces. Parser, persistence validator, hydrate, and restore reject the respective inputs fail-closed.

### H-03 — stale evidence snapshot: CLOSED for current bytes

The read-only verifier and `verify:static` both pass against the current ten-artifact inventory. This closure is local and does not certify the external evidence gates.

### M-03 — broader in-memory snapshot schema coverage remains bounded

`parseSnapshot` checks the declared top-level shape, collection arrays, resource IDs, selected auth/scope normalization, diagnostic statuses, and diagnostic parent chain. `validateAuthoritativeSnapshot` provides the full relational check before durable persistence. `hydrate/restore` do not import or invoke the persistence validator, so this rerun does not prove exhaustive semantic validation for every other entity type at the in-memory boundary. This is a medium review limitation, not a reopening of H-04.

### C-01 — external and human AAA gates absent: CRITICAL global limitation

No external evidence bundle, trusted external execution, staging transaction/restart, remote CI/provenance, secret authority, independent reviewer, or human approval was supplied. Global status remains **AAA_NOT_PROVEN**.

## Final disposition

For the requested H-04 surface, the local verdict is **PASS_WITH_LIMITATIONS** and the prior H-04/H-03 local findings are repaired in the current worktree. The global verdict remains **AAA_NOT_PROVEN** until the external and human gates execute and produce independently verifiable evidence.
