# Security remediation — audit of 2026-10-03

## Purpose / Big Picture

Continue the user's improvement request by fixing the reproduced SEC-AI-01
prompt disclosure and SEC-AI-02 MFA race. This is a local brownfield security
fix, not a release qualification. The historical AUD27 release program and its
external blockers remain open.

## Context and recovery

Baseline HEAD: `9aab406b164497978b05dd3aa431db49ad11677a`. Pre-existing changes
affect five `.agent` files and `artifacts/audit-2026-10-03/`; preserve them.
The audit's lead, frontend and security reports were inspected. The recorded
image-smoke next action is historical and does not address the current P1s.
The synthetic HTTP probe was rerun: the secret sentinel reached both the model
and `aiTurns` despite conversation quarantine. See
`artifacts/remediation-2026-10-03/context-before.log`.

## Scope and ownership

The lead owns context admission, the embedded runtime, corresponding tests,
this plan and evidence integration. The MFA worker owns only authentication
challenge/session methods in the domain, the MFA handler and a dedicated race
test. File ownership is disjoint. A fresh reviewer will inspect the integrated
patch. No real credentials, providers, data, deployments, commits or historical
artifact rewrites are authorized by this unit.

## Frozen acceptance

1. SEC-AI-01-A: the task objective is evaluated as user-supplied D2 data; content
   detected as secret material is absent from every evaluated context copy,
   including tool/assistant history and business data.
2. SEC-AI-01-B: incoming prompts detected as secret material are rejected before
   model/tool dispatch, AI session creation or prompt persistence. Errors do
   not echo the input. Normal turns, replay and idempotency continue working.
3. SEC-AI-02: current challenge state, expiration, user state and credential
   version are checked after asynchronous MFA verification. Normal MFA works;
   stale or replayed challenges cannot issue a valid session/cookie.
4. Evidence: regression tests must fail on the relevant original defect and
   pass after the change. Run affected suites, typecheck, lint, build, full
   unit/integration regression and a separate security review. Distinguish
   existing global failures from the changed behavior.

## Design decisions

Reuse the existing content detector. Reject credential-like prompts with the
existing redacted policy-error contract before any AI state write; do not store
a replacement prompt that would make idempotency ambiguous. The Context Builder
also evaluates task data and removes secrets regardless of an item's claimed
trust level. Keep existing delimited tool-result injection handling. The API
declares its dependency on the existing context workspace package. No schema,
third-party dependency, provider or deployment change is needed. Historical
data removal and universal secret detection are outside this patch's claims.

## Concrete Steps

1. Add and run context/HTTP regression tests against the original implementation.
2. Implement the context and input-admission fix while the worker fixes MFA.
3. Inspect the integrated diff and run current validation; obtain fresh review.
4. Record actual results and the next remaining audit finding.

## Progress

- Recovered the audit and reproduced SEC-AI-01 with synthetic data.
- MFA implementation assigned to an independent file owner.
- Context and admission fixes implemented; 37 focused tests passed, followed
  by three HTTP tests including the additional approval-retry case.
- MFA worker saved its patch and seven tests, then errored with a send timeout.
  The lead inspected the saved changes and ran all seven tests successfully.
- Full suite: 779 tests, 777 pass, one fail, one skip. The failure includes the
  historical composite-exit inconsistency and fingerprints stale after this
  patch. Build (including TypeScript), lint and architecture verification pass.
- Independent reviewer also errored with a send timeout and wrote no report.
  Independent review remains unavailable, not implicitly approved.
- An additional disposable-process test using the old MFA method was blocked
  by automatic safety review and was not executed. No baseline-MFA test result
  is inferred from that attempt.

## Risks and recovery

The detector is heuristic; tests prove the covered signals, not detection of
every secret or prompt injection. Production/PostgreSQL distributed behavior is
not established by in-memory HTTP tests. The audit reports an existing
`COMPOSITE_EXIT_DIVERGENT` control-plane receipt, a failed restore drill and
dependency findings. Preserve failures and append corrections; never relax a
verifier to manufacture success. Work can resume from this plan and the scoped
logs without repeating external actions, since none are performed.

