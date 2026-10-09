# Independent punctuation normalization recheck

Date: 2026-10-03.
Source: `packages/agent-context/src/index.ts`.
Source SHA-256: `eba42176252f82c1b57a4d1aaf8f851565ced4a0b8669e1d84f2c8bf14cd1e5c`.
Scope: `PASSWORD_DESCRIPTIONS`, `proseContainsValue`, their matching patterns, shared candidate iteration, and the two exported matching functions.

**Verdict: PASS — the reported narrow false-positive finding is resolved for the observed probes.**
Harness: independent inline synthetic harness; Node v24.20.0 with `--experimental-transform-types --input-type=module`; direct imports of both current exports.
Coverage: 58 distinct probes (19 negatives, 39 positives), repeated in forward/reverse order: 116 executions, 232 export calls, zero failures.
Assertions: negatives require `containsSecretMaterial=false` and `inspectUntrustedContent=[]`; positives require `true`, `SECRET_MATERIAL`, and the expected matching detail.
Source hash was identical before import, after import, and after all probes.

| Observed probes | Count | Result through both exports |
| --- | ---: | --- |
| `Minha senha é temporária: como alterar?` | 1 | Negative; no findings |
| `My password is missing: how can I reset it?` | 1 | Negative; no findings |
| `Use a senha definida no cadastro.` | 1 | Negative; no findings |
| Three descriptive templates with upper/lower/mixed case and trailing `:`, `.`, `!`, `?`, `.!?:` | 15 | All negative; no findings |
| Quoted prose/instructions using `missing:`, `temporária:`, `definida.` with double, single, and backtick quotes | 9 | All positive; expected prose/instruction detail |
| Explicit assignments, including `password="missing:"` and `password=missing:` | 8 | All positive; credential assignment detail |
| Synthetic prose/instruction credential before/after each benign clause, separated by semicolon or newline | 12 | All positive; expected same-rule detail |
| `password=missing:` before/after each original benign clause | 6 | All positive; credential assignment detail |
| Multiple filtered candidates followed by a credential (4); all-benign combined text (1) | 5 | Four positive; all-benign case negative |

Later-candidate checks used only `SYNTHonly42!` or explicitly quoted `missing:`; filtering one or two benign candidates did not hide later credentials in these probes.
Inspection agrees: trailing `[.!?:]+` removal and lowercasing apply to the unquoted candidate; quoted captures remain accepted, and assignments use their own pattern. Candidate iteration continues after rejection.
Runner note: the initial import failed before probes with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter property in strip-only mode); local runner help confirmed the transform flag, and the rerun completed successfully.
Limits: bounded heuristic English/Portuguese examples, not universal language coverage or a general detector/security verdict. No URL benchmarks, broad history/review, repository suites, external calls, real credentials, deployments, or source edits were performed.
Full tests/build are parent-owned and were not assessed in this recheck.
