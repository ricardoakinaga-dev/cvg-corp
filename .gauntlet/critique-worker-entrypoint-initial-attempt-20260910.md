# Fresh read-only critique — initial worker entrypoint wiring

- Target SHA: `fe02a54f363952fc2d9da3956013c63a516265af`
- Scope: entrypoint propagation of `maxOutstandingJobs`/`maxOutstandingOutbox` and the configured `CVG_WORKER_MAX_OUTSTANDING` contract.
- Critic: fresh non-inherited read-only agent `01a08a37-0a18-7881-a485-bf58c7a64309` (`Ohm`).
- Procedure: bounded wait of 60 seconds, interrupt/finalization request and a further bounded wait; no write authority.

## Decision

`REVIEW_ONLY_FINDINGS`.

The critic confirmed that both entrypoints passed both limits with the same configured value, but identified a low-severity verification gap: there was no explicit test of entrypoint composition, and `docker/worker.ts` was outside `tsconfig` and the lint roots. The finding was repaired in `7971d27`, `3b57fd5` and `39024ca`; the final review is recorded in [critique-worker-entrypoint-final-attempt-20260910.md](critique-worker-entrypoint-final-attempt-20260910.md).

No file mutation, commit or AAA approval was made by the critic.