## Outcomes

Local implementation and functional tests are complete. Release qualification
and independent acceptance remain incomplete. Current results, command logs,
limitations and the next recovery boundary are recorded in
`artifacts/remediation-2026-10-03/resultado.md` and `integrated-checks.json` in
that directory. The existing release controller is not advanced or silently
re-frozen by these local fixes; its incoherent receipt and stale fingerprints
must be reconciled explicitly before a release verdict.

## Follow-up — credential formats and account lockout

The user's follow-up reopens the two local fixes: expand credential detection
and prevent a locked account from completing MFA. Inspection confirmed that
quoted JSON, authorization headers, raw tokens and private keys bypass the
assignment-only detector, and that challenge consumption omits `lockedUntil`.
The active AUD27 release pointer is historical for this bounded change and is
not advanced. Existing working-tree changes and evidence remain preserved.

Acceptance: the shared detector rejects the synthetic credential-format matrix
at admission and removes all task/history/retrieval/business copies. HTTP entry,
approval retry and direct embedded execution must not dispatch or persist the
values. Ordinary clinical prompts and non-secret metadata remain usable.
MFA must reject account locks both before lookup and during an awaited resolver,
without issuing a cookie/session or clearing the lock; recovery remains usable
and an elapsed lock does not invalidate an otherwise valid pending challenge.

Implementation keeps the shared signal table and existing redacted error
contract. Account lock checks use the stored user at lookup and consumption and
apply only to MFA. No schema, dependencies, deployment or release controls change.

Regression baseline: 77 tests, 27 passed and 50 failed (including the parent of
failing HTTP subtests); both account-lock scenarios reproduced. The log and
source hashes are under `artifacts/remediation-2026-10-03/follow-up/`.
The independent reviewer terminated with `stream disconnected before completion:
ChatGPT browser stage timed out: send` and wrote no report. A subsequent separated
self-review added three regression cases for partial quoted passwords and
prefixed fields; all three failed before the additional correction.

Final verification: 107 focused tests passed; the complete suite has 841 tests,
839 pass, one fail and one skip. The remaining failure is the existing release
control-plane receipt/fingerprint qualification problem, not a passing release
gate. Build including TypeScript, lint, architecture, secret scan and diff check
passed. The final matrix has 28 synthetic credential cases and nine benign
controls. Current evidence is in `follow-up/final-checks.json` and the scoped
outcome in `follow-up/resultado.md`; earlier logs remain preserved.

The two requested local changes are implemented and their executable acceptance
is verified. Independent acceptance and broader release qualification remain
open. The next separate release action is to reconcile the old receipt and
requalify the changed source fingerprints; this follow-up does not advance or
rewrite the historical release controller.

## Report corrections — prose credentials and visible quarantine

The user's new review closes the MFA issue and requests fixes to SEC-AI-01.
Recovered the actual working tree; all earlier changes and evidence remain.
This bounded brownfield security change covers Portuguese/English prose,
AWS_SECRET_ACCESS_KEY, AKIA/ASIA, Slack-style xox prefixes, AIza, bare Basic,
Portuguese segredo, and the pwd directory false positive. The detector remains
heuristic and cannot replace minimization/redaction at the data source.

Acceptance: extend the shared positive and benign corpus, prove rejection at
HTTP/direct/retry/context boundaries, preserve ordinary prompts and isolate
the pwd exception to standalone directory output. Context item quarantine must
produce redacted aggregate metrics and a user-visible, replayable warning.
A quarantined task objective must stop the turn before model dispatch.
Preserve MFA behavior, synthetic-only tests and historical release evidence.

Evidence for this iteration is stored in follow-up/report-fixes. Capture the
new regressions first, implement, run focused and general checks, and seek a
fresh bounded review. Do not advance the unrelated AUD27 release controller.

### Independent detector review corrections

