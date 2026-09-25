# AUD27 fresh critic — Herschel — 2026-09-21

Status: `FAIL` — promotion blocked; review-only; no approval.

The critic inspected the current control plane and quality gates without editing or cleaning the worktree. It found the candidate unfrozen (`candidate_fingerprint: null`, `UNFROZEN_UNTIL_AUD27-004`) and rejected sealed-subject certification because the worktree changed during review.

Critical findings:

- `.gauntlet/bar-aud27-v1.json` names the wrong AUD26 report path for its `80301c...` hash; the immutable v1 bar therefore has a recorded authority erratum.
- The semantic verifier needed a canonical manifest digest; before hardening, coordinated manifest/backlog semantic mutation was internally accepted. The digest hardening is now implemented locally but not bound to a frozen candidate.
- The default external evidence root is absent. Control-plane validation was hardened to fail closed with `EVIDENCE_ROOT_MISSING`; no synthetic root was created.
- API catalog is nominally 105 routes/80 schemas but only 2/80 payload-specific; 24/32 collections remain snapshot-primary and the migration executor is in-memory synthetic.
- License, registry/SBOM/provenance/signature, deployed container, staging/load/chaos/DR/RTO/RPO, WebKit/AT/zoom, and human approval gates remain failed or unavailable.

Disposition: `PROMOTION_BLOCKED — AAA_NOT_PROVEN`. The opinion is preserved as a fresh review receipt, not as a qualification or approval.
