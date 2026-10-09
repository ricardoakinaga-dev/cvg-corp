# ADR 041 — AUD27 migration harness boundary

## Problem and invariant

The 24 residual snapshot-primary slices need a resumable migration protocol. A
run must not silently cross tenants, duplicate a command, hide partial progress,
or call a slice reconciled when committed target state does not equal the source
selection. A checkpoint is a recovery aid, not proof that the target committed.

## Current evidence and unknowns

`packages/persistence/src/snapshot-migration.ts` provides a useful contract
model and an in-memory idempotency coordinator. The AUD27-011 harness now also
provides `PostgresAud27MigrationAdapter` and
`PostgresAud27MigrationCheckpointStore`, backed by the dedicated 047 migration
tables. The adapter is still a protocol fixture boundary: real 24-slice domain
cutovers, representative production data, and authorized ownership decisions
remain required evidence for AUD27-012..014.

## Decision

Use a small expand/verify/reconcile executor with:

- bounded, tenant-scoped batches and stable keys;
- authorization before every batch;
- idempotent command IDs per slice, tenant and record;
- a caller-owned adapter transaction with a rollback hook;
- checkpoint after each successful batch;
- source/target count and canonical digest parity before `RECONCILED`;
- `QUARANTINED` status on parity drift; and
- explicit `DRY_RUN`, `APPLIED`, `REPLAY` and rollback outcomes.

The executor does not own SQL, silently retry unknown effects, or switch the
source of truth. A production adapter must persist checkpoints transactionally
and verify committed rows after restart.

The PostgreSQL adapter implements that boundary for a disposable authorized
operator connection. It requires an explicit authorizer callback, writes
tenant/slice-scoped records with digest-checked idempotency, persists
checkpoints, rejects source drift and tenant crossing, and exposes a rollback
hook for committed batch rows. Migration 047 revokes the runtime role's access
to these operator tables.

## Rejected alternatives

- Keeping only the existing in-memory coordinator: insufficient durability and
  restart evidence.
- A new queue or service: no demonstrated deployment/fault-isolation need for
  this local migration boundary.
- Destructive one-shot replacement: no safe recovery for mixed versions or
  partial batches.

## Failure and recovery contract

An adapter failure rolls back effects from the current invocation. A process
crash after a target commit is recovered by re-reading durable target state and
replaying only idempotent keys; the executor must not assume the last checkpoint
is the last commit. Parity drift is quarantined for operator repair, not retried
blindly. Every run has a stable `runId`, slice and tenant scope.

## Verification

`tests/unit/aud27-migration-harness.test.ts` covers dry-run, checkpointed batch
execution, replay, tenant crossing, batch rollback and deliberate parity drift.
`scripts/verify-aud27-postgres-migration.ts`, executed by the disposable
PostgreSQL harness with `--run-aud27-migration`, covers the same protocol over
real PostgreSQL 16 tables and leaves the container inventory unchanged. These
checks do not close the real-image, 24-slice, staging or external-authority
gates.
