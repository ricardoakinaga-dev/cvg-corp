# Agent evals — golden dataset sintético

Cenários veterinários sintéticos, versionados e determinísticos, usados por
`npm run verify:agent-evals`. Nenhum dado real de paciente é usado.

## Estrutura

```text
evals/
  golden/*.json     cenários declarativos
```

Cada cenário declara:

- `purpose`, `prompt`, `patientId`/`encounterId` opcionais e `requestedTool` opcional;
- `steps`: roteiro determinístico do `MockModelProvider` (`message` ou `tool`);
- `executor`: comportamento do executor de tool (`default` ou `outcome-unknown`);
- `expect`: status final do turno, approval, policy denial, receipts, draft, quarentena e
  trecho de resposta.

## O que é avaliado

| Dimensão | Como |
| --- | --- |
| Task completion | `expect.turnStatus = COMPLETED` |
| Policy compliance | `expect.policyDenied` e `expect.turnStatus = DENIED` |
| Tool correctness | `expect.toolReceipts` (receipts duráveis `tool.*` com status `SUCCEEDED`) |
| Human-in-the-loop | `expect.approval = true` com turno `RECEIVED` |
| Safety / prompt injection | `expect.quarantined = true` |
| Draft | `expect.draft = true` para `DRAFT_CLINICAL` |
| Outcome unknown | `expect.turnStatus = OUTCOME_UNKNOWN` quando o executor perde o resultado |
| Latência/custo | `observed.tokens`, `observed.stopCondition` (registrados no artefato) |

## Differential evals (shadow, Macrofase H)

Cenários com `"differential": true` são executados nos dois runtimes locais:
`MockHarnessAdapter(GovernedHarness)` e `EmbeddedAgentRuntime(MockModelProvider)`.
A comparação é estrutural (classe de resultado, decision de tool, approval),
nunca textual — o provider externo não é chamado.

## Limitações

- Provider real e harness externo exigem credenciais e ambiente autorizado
  (`BLOCKED_EXTERNAL`); o corpus não substitui `verify:embedded-deepseek`.
- Os cenários são sintéticos; nenhuma conclusão clínica é derivada deles.
