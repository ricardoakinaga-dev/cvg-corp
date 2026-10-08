# Independent review: current prose credential policy

**Verdict: FAIL for the scoped matching and bounded-input criteria.** The eight explicitly requested examples and all nine focused tests pass, but independent probes demonstrate two concrete implementation failures. Review is complete; remediation and broader verification remain with the parent.

## Subject and evidence

Reviewed the current working-tree bytes of the three requested files. SHA-256 values below match the initial review and the closing subject check at **2026-10-03 23:28:12 -03:00** (2026-10-04T02:28:12Z). Runtime for executed probes: **Node v24.20.0**.

| Subject | SHA-256 |
| --- | --- |
| `packages/agent-context/src/index.ts` | `8239befdd9a6bf8bbdc5f23d6053f46a592279e770e81d85dc593bbd868a2093` |
| `tests/unit/secret-prose-policy.test.ts` | `0453623fe5012ce70f4a429f37aa442e010add244e4941690b660d149eedc3a9` |
| `tests/fixtures/secret-material.ts` | `fa8930b3bc01b5f24d050f01b1a7ff3ed33ac9b4b47ce84a78563b46974b6c6b` |

Frozen scope: unquoted value shape (digits, non-sentence symbols, internal mixed case), preserved explicit quoted/assigned values, shared matching, rejected-candidate continuation, formatting/possessive variants, and bounded input behavior. Plain alphabetic unquoted words, all-letter passphrases, and short values are not required coverage. No universal language recognition is assumed.

Executed `node --import tsx --test tests/unit/secret-prose-policy.test.ts`: **9 passed, 0 failed**, total reported duration 166.1852 ms. Independent stdin scripts ran with `timeout 15s node --import tsx --input-type=module -`, importing the current source and calling both `containsSecretMaterial(text)` and `inspectUntrustedContent(text, syntheticItem)`; the latter result means presence of a `SECRET_MATERIAL` finding. Both scripts completed with exit status 0. Scripts recorded mismatches rather than asserting them, so exit status alone is not a passing verdict.

The independent correctness script exercised **48 inputs: 35 contract checks (32 passed, 3 failed) and 13 exploratory observations**. There were **0 disagreements between the two entry points**, **0 appearances of synthetic marker `ReviewT7x9` in serialized findings**, and **0 failures across 180 alternating positive/negative repeat calls**.

| Explicit acceptance input | Expected and observed at both entry points |
| --- | --- |
| `a senha é importante para a segurança` | false |
| `the password is stored hashed` | false |
| `our password is rotated monthly` | false |
| `password is expired please reset` | false |
| `a senha é gerenciada pelo cofre` | false |
| `a senha dele é Zx9kLm2p` | true |
| `my password is: Hunter2!x` | true |
| `senha é abc 12345` | true |

Additional successful probes covered tabs, optional colon spacing, `senha delas eh`, uppercase possessive clauses, terminal ASCII punctuation, tab-separated `abc 12345`, straight/backtick quotes, partial quoted pastes, alphabetic assignments and JSON values. Normal mixed clauses passed, including `password is stored password is ReviewT7x9`, the reverse order, newline-separated clauses, and successive imperative clauses. Unquoted `ordinary`, `ordinary words`, `Ordinary`, `ORDINARY`, `ab12!`, and ordinary ASCII sentence punctuation/hyphenation remained unflagged.

## Concrete findings

### PROSE-IR-1 — A rejected candidate can consume the next credential introducer

**Priority P2; high confidence; defeats the explicit continuation requirement.** All three independently constructed overlapping-clause probes returned false at both entry points:

| Synthetic input | Expected | Observed |
| --- | --- | --- |
| `password is password is ReviewT7x9` | true | false |
| `password is senha é ReviewT7x9` | true | false |
| `password is: senha dele é ReviewT7x9` | true | false |

