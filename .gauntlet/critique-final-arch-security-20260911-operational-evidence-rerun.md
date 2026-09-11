# Addendum — fresh operational evidence and architecture/security rerun

**Date:** 2026-09-11  
**Mode:** audit-only, read-only source/control review  
**Scope:** external Ed25519 receipts and evidence/artifact/provenance binding; OCI CI; transactional/restart container smoke; prompt and snapshot SHA; Docker Compose external secrets; diagnostic-result quarantine and strict validation; H-01/H-02 follow-up.

Only this addendum was written. No source, test, workflow, control record, snapshot, build, OCI image, SBOM, or release artifact was edited or regenerated.

## Verdict

**Local verdict: PASS_WITH_LIMITATIONS.** The reviewed local contracts, focused tests, PDP/authoritative-write/audit-chain checks, Ed25519 verification paths, and the production Compose render are coherent and passed within their local scope. The repository is not locally release-clean: `npm run verify:static` failed because three operational-proof files no longer match the committed evidence snapshot, and snapshot hydration does not strictly reject a quarantined diagnostic result or unknown top-level fields.

**Global verdict: AAA_NOT_PROVEN.** No external provider or DeepSeek proof bundle, trusted external evidence root, secret-authority run, remote OCI/Trivy/SBOM/provenance execution, staging transaction, authenticated restart smoke, independent approval, or production observability/recovery evidence was available in this rerun. Local checks cannot substitute for those gates.

## Checks executed

- `npm run typecheck` — passed.
- `git diff --check` — passed.
- Focused unit set covering evidence boundaries, container smoke helpers, provider/DeepSeek proofs, promotion, AAA, production configuration, and domain behavior — **41 passed, 0 failed, 0 skipped**.
- `npm run verify:pdp-universal` — passed (`68` request-bound operations, `70` registered rules, `41` governed collections in the current guard scope).
- `npm run verify:authoritative-writes` — passed; tamper rejected.
- `npm run verify:audit-chain` — passed; tamper rejected.
- `docker compose -f docker-compose.yml -f docker-compose.production.yml config --format json` with synthetic required variables — rendered successfully. It showed four `external: true` secrets and the expected API/worker mounts; no service was started.
- `npm run verify:static` — **failed**. The snapshot digest and mtime disagree with the current bytes for `security-red-team-local.json`, `resource-pressure-local.json`, and `runbook-execution-local.json`.
- `npm run verify:container-smoke` — blocked with no explicitly supplied URL; no live transaction or restart proof was claimed.
- `npm run verify:provider-real` and `npm run verify:deepseek-real` — blocked because the external evidence URL/file, trusted public key, and same-checkout proof bundle were not supplied.

No command that writes a snapshot, build, SBOM, OCI tar, release manifest, or other artifact was run.

## Findings by correction

### External receipts and binding

The provider and DeepSeek proof contracts require ordered stages, current timestamps, evidence digests, source-checkout SHA, independent attribution, limitations, and Ed25519 attestations. The promotion and Triplo AAA paths additionally bind the artifact digest, provenance digest/path, gate receipts, human approval, and external evidence bytes. Focused positive and negative tests passed, including signature and tamper cases.

This is a valid local verification design. It is not an external proof: no trusted external key/evidence bundle or independently executed receipt chain was present. The lower-level provider/DeepSeek proof objects primarily bind source SHA and stage evidence; the artifact/provenance binding is enforced by the promotion/AAA wrapper.

### OCI CI

The workflow builds API and web as OCI tar outputs with the checkout SHA, disables local image-ID publication, scans the OCI tar with Trivy, checks the OCI index digest, generates the SBOM, and verifies release provenance. Static workflow and helper tests passed. No remote CI execution, OCI tar, Trivy result, SBOM, or signed release-provenance manifest was observed locally, so this remains an unproven external gate.

### Container smoke and restart

The smoke implementation has the expected fail-closed headers/auth/CSRF/cookie checks and authenticated transactional path, including provider/DeepSeek health, effect/audit identifiers, and post-restart health checks. The no-URL run correctly stopped as `CONTAINER_SMOKE_BLOCKED`. There is no live external endpoint in this worktree. The script also does not independently re-query the same receipt/effect after restart to prove no duplicate replay; that is an evidence limitation even when the probe is later run.

