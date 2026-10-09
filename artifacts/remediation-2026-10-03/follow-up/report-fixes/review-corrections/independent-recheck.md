# Independent detector recheck — D1 / D2

Date: 2026-10-03. Runtime: Node v24.20.0 with the existing local `tsx` loader.

**Verdict: CHANGES REQUESTED. D1's original five examples are corrected, but a closely related punctuation false positive remains Medium (P2). D2 is resolved within the bounded review.** The original `detector-independent-review.md` is preserved.

Scope: detector signals/predicates and the two exports in `packages/agent-context/src/index.ts`; acceptance fixtures and the two new regression files were read. Three independent inline local probes ran with `timeout 12s node --import tsx --input-type=module` (functional and scaling probes) and an 8-second timeout (focused confirmation). All exited 0 without reaching their timeouts. No repository suites or author scaling fixture were executed; parent-owned regression/build checks remain separate. No source edits, credentials from real systems, network/service calls, production actions, commits, or deployments occurred.

## D1 — partially corrected; one remaining P2 blocker

The five original inputs now return `false` from `containsSecretMaterial` and no `SECRET_MATERIAL` from `inspectUntrustedContent`:

| Exact original input | Admission / context-secret |
| --- | --- |
| `Use a senha temporária para entrar.` | false / false |
| `Minha senha é alfanumérica.` | false / false |
| `My password is missing.` | false / false |
| `Please use password protection for this file.` | false / false |
| `Use a senha informada no formulário.` | false / false |

**Remaining blocker:** the same accepted descriptive words followed by a colon are falsely classified as credentials. Source: `index.ts:149` strips only `[.!?]+`; the unquoted capture at `index.ts:203` includes `:`, so `missing:` and `temporária:` do not match the description set at lines 141–146.

| Exact independent input | Expected | Actual admission / context-secret | Finding detail |
| --- | --- | --- | --- |
| `Minha senha é temporária: como alterar?` | false / false | true / true | `password supplied in prose` |
| `My password is missing: how can I reset it?` | false / false | true / true | `password supplied in prose` |

Focused confirmation isolated punctuation: `My password is missing.` and `Minha senha é temporária.` return false/false; changing only the final period to a colon returns true/true. These are ordinary descriptions, not supplied values. This is a narrow extension of the demonstrated D1 failure, not a demand for universal language recognition. Handle descriptive punctuation without exempting explicit quoted/assigned credentials; preserve mixed-clause detection.

Positive checks remained intact: `password is "missing:"`, `password=missing:`, `senha é "temporária:"`, and `senha=temporária:` all return true/true. Across the five new exception words (`temporária`, `alfanumérica`, `missing`, `protection`, `informada`), 35 quoted, partially quoted, backtick, assignment, colon-assignment, and JSON checks also passed.

An additional independent sentence, `Use a senha definida no cadastro.`, returns true/true (`password supplied in an instruction`); record this as remaining vocabulary coverage in the explicitly heuristic detector, not a separate blocker. `Minha senha é alfanumérica...` and `My password is missing?!` both pass as negatives.

### Functional evidence beyond the author's corpus

Synthetic value `S = "Independent_Recheck7!"`. The independent functional probe contained 129 cases: 124 core checks all passed; five extra challenges produced the two punctuation failures, one vocabulary false positive, and two passing punctuation negatives above.

| Group | Cases / passed |
| --- | ---: |
| Original five negatives; uppercase and tab-separated variants | 15 / 15 |
| Credentials before/after each benign clause | 40 / 40 |
| Explicit quoted/assigned description words | 35 / 35 |
| Existing credential-format acceptance | 18 / 18 |
| Directory lines mixed with credentials | 5 / 5 |
| Baseline ordinary prompts, standalone directories and Basic prose | 11 / 11 |
| Additional heuristic challenges | 5 / 2 |

Mixed-clause generators used each original sentence followed by, or preceded by, `senha é S`, `use a senha S`, and `password is S`, plus a following `AWS_SECRET_ACCESS_KEY=S` or preceding `segredo: S`. Every positive remained detectable.

Acceptance positives independently generated AKIA/ASIA identifiers as prefix + `"RECHECK".padEnd(16,"0")`, AIza + `"Recheck".padEnd(35,"0")`, seven `xox[bparscd]` variants + `-independentrecheck123`, and bare Basic from base64 of `recheck-user:S` (including mixed-case/unpadded and benign Basic preceding the value). AWS/segredo assignments and password-shaped directory values also passed. Standalone `pwd: /home/user/projeto/src`, Windows/home paths, and CRLF variants were preserved; separate credentials before/after directory lines remained detectable.

All 129 cases agreed between the exports. Another **1,548 paired evaluations**, alternating traversal order, reproduced the same decisions without instability. The 20 shared regex literals have no `g`/`y`; `matchesSignal` creates a fresh search regex for predicates (`index.ts:179`–187). Checks for each applicable synthetic credential value in serialized findings found **zero echoes**, using fixed benign item metadata. Source line 231 emits fixed signal details.