At `index.ts:213`, the first unquoted candidate consumes `password` or `senha`. Its shape is rejected, but the global iterator at `index.ts:193-195` resumes after that consumed word. The later valid credential clause begins inside the rejected match and is never reconsidered. The adjoining-fragment lookahead avoids consuming a second fragment, but does not protect a credential introducer consumed as the first fragment.

These are deliberately constructed overlapping clauses, not failures of ordinary separate clauses. They still violate the requested rule that rejecting a candidate must not hide a later real credential. Parent remediation should preserve bounded progress while making these later starts searchable, and add focused regression cases. No source changes were made by this review.

### PROSE-IR-2 — Punctuation near-misses cause sharply superlinear matcher cost

**Priority P2; high confidence in measured delay; availability impact beyond the local boundary is unverified.** Input construction: `'password is ' + '.'.repeat(n) + 'x'`. All results were correctly false, but synchronous execution became expensive:

| n | Input characters | `containsSecretMaterial` ms | `inspectUntrustedContent` ms |
| --- | ---: | ---: | ---: |
| 2,048 | 2,061 | 7.011 | 6.865 |
| 4,096 | 4,109 | 19.456 | 16.994 |
| 8,192 | 8,205 | 80.291 | 68.052 |
| 16,384 | 16,397 | 310.499 | 329.777 |
| 32,768 | 32,781 | 1,341.877 | 1,313.641 |

The scaling is consistent with quadratic work. The likely source is the unanchored-start trailing-punctuation replacement `/[.!?:]+$/` at `index.ts:152` (also used at line 157): the terminal `x` defeats the suffix match after long punctuation runs. This cause is supported by code inspection, not a separately isolated benchmark.

Controls stayed fast: `'password is ' + 'a'.repeat(65536) + 'x'` returned false in 1.861/1.942 ms; a credential after 65,536 characters of `a-` padding returned true in 2.137/0.470 ms; 2,048 benign clauses followed by a credential returned true in 2.558/2.241 ms. The bounded script exercised 12 input constructions, up to 65,582 characters, and completed inside its 15-second process limit. Parent remediation should remove repeated suffix rescanning and recheck this family. Timings are single local samples, not an SLA or formal complexity proof.

## Heuristic ambiguities and coverage limits

These observations are separate from the two contract failures:

- `password is rotated 2026`, `password is stored (hashed)`, and `password is caseSensitive` returned true. Their adjoining digits, symbols, or mixed case fit the chosen value-shape heuristic despite benign interpretations. They do not justify restoring a description-word allowlist.
- `password is important…` and `password is well–protected` returned true. Unicode ellipsis/en dash are treated as symbols; ASCII punctuation/hyphen controls passed. This is a punctuation-policy limitation, not a demonstrated regression in the five required policy phrases.
- `password is\u00a0ReviewT7x9`, `senha é abc\u00a012345`, and `password is\nReviewT7x9` returned false (escapes denote actual nonbreaking space/newline in the probes). Prose separators currently cover space/tab, not these variants. `password is “abc def”` also returned false: curly quotes do not receive the explicit ASCII-quote treatment.
- `the password of my account is ReviewT7x9` and `a senha do servidor é ReviewT7x9` returned false. Expanded possessive grammar is not covered; tested `dele/dela/delas` forms passed. `password is abcde!` returned false after terminal-punctuation stripping, illustrating the ambiguity around short values and sentence punctuation. `password is "ordinary".` remained protected.

The two concrete findings are current in-scope defects; this review did not compare historical implementations and does **not** establish when either was introduced. The other observations are heuristic/formatting limits, not evidence that universal language coverage is required.

This is source-level and local function-execution evidence only. No external calls, real credentials, deployments, scanner execution, full suites/build, runtime/HTTP validation, or historical release audit were performed. Findings-content checking used fixed synthetic metadata and the stated marker; it is not a general metadata-redaction proof. This report is the only authored artifact; other reports and source files were preserved. Parent owns remediation, final scan, runtime/HTTP validation, full tests/build, documentation, and any release decision.