### Prompt and evidence snapshot

The prompt reference and expected SHA are wired into the snapshot verifier. The current local snapshot is stale for the three files named above: byte digests and mtimes differ. Until an authorized evidence-generation run refreshes and re-verifies that snapshot, the local operational evidence bundle must not be promoted.

### Compose external secrets

The production Compose model declares `cvg-deepseek-bearer`, `cvg-deepseek-context`, `cvg-recovery-key`, and `cvg-messaging-credential` as external secrets and mounts the expected references into API/worker services. The synthetic config render passed. This establishes configuration shape only; existence, authority, rotation, and runtime access of the external secret provider remain unproven.

### Diagnostic quarantine and strict validation

The normal domain write path quarantines an invalid diagnostic result outside the authoritative diagnostic-result collection, and the focused test passed. Authoritative relationship/tamper checks also passed.

There is a remaining read-boundary integrity gap. `parseSnapshot` accepts unknown top-level fields and does not validate diagnostic-result status; `validateAuthoritativeSnapshot` checks relationships but does not reject `status: "QUARANTINED"`; and persistence `loadLatest`/application hydration does not re-run the strict aggregate validator. A read-only fixture changed a valid result to `QUARANTINED` and added an unknown field, then observed:

```text
authoritative: ACCEPTED
parser: ACCEPTED
diagnosticStatus: QUARANTINED
```

Thus normal creation is quarantined correctly, but a malformed or tampered snapshot can reintroduce a quarantined result into `StoreSnapshot`. This remains a high-severity integrity residual until snapshot schema/status validation is strict at every hydrate/read boundary.

## H-01 and H-02 status

- **H-01 public-alias mutation finding: CLOSED/REPAIRED locally.** Public entity/list getters return defensive clones; mutation seams return/accept copies; direct governed-map mutation was not found in the current application/harness scan. The focused domain and authoritative-write tests passed.
- **H-02 governed-map guard: CLOSED/REPAIRED for the implemented AST scope.** The guard enumerates the current private backing maps/views, checks registry drift, resolves the tested alias/bracket/destructure/cast/mutator forms, and `verify:pdp-universal` passed. **H-02-L remains MEDIUM/advisory:** this is a static AST guard rather than a complete semantic/data-flow proof and can miss unmodeled function-parameter/return aliases, nested shorthand destructuring, or dynamic computed access.

## Residual findings

### C-01 — global AAA/promotion proof unavailable (CRITICAL)

The external evidence root, remote CI/provenance, provider/DeepSeek receipts, secret authority, staging transaction/restart, independent approval, and operational resilience gates were not supplied or executed. Global status therefore remains `AAA_NOT_PROVEN`; no production approval follows from this rerun.

### H-03 — operational evidence snapshot stale (HIGH)

`verify:static` rejects the current bytes and mtimes for three operational-proof artifacts. The local evidence inventory is invalid until regenerated and reverified by the authorized evidence process. This is a concrete local gate failure, not an external-proof claim.

### H-04 — quarantined diagnostic result can cross snapshot hydrate boundary (HIGH)

Strict relationship validation and normal write quarantine do not establish strict snapshot validation. The empirical fixture above was accepted with a `QUARANTINED` diagnostic result and an unknown top-level field, and hydration does not consistently invoke the authoritative validator. This permits re-entry of a quarantined result through a malformed/tampered snapshot.

### M-01 — static alias guard has bounded coverage (MEDIUM)

H-02 is repaired for the enumerated syntax and current registry, but the AST scan does not prove arbitrary interprocedural/data-flow alias safety. Retain this as a review limitation and extend the guard if new access patterns are introduced.

### M-02 — restart smoke does not independently prove idempotent replay safety (MEDIUM)

The smoke helper checks outcome and post-restart health/headers, but a live proof should re-query the same provider receipt/effect and verify the no-duplicate invariant after restart. No external run exists in this rerun.

## Final disposition

The repaired encapsulation/PDP controls are locally credible and the six requested correction areas have useful fail-closed implementations. The stale evidence snapshot and strict diagnostic snapshot-validation gap prevent a clean local release verdict, while absent external gates keep the global verdict at **AAA_NOT_PROVEN**.
