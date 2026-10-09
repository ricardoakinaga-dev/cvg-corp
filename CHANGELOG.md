# Changelog

## Unreleased

- Hardened the reproducible Node/npm toolchain and production container build.
- Added non-root compiled runtime images, build-context exclusions, SBOM/
  provenance generation, and dedicated secret scanning in CI.
- Made a bare API image `migrate` command apply forward migrations, and added
  a networkless backup-volume initializer so the unprivileged worker can write
  backups without changing existing artifact files.
- Pinned the Postgres image digest and verified its UID 999, read-only,
  capability-free runtime against the pinned image.
- Signing out while a session revalidates now revokes the server session and
  can no longer be undone by the late revalidation response.
- Signed integration callbacks only accept a key the server bound to that
  provider (`CVG_INTEGRATION_CALLBACK_KEYS=provider=keyRef,...`); unbound pairs
  are refused before any write.
- Production can run with `CVG_AGENT_RUNTIME=disabled` without DeepSeek
  configuration; every other runtime mode still refuses the mock.
- Added `GET /api/v1/stock/products`, so a product whose first lot was refused
  stays selectable; the stock entry form retries a refused lot as a new intent.
- Partial payments now suggest the open balance, and the root error screen no
  longer claims that no data changed.
- The mutation harness decides kills from the test runner's structured events:
  only a failure thrown inside a running test kills a mutant, while a syntax
  error, top-level throw or `process.exit` in a test file is INVALID; it also
  needs a passing unmutated baseline.
- Every local E2E run writes its traces, screenshots, report and Vite cache to
  its own `test-results/runs/<run>/` directory, so concurrent runs no longer
  delete each other's evidence; CI keeps its fixed upload paths.
- The `ai.turn` audit event records an unknown turn outcome as `UNKNOWN`
  (with the turn status), never as `ALLOWED`.
- CI runs the same-SHA evidence envelopes in their own job and uploads the
  verification artifacts even when a gate fails, so image build and scan no
  longer wait on release-candidate evidence binding.
- Bounded DeepSeek bridge response reads and upgraded fastify, fast-uri and
  source-map-js past their advisories.
