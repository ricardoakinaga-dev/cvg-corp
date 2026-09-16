# Crítica independente — onda AUD13 (candidato `1c22c5d`, worktree modificado)

Crítico fresco, somente leitura, contexto não herdado. Limitação registrada pelo próprio crítico:
o ambiente dele não expôs execução de shell, então nenhum `npm test`, `typecheck`, `lint`, build ou
Playwright foi reproduzido por ele; os vereditos se apoiam em inspeção estática de código/testes e nos
artefatos em disco. O Lead executou os comandos e registrou em `.agent/verification.jsonl` e no gate
`.agent/gates/aud13-wave-1.json`.

## Veredito por tarefa

| Tarefa | Veredito | Nota |
|---|---|---:|
| AUD13-02 | PASS_COM_RESSALVAS | 8 |
| AUD13-03 | PASS_COM_RESSALVAS (item "prova no sujeito" não cumprido) | 6 |
| AUD13-04 | PASS_COM_RESSALVAS | 7 |
| AUD13-05 | PASS_COM_RESSALVAS | 7 |
| AUD13-06 | PASS_COM_RESSALVAS | 7 |
| AUD13-07 | PASS_COM_RESSALVAS | 7 |
| AUD13-09 | PASS_COM_RESSALVAS | 8 |
| AUD13-10 | PASS_COM_RESSALVAS | 7 |
| AUD13-29 | PASS | 9 |

Nota global da onda: **7,5/10**. Nenhum FAIL funcional comprovado.

## Achados e desfecho (correções do Lead após a crítica)

1. **AUD13-05 — retry pós-reconexão sem reload era no-op** (`use-session.ts`, estado preso em
   REVALIDATING com snapshot vazio). **Corrigido**: o efeito de reconexão agora emite `SIGNED_OUT`
   quando não há sessão pronta, e o E2E passou a exercitar reconectar→retry direto (sem reload).
2. **AUD13-05 — cliente não checava `serverRevocation === "CONFIRMED"`** (`revokeOnServer` tratava
   qualquer resposta como confirmação). **Corrigido**: o retorno do payload validado precisa ser
   `CONFIRMED`; 401 (sem sessão viva) também encerra a pendência.
3. **AUD13-10 — overload na re-derivação pós-login podia escapar como erro** (após senha válida).
   **Corrigido**: o upgrade de digest engole somente `PasswordDerivationOverloadedError`; o login
   permanece concluído com o digest legado.
4. **AUD13-07 — 768, mensagem longa e live region sem execução registrada.** **Mitigado**: o teste
   de toast agora roda em 375/768/1440, dispara mensagem longa (Exportar do financeiro) e exige
   `aria-live="polite"` no `.toast-message`.
5. **AUD13-09 — estados PARTIALLY_PAID/REQUIRES_POLICY sem prova de browser.** **Mitigado**: E2E
   novo cobre remanescente de R$ 60,00 e "Em análise" (política de estorno pendente).
6. **AUD13-06 — caminho ACCOUNT_LOCKED sem teste de cliente.** **Mitigado**: E2E devolve 429
   ACCOUNT_LOCKED, exige erro explícito e volta à etapa de credenciais.
7. **AUD13-04 — parciais/receipts sem teste de contrato.** **Mitigado**: teste de
   `apiPartialEnvelopeSchema`, `apiSuccessEnvelopeSchema`, `commandReceiptSchema` e
   `receiptReferenceSchema`; correlationId de erro preservado pelo cliente permanece coberto apenas
   estruturalmente (residual).
8. **AUD13-03 — snapshot operacional continua no SHA antigo e `verify:static` segue vermelho.**
   **Mantido por desenho**: recapturar o snapshot histórico seria forjar prova do sujeito; a falha
   atual é honesta até AUD13-34 produzir o snapshot do candidato. Residual registrado.
9. **AUD13-29 — relatórios operacionais com filtros/fonte real e soak não implementados.**
   **Mantido parcial**: buffers limitados, descarte observável e percentis por janela provados;
   tarefa marcada `PARTIAL` com próximo passo explícito.
10. **AUD13-10 — limite por IP sob concorrência real e benchmark HTTP de login não medidos.**
    **Residual**: probe de derivação (2 concorrentes, 397 ms, lag máx. 3 ms, fila rejeita
    sobrecarga) registrado; benchmark de login completo fica para carga (AUD13-36).
11. **`docs/07-plano-execucao.md:287` ainda diz "fila máxima de oito"** (contrato real: 2
    concorrentes + fila 32). Fora dos `allowed_paths` desta onda; reconciliar em AUD13-37.

## Confirmação do crítico

O crítico confirmou não ter editado, criado ou removido arquivos do produto ou do estado; usou apenas
leitura (`read`, `grep`, `glob`) e não gerou descendentes. As correções 1–3 e os testes 4–7 foram
aplicados pelo Lead depois da crítica e revalidados na regressão final.