The independent report `follow-up/report-fixes/detector-independent-review.md`
requested changes for five ordinary prose false positives (D1) and quadratic
URL-scheme near-miss scanning (D2). The user's continuation authorizes closing
these findings. The last general checks also exposed a TypeScript test-input
inference error; fix its explicit type without changing runtime behavior.

Acceptance: preserve all five exact descriptions at both detector boundaries,
including uppercase variants; retain credentials before/after a benign clause
and quoted/assigned description words. Recognize custom and long URL schemes
and credentials after long near-misses without truncating the input. A bounded
subprocess CPU/scaling regression must reject the original scanner; run the
affected integration tests and refresh build, lint and general checks.

Eight new regression tests reproduced six failures before the source changes:
all five prose cases and the CPU/scaling guardrail. The paired detector scans
at 32,768 characters used 1,131.87 ms median CPU on this machine. Original
review and check records remain unchanged. New evidence is stored under
`follow-up/report-fixes/review-corrections/`. The implementation adds narrow
per-candidate description exceptions and scans literal URL delimiters before
validating their schemes; it does not discard long input or exempt whole prompts.

The first corrected subject passed 177 focused tests, build/TypeScript, lint,
architecture, secret scanning and diff checks. Full suite: 911 tests, 909 pass,
one fail and one skip; the remaining failure is the historical control-plane
receipt/fingerprint problem. Evidence is in `review-corrections/`.

The independent recheck saved its report and resolved D2, but identified two
colon-punctuation false positives under D1 and a related vocabulary example.
The agent's final delivery errored with a send timeout after saving the report.
Four added tests reproduced the remaining cases, then the prose normalization
and description vocabulary were corrected. A narrow independent punctuation
review was started. The planned final suite and a smaller local inspection
were both NOT_EXECUTED: the tool was blocked by OpenAI because its safety status
could not be determined. Do not reuse the 177-test result as proof for the last
source change. The report records this limitation; resume from the new tests
and current source without overwriting historical evidence.

Subsequent individual native commands were accepted and completed on the final
source: 184 focused tests pass; full suite 918 tests, 916 pass, one fail, one
skip. TypeScript/build, lint and architecture pass. The final scanner command
was blocked by the same indeterminate-safety tool response and did not execute;
retain its previous PASS only as prior-subject evidence. Preserve all blocked
attempts as NOT_EXECUTED rather than inferred successes.

The independent narrow punctuation reviewer completed and saved a PASS for
58 synthetic cases / 232 export calls with zero failures. The source SHA-256
is in `review-corrections/punctuation-independent-review.md`. Together with
the saved D2 recheck, the reported detector findings are resolved in their
tested scope. Heuristic limits and independent-review scope remain explicit.
The task's code changes and executable acceptance are complete. Outstanding
verification limitations are the blocked final scanner and the unrelated
release receipt/fingerprint qualification; no deployment or release approval
is implied. Current outcome: `review-corrections/resultado.md`.

## Prose policy revision — value shape and final secret scan

The user's new report requests fixing five policy-discussion false positives,
three prose gaps and final-subject scanner evidence. Preserve MFA, URL scanning,
the runtime quarantine behavior, all unrelated working-tree changes and earlier
verification records. This is a bounded BROWNFIELD security fix; no deployment.

Decision: replace the description vocabulary with a value-shape heuristic for
unquoted prose. Digits, non-sentence symbols or internal mixed case identify
candidate values; plain descriptive words do not. Quotes and explicit
assignments keep their existing checks. Recognize dele/dela/deles/delas,
optional colons after the connector and simple two-fragment values with a
credential-like second fragment. Do not claim all passphrases or short secrets
are detected; origin-side data controls remain required.

Acceptance: all reported negatives survive admission and context; the three
reported positives fail before dispatch/persistence/retry effects. A rejected
prose candidate cannot hide a later one. Quarantine HTTP returns a controlled
201/QUARANTINED and readable replay, without raw internal error text or calls to
the provider. Run focused, full, build/typecheck, lint, architecture, and the
repository-owned secret scanner on unchanged final source bytes.

