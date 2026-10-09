# Contributing to CVG-Corp

## Before opening a change

- Use Node `24.x` (minimum `24.20.0`) and npm `11.x` (minimum `11.19.0`) as declared by `package.json`.
- Install from the lockfile with `npm ci --ignore-scripts --no-audit --fund=false`.
- Keep credentials, real veterinary data, provider endpoints, and production
  configuration out of commits and test artifacts.
- Preserve forward-only migrations and existing uncommitted work.

## Local checks

Run the checks relevant to the change, at minimum:

```bash
npm run verify:secrets
npm run typecheck
npm run build
npm run build:runtime
```

The CI workflow is the source of truth for the complete test and release
artifact matrix. Missing external infrastructure is a blocked result, not a
passing result.

## Focused checks by area

| Area | Focused command | Preconditions and side effects |
|---|---|---|
| Control-plane validation | `npm run verify:control-plane` | Reads the local `.agent` ledgers and prints a result; it does not write a report. |
| Control-plane capture | `npm run verify:mel23-control-plane` | Reads the local `.agent` ledgers and writes `artifacts/operational-proof/mel23-control-plane-current.json`. |
| MEL23 evidence matrix | `npm run verify:mel23-evidence` | Reads local receipts and writes `artifacts/operational-proof/mel23-evidence-matrix-current.json`. It exits non-zero while required focal receipts are missing and never overwrites the registered `mel23-evidence-matrix.json`. |
| Documentation and ADRs | `npm run verify:docs-integrity` | Scans internal Markdown links, anchors and ADR numbers; fixtures use in-memory documents. No credentials or external service are needed. |
| API response schemas and route fixtures | `node --import tsx --test tests/unit/api-response-contract.test.ts tests/unit/api-response-contract-auth-ops.test.ts tests/unit/api-response-contract-clinical.test.ts tests/unit/api-response-contract-remaining.test.ts tests/integration/api-response-routes.test.ts` | Uses local synthetic payloads and fixtures. The in-memory success fixtures intentionally stop at routes that are safe in that mode. |
| Durable API response fixtures | `node --import tsx tests/integration/api-response-postgres.verify.ts` | Requires Docker and the pinned `postgres:16-alpine` image. The verifier owns a uniquely named, loopback-only tmpfs container, signs a synthetic integration callback, validates a synthetic encrypted recovery export, checks container identity before cleanup, and verifies the container inventory is unchanged. |
| Full unit and integration regression | `npm test` | Uses test-owned in-memory fixtures. It does not connect to production or shared services. |
| PostgreSQL behavior | `npm run verify:ephemeral-postgres -- --rounds=1 --run-postgres` | Requires Docker and the pinned `postgres:16-alpine` image. Creates a uniquely named, loopback-only container with a tmpfs database and synthetic credentials, runs migrations and PostgreSQL behavior checks, then removes only that owned container. |
| Products shadow backfill | `npm run verify:aud27-products-backfill` | Requires `CVG_AUD27_PRODUCTS_BACKFILL_URL` pointing to an empty, uniquely named `cvg_aud27_products_backfill_<random-hex>` database on loopback. Apply migrations first; use a fresh PostgreSQL 16 tmpfs container and a local operator role with `BYPASSRLS` or superuser. The verifier inserts synthetic organizations/products, probes DML, and removes only generated IDs and checkpoint run IDs. It requires migrations 047/048, forced RLS and organization/SKU uniqueness; it never claims cutover. |
| PostgreSQL restore | `npm run verify:ephemeral-postgres -- --rounds=1 --run-restore` | Uses the same disposable-container safeguards and also runs the PostgreSQL behavior check before restore verification. |
| AUD27 migration, normalized writes, and 24-slice parity | Run one per disposable container: `npm run verify:ephemeral-postgres -- --rounds=1 --run-aud27-migration`; `npm run verify:ephemeral-postgres -- --rounds=1 --run-aud27-normalized-writes`; or `npm run verify:ephemeral-postgres -- --rounds=1 --run-aud27-24-slices`. | Requires Docker and the pinned image. Each command provisions, migrates, and removes its own synthetic container. Normalized-write and 24-slice checks must use separate runs. |
| Direct PostgreSQL verifiers | For example, `npm run verify:postgres:concurrency`, `npm run verify:postgres:schema-gates`, `npm run verify:postgres:isolation`, `npm run verify:postgres:worker-effects`, `npm run verify:postgres:worker-crash-restart`, and `npm run verify:postgres:restore`. | These require explicitly supplied database URLs (`DATABASE_URL`, and for some checks `MIGRATION_DATABASE_URL` and `ADMIN_DATABASE_URL`) and may create/drop databases or mutate synthetic rows. Use only an explicitly identified disposable PostgreSQL database on a separately provisioned instance with synthetic credentials. Never target a shared or production database; missing explicit configuration must remain blocked. |
| In-memory snapshot migration harness | `npm run verify:snapshot-command-migration` and `npm run verify:aud27-migration-harness` | Uses synthetic in-memory fixtures and does not connect to PostgreSQL. It does not prove a database backfill or cutover. |
| Browser and accessibility checks | `npm run test:e2e` | Install the pinned Playwright browsers first; the suite launches its local synthetic application. It does not prove assistive-technology or human review. Each local run writes its traces, screenshots, report and Vite cache to its own `test-results/runs/<run>/` directory (printed at start), so concurrent runs in one checkout cannot delete each other's evidence; `PLAYWRIGHT_OUTPUT_DIR` picks another directory, and `CI=1` keeps the fixed `test-results/` and `artifacts/playwright-report/` paths that CI uploads. |
| Build and static checks | `npm run typecheck`, `npm run verify:static`, `npm run build` | Local tools only; build outputs are generated locally. |

Do not add production credentials, real clinical data or provider endpoints to
local tests. Do not run commands against a shared database or service. Record
the exact command, exit status, environment, current subject fingerprint and
limitations with each focal result. A blocked external prerequisite stays
blocked until its authority supplies a disposable or approved target.

## Pull requests

Describe the affected boundary, security/data implications, commands run, and
known limitations. Do not claim staging, signing, provider, or human approval
that was not actually observed.
