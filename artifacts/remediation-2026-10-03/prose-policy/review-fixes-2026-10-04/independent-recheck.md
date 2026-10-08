# Independent recheck — PROSE-IR-1 and PROSE-IR-2

**PROSE-IR-1: PASS. PROSE-IR-2: PASS within the bounded review.** Neither original failure reproduced on the frozen source. Later synthetic credentials remained detectable, benign controls remained unflagged, and the measured scaling probes completed without the previous punctuation delay. This is a finding-specific recheck, not a runtime or release verdict.

## Subject and method

- Source: `packages/agent-context/src/index.ts`; SHA-256 **`5a1b8a9e5291163c3960339b40b7e1efcd3d89f6b253781227f1b3ad5791c551`**. Checked before and after both probe commands.
- Original report preserved: `../independent-review.md`; SHA-256 **`1f0ea2e0d2d78eb1cad02724938816c048a23fa02a4abc41e16709ab9abc6b9d`**.
- Observation window: 2026-10-04T10:25:33Z–10:27:38Z; Node **v24.20.0**. Independently constructed stdin probes imported the current source directly. No author tests were used.

Two commands used `timeout --signal=TERM --kill-after=1s`, with **15s** for functional probes and **20s** for scaling, followed by `node --import tsx --input-type=module -`. Both exited **0**; expectations, input sizes, and source hashes were asserted. Below, `M = "RecheckQ7m9"` is synthetic, **A** is `containsSecretMaterial(text)`, and **B** is `inspectUntrustedContent(text, fixedSyntheticItem).some(f => f.code === "SECRET_MATERIAL")`. All inputs were at most **65,536 UTF-8 bytes**.

## PROSE-IR-1 — Overlapping clauses

**PASS; high confidence for the exercised cases.** The patterns at source lines 225–228 now consume the introducer and inspect candidate fragments through lookahead. Rejected first fragments therefore remain available as the start of another clause. The three original overlaps, imperative variants, mixed forms, and tab/case variants passed through both exports.

Exact functional matrix: **59 inputs, all expected A/B results matched**. Each prefix below was tested with `M` appended (**true**) and with `important` appended (**false**), yielding 20 checks. Quoted strings preserve trailing spaces; `\t` means an actual tab.

```text
"password is password is "
"password is senha é "
"password is: senha dele é "
"use password use password "
"use the password use the password "
"use a senha utilize a senha "
"utilize a senha: use the password "
"use the password: senha dele é "
"password is: use a senha "
"PASSWORD\tIS:\tSENHA\tDELA\tÉ\t"
```

The five policy strings below were each tested unchanged, uppercased, and with every space replaced by a tab: **15/15 false at A and B**.

```text
a senha é importante para a segurança
the password is stored hashed
our password is rotated monthly
password is expired please reset
a senha é gerenciada pelo cofre
```

Explicit-value controls: **10/10 true at A and B**, including the intentionally unclosed quote on the fourth line.

```text
password is "ordinary words"
senha é 'ordinary words'
use a senha `ordinary words`
password is "ordinary words
password=ordinary
senha: "ordinary words"
{"password":"ordinary words"}
password is password is "ordinary words"
use password use password 'ordinary words'
password is ordinary password=ordinary
```

Suffix/continuation controls, with `M` substituted literally:

| Exact input | Expected = observed A/B |
| --- | --- |
| `password is important.!?:` | false |
| `use password important.!?:` | false |
| `password is abc ....x` | false |
| `use password abc ....x` | false |
| `password is abc ....` | false |
| `password is ab12!` | false |
| `password is ordinary words` | false |
| `password is M.!?:` | true |
| `use a senha abc 12345.!?:` | true |
| `password is ....x password is M` | true |
| `password is abc ....x use password M` | true |

The three requested supplied-value examples (`a senha dele é Zx9kLm2p`, `my password is: Hunter2!x`, `senha é abc 12345`) also returned **true/true**. These complete the 59-input matrix.

An additional **40 cycles** of `password is password is important`, `password is password is M`, `password is password is important` produced false/true/false through both exports: **120 additional paired checks**. Across **358 functional export calls**, there were **0 mismatches, 0 A/B disagreements, and 0 appearances of M in serialized findings** with the fixed synthetic metadata.

## PROSE-IR-2 — Suffix normalization and bounded scanning

**PASS for the measured range; no renewed superlinear failure observed.** Source lines 146–155 replace suffix-regex retries with a backward character loop; lines 164/169 use it for both candidate fragments. Static inspection supports a single suffix pass. Independent measurements exercise the exported functions, not an extracted or rewritten matcher.

