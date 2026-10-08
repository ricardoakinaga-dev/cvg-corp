# Independent credential-detector review

Date: 2026-10-03. Runtime: Node v24.20.0, existing local `tsx` loader.

**Verdict: CHANGES REQUESTED — two Medium (P2) findings.** The required representative credential formats, scoped directory exemption, shared matching, and content-value non-echo checks pass. Ordinary prose preservation and bounded-input performance have the failures below. This is a heuristic detector, not universal credential recognition.

Scope: `packages/agent-context/src/index.ts` signals, predicates, `containsSecretMaterial`, and `inspectUntrustedContent`; `tests/fixtures/secret-material.ts` read for acceptance coverage. The package manifest was read only to select the local runner. No source files changed, full suites duplicated, external services called, real credentials used, production actions taken, or commits created. Runtime warnings/task-stop behavior and historical release work were not reviewed.

## Findings

### D1 — Medium (P2): ordinary password-related prose is classified as secret material

Location: `packages/agent-context/src/index.ts:141`, `:143`, `:185`, `:186`.

The prose rules treat a following word of six or more characters as a value unless it appears in the small description-word set. Five independent ordinary prompts returned `true` from admission and a `SECRET_MATERIAL` finding from context inspection; expected result was `false`/no secret finding:

| Exact input | Finding detail |
| --- | --- |
| `Use a senha temporária para entrar.` | `password supplied in an instruction` |
| `Minha senha é alfanumérica.` | `password supplied in prose` |
| `My password is missing.` | `password supplied in prose` |
| `Please use password protection for this file.` | `password supplied in an instruction` |
| `Use a senha informada no formulário.` | `password supplied in an instruction` |

These are concrete false positives against the ordinary-prompt requirement; they do not contain supplied password values. Fixtures at `tests/fixtures/secret-material.ts:82`–`:84` cover selected descriptions, but not these cases. Recommendation: refine the narrow prose/reference filtering and add these negatives while retaining positives after benign occurrences in the same input. Avoid whole-input exemptions.

### D2 — Medium (P2): scheme-like near-misses cause superlinear synchronous scanning

Location: `packages/agent-context/src/index.ts:196`, used by `:200` and `:209`.

Exact generator: `'a-'.repeat(length / 2)`. This contains no credential. The URL regex's unbounded scheme class can scan and backtrack over the remaining suffix from each new word boundary. Both APIs correctly returned `false`, but doubling input length increased elapsed time by roughly four times.

Median of three calls per API, milliseconds; a 15-second process timeout bounded the probe and was not reached:

| Input characters (ASCII bytes) | Admission | Context inspection |
| ---: | ---: | ---: |
| 4,096 | 7.029 | 6.990 |
| 8,192 | 28.103 | 27.699 |
| 16,384 | 118.397 | 113.151 |
| 32,768 | 462.795 | 480.408 |

An isolation check reconstructed **the original regex literal from source line 196**, without changing source. Its single-call times were 29.864, 114.748, and 467.873 ms at 8,192, 16,384, and 32,768 characters respectively, confirming the attribution. A normal 65,536-character control took only 1.012/0.706 ms median through the two APIs.

Impact: a 32 KiB non-secret input occupies the calling thread for approximately half a second per API call. These functions contain no input-length cap. Deployment exposure and upstream limits were not inspected, so this is a demonstrated local performance/resource-exhaustion risk, not a claim of a verified production denial of service. Recommendation: bound candidate scanning or tokenize the scheme delimiter before matching; retain a small adversarial scaling check.

## Passing evidence

The independent inline harness imported the two actual exported functions using `node --import tsx --input-type=module`; it did not execute repository test suites. It exercised **57 cases: 35 positive, 17 baseline negative, and the five negative challenges above**. All 35 positives and 17 baseline negatives passed. All 57 cases agreed between admission and context inspection.

Synthetic marker `S = "ReviewOnly_Q7n9!"` was used only locally. Positive coverage included `senha é S`, `use a senha S`, `password is S`, quoted/partial prose, `AWS_SECRET_ACCESS_KEY=S`, JSON assignments, and Portuguese `segredo: S`. Identifier generators were `AKIA`/`ASIA` plus `"REVIEWONLY".padEnd(16, "0")`, `AIza` plus `"ReviewOnly".padEnd(35, "0")`, and each of `xoxb`, `xoxp`, `xoxa`, `xoxr`, `xoxs`, `xoxc`, `xoxd` followed by `-reviewonly123456`. Bare Basic used base64 of `review-user:S`, including mixed-case scheme and omitted padding.

`pwd: /home/user/projeto/src` returned false, as did ordinary multiline, CRLF, whitespace, Windows-path, and home-shorthand variants. Adding a separate `pwd`, `segredo`, AWS assignment, or prose credential returned true. Credential-before-directory, multiple directory lines, and benign prose/Basic occurrences before a credential also passed. JSON `pwd` paths, `pwd=/home/user/projeto/src`, and `password=/home/user/projeto/src` remained detectable.

Another **1,368 alternating-order paired evaluations** showed no decision instability. All 20 original signal regexes lacked `g`/`y`; accepted-match scans create a fresh global regex per search (`index.ts:161`–`:169`). Findings use fixed signal details (`:213`); synthetic-marker checks and explicit quoted-value/path checks found no content values echoed. Those checks used benign fixed item metadata.

Six large control cases, 43,698–65,536 characters, produced the expected decisions, with medians of 0.169–1.946 ms per API. They covered ordinary text, repeated standalone directories, repeated benign prose, large Basic text without a decoded colon, and credentials at the end of long ordinary/directory inputs. No truncation or directory-based bypass occurred in these controls.

## Heuristic boundaries and review limits

Additional boundary probes observed: `senha é Ab12!`, `use a senha Ab12!`, `password is Ab12!`, and `password=Ab12!` return false because the value is shorter than six characters; `senha é Ab12!x` returns true. `Basic dTpw` (synthetic `u:p`) returns false because its encoded payload is shorter than six characters, while `Basic dTpwYXNz` (`u:pass`) returns true. Unquoted `senha é secreta` returns false due to the description exception, while its quoted form returns true. `segredo é ReviewOnly_Q7n9!` returns false: Portuguese `segredo` coverage is assignment-based, not prose-based. These are explicit detection limits, not evidence of universal coverage.

The adversarial scaling probe stopped at 32,768 characters; other controls stopped at 65,536. Timing is machine-specific, not a throughput/SLA guarantee. No fuzz campaign, production-path integration, metadata-redaction guarantee, or runtime warning/task-stop implementation was evaluated.

Source SHA-256 values were unchanged between the primary probes and attribution checks:

| File | SHA-256 |
| --- | --- |
| `packages/agent-context/src/index.ts` | `c26e85abaf664830666d65c3da4c99441e7a9712c1bb3828d24bac341e9e23d4` |
| `tests/fixtures/secret-material.ts` | `0913d904da7dfe2b8d83ac5744be9d23774d8c30eebce7ea42fb33f39c3ca405` |