Scanner inspection: scripts/verify-secrets.mjs invokes pinned Gitleaks in Docker
with --network=none, read-only repository and redacted output. The selected
Docker endpoint is the local Unix socket; no host/context overrides are set;
the pinned image is cached. The scanner itself has no OpenAI-service call.
Keep existing exceptions/scan rules unchanged and record their actual scope.
Evidence for this iteration: artifacts/remediation-2026-10-03/prose-policy/.

Implemented the value-shape predicate and narrow prose syntax extensions.
Baseline regressions: 88 tests, 33 pass and 55 fail (including parent failures).
After correction, 208 focused tests, TypeScript, lint, build and architecture
pass. Initial full run: 942 tests, 939 pass, two fail, one skip; the additional
loopback delivery failure passed unchanged in isolation and on a full rerun
without concurrent build. Rerun: 942 tests, 940 pass, one historical AUD23
receipt/fingerprint failure, one skip. Timing sensitivity is an inference,
not a proven cause; both full logs are retained.

The unchanged repository scanner executed successfully on the current sources:
history and working tree PASS, exit 0. `prose-policy/secret-scan.json` stores
execution timestamps, log hash and unchanged source hashes. The previous
final-scan gap is closed for this observed subject. The independent review of
the prose policy remains pending; integrate its actual outcome before closing
this iteration. Do not treat older reviews as approval of the new predicate.

### Continuation — PROSE-IR-1 and PROSE-IR-2 (2026-10-04)

Recovered current source and the completed independent prose review. Its FAIL
identifies overlapping introducers skipped after a rejected first candidate,
and superlinear trailing-punctuation normalization. The prior functional and
scanner results describe the previous subject; they do not close these defects.
The unrelated AUD27 state pointer remains unchanged. All user/peer edits and
historical evidence are preserved.

Acceptance: both detector exports must detect the three reported overlaps and
imperative equivalents, preserve benign descriptions and explicit values, and
remain bounded on first/second-fragment punctuation near-misses and repeated
overlaps. Test those formats through the existing shared HTTP, direct-runtime,
retry and context corpus. Replace suffix rescanning with a backwards linear
trim and keep candidate capture out of the consuming prose introducer. No
changes to MFA, runtime, scanner policy, data classes or release gates.

Evidence for this continuation: artifacts/remediation-2026-10-03/prose-policy/
review-fixes-2026-10-04/. Reproduce before correction, validate afterwards,
obtain a bounded independent recheck and run the repository scanner against
unchanged final source bytes. Heuristic language limits remain explicit.

The six selected pre-fix regressions all failed. The corrected source passed
227 focused tests, TypeScript, lint, build, architecture and diff checks. The
complete suite has 961 tests: 959 pass, one AUD23 receipt/fingerprint failure
and one skip. Neither that verifier nor its acceptance criteria were changed.
The first punctuation-family paired CPU median at 32,781 characters dropped
from 1,549.476 ms to 1.013 ms locally; first/second candidates and repeated
overlaps have bounded subprocess regression checks.

The unchanged repository scanner ran on the final source and passed Git history
and working-tree scans, exit 0. Twelve scoped source/test hashes were verified
unchanged after the run. Two combined inspection/read calls were rejected by
the tool's indeterminate-safety review; isolated reads succeeded, and the scan
itself was accepted and completed. Record these distinctions in the evidence.

The independent reviewer completed: PROSE-IR-1 PASS and PROSE-IR-2 PASS in its
bounded scope, with 59 functional cases and 90 scaling inputs up to 64 KiB. Its
detector hash matches the checked source. Current outcome and evidence:
`prose-policy/review-fixes-2026-10-04/resultado.md` and `verification-summary.json`.
The requested implementation findings are resolved; the historical release
receipt/fingerprint qualification remains open. No deployment, commit, scanner
policy change, or release approval occurred. Next separate release action:
reconcile the recorded AUD23 receipt and requalify the changed source evidence.
