# AUD27 fresh critic — Curie — 2026-09-21

Status: `FAIL/INVALID_SEAL` — review-only; no approval.

The critic inspected the current AUD27 quality bar, control plane, static, staging, license, browser, operational and provenance gates without editing the worktree. The worktree changed during the review, so the critic could not certify a sealed subject (`candidate_fingerprint: null`, `UNFROZEN_UNTIL_AUD27-004`).

Findings:

- P0: candidate remains dirty/unfrozen; exact subject and clean reproducibility are absent.
- P0: `.gauntlet/bar-aud27-v1.json` has an authority-source path/hash mismatch. Its `aud26_report_sha256` is the hash of `docs/auditoria-resultado-cvg-aud26-2026-09-21.md`, while the named `docs/auditoria-profunda-repositorio-2026-09-21.md` hashes to `0485eef7559d1bfc761636734de6dac5e442ee2ceb1381d00dd7e393faa13fff`.
- P0: static AUD26 artifacts are stale; staging/load/chaos/DR/human gates are not proven; license policy and registry/provenance gates fail or are blocked.
- P0: WebKit launch and accessibility qualification remain partial; local tests do not prove AT, rendered contrast, or real 200% zoom approval.
- P1: local observability PASS is synthetic-only and does not prove durable telemetry, live chaos, managed restore, RTO or RPO.

Non-promotional local checks passed, but no promotion claim is admitted. The immutable v1 bar was preserved; the source mismatch is recorded in `bar-aud27-v1-errata.json`.
