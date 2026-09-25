# ADR 043 — AUD27 migration run serialization

## Problem and invariant

AUD27 checkpoints and target batches use separate short transactions. Two
executors with the same `(tenantId, slice, runId)` can therefore read the same
checkpoint and overlap. A failing executor could then run rollback after the
other executor has committed progress. The invariant is one active owner for a
run key from its initial checkpoint read through final parity or rollback.

## Current evidence and unknowns

The local PostgreSQL verifier reproduced the race before this change: both
same-key executions reported `APPLIED` and the target still had the expected
row count. The only current real caller is the disposable verifier in
`scripts/verify-aud27-postgres-migration.ts`. Deployment topology, external
operators, and any future callers remain unknown; this decision does not
authorize a cutover.

## Decision

- Acquire `pg_try_advisory_lock(hashtextextended(serializedRunKey, 0))` for the
  tenant, slice, and run ID. A concurrent owner fails with `RUN_IN_PROGRESS`.
- Hold the lock for the complete executor call, including validation,
  checkpoint reads and writes, each bounded apply transaction, target parity,
  and any rollback hooks.
- Route every PostgreSQL checkpoint and adapter operation in that async run
  through the same lock-owning session. Keep batch transactions short; do not
  hold a database transaction across the full migration.
- Require the PostgreSQL checkpoint store and adapter to share one run scope.
  A mismatch fails before database access. The in-memory protocol store uses a
  keyed local guard for synthetic tests only.
- A process or connection loss releases the session advisory lock. Since all
  protected SQL uses that same session, a runner cannot continue on a second
  pooled connection after losing ownership. A later run re-reads durable state
  and follows the existing digest and replay checks.

Advisory hash collisions can conservatively reject unrelated keys, but cannot
allow two owners for the same key. This lock coordinates callers using this
run scope; it does not fence arbitrary SQL or unrelated migration tools.

## Rejected alternatives

- Locking only the executor process: it does not coordinate separate
  processes.
- Holding a separate advisory-lock connection while target/checkpoint work uses
  the regular pool: after lock-session loss, the old runner could keep writing
  through another connection.
- One long transaction around every batch: it would remove durable per-batch
  checkpoints and increase lock duration and rollback scope.
- Waiting on a lock: the operator should see a conflict and decide whether to
  retry after inspecting the active run.

## Failure and recovery contract

Lock acquisition failure rejects before checkpoint or target reads. Unlock
failure destroys the session and is reported; if the migration already failed,
both errors are retained. Database disconnect releases the advisory lock, and
the next owner reconciles the durable checkpoint with target rows before
continuing. The lock does not convert local verifier evidence into staging or
production evidence.

## Verification

The disposable PostgreSQL verifier first captured the prior race, then checks
that the competing same-key execution is rejected while the first completes
with one reconciled target and that a later retry replays after lock release. It
also kills a child process after its first target batch commits but before the
checkpoint is saved, then requires a fresh executor to reconcile and replay the
same run. Unit coverage checks the keyed in-memory guard, same-session SQL
routing, and fail-closed scope mismatch. Full suite and type check results are
recorded in the active MEL23 Gauntlet round.
