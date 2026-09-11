# Addendum — fresh M-03 snapshot validation rerun

**Date:** 2026-09-11  
**Mode:** fresh audit-only, read-only review  
**Scope:** canonical registry in `packages/contracts/src/index.ts`; shared validator in `packages/domain/src/snapshot-validation.ts`; `CvgStore.hydrate/restore`; the persistence wrapper; registry/import drift; pre-clear tamper rejection; and current static/evidence gates.

Only this report was written. No source, test, control, snapshot, evidence artifact, or runtime state was edited or regenerated.

## Verdict

**Local control wiring: PASS_WITH_LIMITATIONS.** The M-03 extraction is correctly wired: the contracts registry is shared by domain and persistence, the validator is pure, `hydrate` and `restore` validate before `clearData`, and the tested non-diagnostic appointment/patient adulterations are rejected without replacing the current authority. Typecheck, the requested tests, authoritative-write checks, static verification, and the read-only evidence verifier passed.

**M-03 closure: FAIL.** The shared validator does not enforce every non-diagnostic relationship claimed by the aggregate invariant. A tampered medication snapshot with a prescription for product A and a dispensation lot for product B was accepted by both `CvgStore.hydrate` and `validateAuthoritativeSnapshot`. The normal command path explicitly rejects that mismatch, so this is a real snapshot/recovery bypass. Three actor references also lack an organization equality check at this boundary.

**Global: AAA_NOT_PROVEN.** External provider/DeepSeek evidence, remote CI/OCI provenance, secret authority, staging execution, authenticated restart smoke, independent review, and human approval remain absent.

## Checks executed

- `npm run typecheck` — passed.
- `node --import tsx --test tests/unit/domain.test.ts` — **23 passed, 0 failed**. The new full-semantics test confirms appointment and patient tampering is rejected before `clearData` for both hydrate and restore.
- `npm run verify:authoritative-writes` — passed: `domains=32`, organization/parent/scope/child/quarantine invariants, tamper rejected.
- `npm run verify:static` — passed: `120` required artifacts and `165` source files.
- Direct read-only `verifyEvidenceSnapshot` — passed: `10` artifacts, current run ID `240108f0ddeea677bc09d204312ecf9215185df163f11d49d3907e58548bf01e`, prompt SHA `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`.
- Targeted persistence tests — **3 passed**: canonical registry coverage, cross-parent/cross-tenant rejection, and operational scope drift rejection.
- Registry/import probe — passed: the persistence export and contracts registry are the same object; all `32` registry keys exist as snapshot arrays; all `32` table insertions are present; no runtime cycle appeared when importing contracts, domain, and persistence.

The evidence verifier was imported directly instead of running the package entry point because `scripts/verify-evidence-snapshot.ts` writes the snapshot in its `main` path.

## M-03 wiring review

`AUTHORITATIVE_DOMAIN_REGISTRY` is defined once in `@cvg/contracts` with `32` snapshot/table/scope entries. `snapshot-validation.ts` imports the registry at runtime and imports `StoreSnapshot` type-only, so the domain boundary does not depend on persistence. `packages/persistence/src/index.ts` re-exports the same registry and wraps `validateSnapshotSemantics` with `PersistenceCorruptionError`. `CvgStore.hydrate` and `restore` call `validateDomainSnapshot` before `clearData`; invalid snapshots leave the current store untouched in the tested paths.

The registry and wrapper therefore repair the previous M-03 architectural separation and preserve persistence error prefixes. The targeted persistence tests and authoritative gate confirmed existing messages/invariants remain active.

## Residual findings

### H-05 — medication order/dispensation product binding is not enforced (HIGH)

At `packages/domain/src/snapshot-validation.ts:155`, the dispensation check compares `lot.productId` to itself:

```ts
same(exists(products, lot.productId, "dispensation.product").id,
     exists(products, lot.productId, "dispensation.product").id,
     "dispensation.product");
```

It never compares the lot product to `order.productId`. The normal `dispenseMedication` command does enforce `order.productId !== lot.productId` as a rejection. A read-only fixture created a valid dispensation, added a second product, changed the lot and its stock movement to that second product while leaving the medication order on product A, and observed:

```text
M03_PRODUCT_BINDING_GAP persistence=ACCEPTED hydrate=ACCEPTED normalWriteChecksOrderLot=true
```

Because the same validator backs the persistence wrapper, a durable commit can pass this pure guard; the schema has no direct dispensation product foreign key to provide an equivalent backstop. This prevents declaring full M-03 closure.

### M-04 — actor organization is not checked in three inventory/medication relations (MEDIUM)

The validator checks that `stockMovements.createdBy`, `dispensations.dispensedBy`, and `administrationOccurrences.administeredBy` exist, but it does not call `parentOrg` for those users. A synthetic snapshot with a stock movement in organization A and an actor belonging to organization B was accepted by `validateAuthoritativeSnapshot`:

```text
M03_RESIDUAL_CROSS_ORG_STOCK_ACTOR=ACCEPTED
```

The database migrations contain composite organization/user foreign keys that should reject these rows during persistence DML, which reduces the durable impact. The in-memory hydrate/restore contract and the stated “before clearData” invariant still remain incomplete.

## Closed or unchanged items

- The registry has no duplicate keys/tables, no missing snapshot collections, and no missing normalized insertions in the current source.
- Appointment/patient and diagnostic request/specimen/patient relationship tampering is rejected before in-memory replacement; the 23 domain tests and targeted persistence tests passed.
- The evidence snapshot is current, and `verify:static` no longer reports stale artifact bytes or mtimes.
- Prior H-01 alias and H-02 AST guard conclusions remain unchanged by this rerun; this report did not find a regression in those controls.

## Final disposition

The M-03 architecture and validation-before-clearData mechanism are present and locally verified, but the requested full non-diagnostic relationship guarantee is not met. Address H-05 and the actor-organization checks before marking M-03 closed. Global status remains **AAA_NOT_PROVEN** because external and human gates were not executed.