All **18 families × 5 sizes = 90 inputs** passed at both exports, each measured **three times** with alternating A/B call order: **540 measured calls**, plus 40 small warm-up calls. Sizes were exactly **4,096; 8,192; 16,384; 32,768; 65,536 bytes**, including introducers and any later credential.

Exact construction rules (all scaling strings are ASCII): `P(prefix, suffix, N, unit=".")` concatenates prefix, repetitions of unit truncated to `N - prefix.length - suffix.length` characters, and suffix. `R(unit, tail, N)` is `(unit.repeat(Math.floor((N-tail.length)/unit.length)) + tail).padStart(N, " ")`.

| Family | Exact construction | Expected A/B | Median A/B at 64 KiB, ms |
| --- | --- | --- | --- |
| first-miss | `P("password is ", "x", N)` | false | 0.603 / 0.559 |
| first-late | `P("password is ", "x password is " + M, N)` | true | 0.212 / 0.532 |
| second-miss | `P("password is abc ", "x", N)` | false | 0.360 / 0.520 |
| second-late | `P("password is abc ", "x use password " + M, N)` | true | 0.220 / 0.538 |
| imperative-first-miss | `P("use the password ", "x", N)` | false | 0.388 / 0.566 |
| imperative-first-late | `P("use the password ", "x use the password " + M, N)` | true | 0.237 / 0.557 |
| imperative-second-miss | `P("utilize a senha abc ", "x", N)` | false | 0.478 / 0.749 |
| imperative-second-late | `P("utilize a senha abc ", "x utilize a senha " + M, N)` | true | 0.232 / 0.523 |
| trim-first-policy | `P("password is important", "", N, ".!?:")` | false | 0.670 / 0.628 |
| trim-second-empty | `P("password is abc ", "", N, ".!?:")` | false | 0.497 / 0.642 |
| trim-first-secret | `P("password is " + M, "", N, ".!?:")` | true | 0.234 / 0.602 |
| trim-second-secret | `P("use a senha abc 12345", "", N, ".!?:")` | true | 0.294 / 0.796 |
| overlap-prose-benign | `R("password is ", "important", N)` | false | 4.256 / 5.044 |
| overlap-prose-late | `R("password is ", M, N)` | true | 3.646 / 4.600 |
| overlap-imperative-benign | `R("use password ", "important", N)` | false | 2.953 / 2.870 |
| overlap-imperative-late | `R("use password ", M, N)` | true | 2.503 / 2.768 |
| overlap-mixed-benign | `R("password is senha eh ", "important", N)` | false | 3.759 / 4.451 |
| overlap-mixed-late | `R("password is senha eh ", M, N)` | true | 3.562 / 3.797 |

Representative scaling, medians A/B in ms:

| Family | 4 KiB | 8 KiB | 16 KiB | 32 KiB | 64 KiB |
| --- | --- | --- | --- | --- | --- |
| first-miss | 0.029 / 0.042 | 0.065 / 0.069 | 0.119 / 0.129 | 0.195 / 0.314 | 0.603 / 0.559 |
| second-miss | 0.026 / 0.037 | 0.047 / 0.066 | 0.089 / 0.128 | 0.175 / 0.251 | 0.360 / 0.520 |
| overlap-prose-late | 0.262 / 0.236 | 0.491 / 0.450 | 0.856 / 1.071 | 1.631 / 1.978 | 3.646 / 4.600 |
| overlap-imperative-late | 0.143 / 0.167 | 0.293 / 0.326 | 0.602 / 0.701 | 1.244 / 1.537 | 2.503 / 2.768 |

No later credential was dropped in any scaling family. The measured block completed in **345.078 ms**; the largest individual observed times were **4.552 ms (A)** and **6.326 ms (B)**. No process timeout occurred. These measurements support closure of the original bounded-input finding without claiming a formal worst-case complexity proof.

## Limits and disposition

Finite synthetic samples, one Node environment, and three timing repetitions per scaling input do not establish an SLA, behavior above 64 KiB, or every possible input. Timing noise and concurrent host work are not controlled. Findings-content checks concern M with fixed metadata, not general redaction. Plain alphabetic unquoted words/all-letter passphrases and short values remain outside the requested credential-coverage contract; no universal language or formatting recognition is asserted.

Only the current prose matching, suffix normalization, and the two exports needed to exercise them were reviewed. No source changes, commits, external calls, real credentials, scanner execution, repository-wide tests, deployments, runtime/HTTP checks, or historical/release audit were performed. The original report and other reports remain intact; this separate recheck is the only authored artifact. **Both findings can be closed for this exact source and reviewed scope.** Parent retains ownership of broad checks, final secret scan, and any release decision.