## D2 — resolved in bounded independent testing

The signal now starts at literal `://` (`index.ts:214`); `credentialUrlHasScheme` checks the preceding scheme (`index.ts:166`–177). This removes the old scan from every scheme-like word boundary.

Exact original generator: `'a-'.repeat(n / 2)`. Five repetitions per input; medians in milliseconds. Both exports returned false throughout. Wall medians are computed separately; process CPU covers the pair.

| ASCII characters | Admission wall | Context wall | Paired wall | Paired CPU |
| ---: | ---: | ---: | ---: | ---: |
| 4,096 | 0.034 | 0.059 | 0.099 | 0.107 |
| 8,192 | 0.060 | 0.113 | 0.181 | 0.192 |
| 16,384 | 0.121 | 0.198 | 0.321 | 0.324 |
| 32,768 | 0.243 | 0.372 | 0.673 | 0.680 |
| 65,536 | 0.527 | 0.876 | 1.407 | 1.349 |

The previous approximately half-second 32 KiB scan was not reproduced. Independently selected additional families exercised long valid/invalid scheme lookback, missing userinfo delimiters, repeated incomplete URLs, and actual credentials after many invalid candidates. Each family ran at 8,192, 16,384, 32,768, and 65,536 characters, five repetitions each. All expected decisions passed.

| Family | Expected | Paired CPU at 8 / 16 / 32 / 64 KiB (ms) | Paired wall at 64 KiB (ms) |
| --- | --- | --- | ---: |
| Long invalid scheme lookback | false | 2.804 / 1.695 / 4.568 / 8.051 | 8.038 |
| Long valid scheme lookback | true | 0.915 / 2.379 / 4.579 / 7.997 | 8.018 |
| Missing username separator | false | 0.180 / 0.357 / 1.247 / 2.492 | 2.479 |
| Missing userinfo terminator | false | 0.155 / 0.424 / 1.145 / 2.375 | 2.361 |
| Many incomplete URLs | false | 0.118 / 0.245 / 0.952 / 1.921 | 1.909 |
| Invalid candidates then credential | true | 0.217 / 0.864 / 1.660 / 3.410 | 3.418 |

Exact generators, where `n` is total characters, `suffix = "://review-user:" + S + "@example.test/p"`, `url = "git+ssh" + suffix`, and `fill(s,n)` repeats/truncates `s` to length `n`:

```js
"9".repeat(n - suffix.length) + suffix
"a" + "9".repeat(n - suffix.length - 1) + suffix
"https://" + "u".repeat(n - 8)
"https://u:" + "v".repeat(n - 10)
fill("r+v1://u:missing ", n)
fill("9://u:unused@h ", n - url.length - 1) + " " + url
```

A separate 93-case URL matrix compared both exported decisions with the original URL signal on bounded strings. It crossed 14 schemes/prefixes (`https`, `HTTP`, `postgresql`, `git+ssh`, `custom.v2`, `a`, `x-`, `a.1+2`, `9`, `9abc`, `_abc`, `scheme `, `.`, empty) with six userinfo forms (`review-user:S@example.test/p`, `u:p@h`, `user@host/p`, `host:443/p`, `host:443?x=y`, `u:missing`), plus nine mixtures/path/query/percent-encoded examples and credentials after near-misses. **Zero prior-signal differences, shared-decision disagreements, or sentinel echoes.** This checks behavioral preservation, not URL validity against an external standard.

## Source identity and limitations

SHA-256 values below were unchanged between initial inspection and post-probe confirmation:

| File | SHA-256 |
| --- | --- |
| `packages/agent-context/src/index.ts` | `addd9b04c56dcd7e1434f895168e308748cb8c4d37e1f08206b4630ffb28e044` |
| `tests/fixtures/secret-material.ts` | `826b6cf7229827809d3fd69ea905c932eae1e11d0173de48fdf3995963ec5b6e` |
| `tests/unit/secret-detector-review.test.ts` | `bc9c26f4bf9aa5ca492646045760652d898c7ad36c6ab37d5fe11cd8c835f5d7` |
| `tests/fixtures/secret-detector-scaling.ts` | `83087250c5f3687bb190317660f67b6df163772c97a7933086aed434ac0108f7` |
| Preserved `report-fixes/detector-independent-review.md` (7,412 bytes) | `53f355f6a650717388031603bba965f177b982728e4b41a5819f661b614756b7` |

Timing is local and affected by JIT, scheduling, and concurrent parent checks; this is neither an SLA nor an asymptotic proof. Inputs were capped at 65,536 characters; no exhaustive fuzzing or production-path integration was performed. Matching remains heuristic, with existing length/prefix and vocabulary limits. The non-echo result covers content values with benign metadata, not arbitrary provenance/identifier redaction. **Runtime warning/task-stop behavior and its implementation/tests are outside this review and were not verified.**
