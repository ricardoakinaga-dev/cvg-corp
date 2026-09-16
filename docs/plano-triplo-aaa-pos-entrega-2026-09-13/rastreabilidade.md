# Rastreabilidade e migração de aceites

| Achado atual | Tarefas |
|---|---|
| E01 — Prescrição concluída ainda dispensa e pode ser reaberta | AAA2-02 |
| E02 — Uso acima da reserva não entra integralmente no teto | AAA2-03 |
| E03 — ACP admite sem budget e perde vínculo de reserva após recriação | AAA2-04 |
| E04 — Conclusão ACP aceita autoridade revogada durante a execução | AAA2-05 |
| E05 — Adendo de outro paciente permanece na linha do tempo | AAA2-06 |
| E06 — Histórico omite adendos de documentos assinados anteriores | AAA2-06 |
| E07 — Perfil estoque não alcança a dispensação disponível | AAA2-07 |
| E08 — Internação planejada fica sem caminho de admissão | AAA2-08 |
| E09 — Leitura de documento assinado abre diálogo sem foco interno | AAA2-09 |
| E10 — Gate estático e aceite independente não fecham o candidato atual | AAA2-01, AAA2-10, AAA2-31 |
| E11 — Cobertura autoritativa continua com 24 coleções primárias em snapshot | AAA2-11, AAA2-12 |
| E12 — Readiness não discrimina capacidades e usa estados fixos | AAA2-19 |
| E13 — Runbook marca EXECUTED_LOCAL a partir de texto | AAA2-22 |
| E14 — Workload de carga não exercita as escritas exigidas | AAA2-23 |
| E15 — Configuração de alerta ainda não tem renderização demonstrada | AAA2-21 |
| E16 — Jornadas e governança têm escopo obrigatório ainda parcial | AAA2-13, AAA2-14, AAA2-15, AAA2-16, AAA2-17, AAA2-18, AAA2-20 |
| E17 — Prova operacional, supply chain e aceite final continuam ausentes | AAA2-24, AAA2-25, AAA2-26, AAA2-27, AAA2-28, AAA2-29, AAA2-30, AAA2-31, AAA2-32 |
| E18 — Exames concluídos no backlog ainda omitem semântica do UC03 | AAA2-33 |

## Reconciliação dos 38 contratos e 6 filhos

| Legado | Estado declarado | Tratamento | Contratos novos |
|---|---|---|---|
| AUD13-01 | DONE | CONTINUE_WITH_NEW_CRITERIA | AAA2-01 |
| AUD13-02 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-03 | DONE | CONTINUE_WITH_NEW_CRITERIA | AAA2-10 |
| AUD13-04 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-05 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-06 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-07 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-08 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-09 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-10 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-11 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-12 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-13 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-14 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-06, AAA2-09, AAA2-13 |
| AUD13-15 | DONE | REOPEN_AFFECTED_ACCEPTANCE | AAA2-33 |
| AUD13-16 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-02, AAA2-07, AAA2-08 |
| AUD13-17 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-02, AAA2-07 |
| AUD13-18 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-16 |
| AUD13-19 | DONE | PRESERVE_AND_REGRESSION | AAA2-29, AAA2-31 |
| AUD13-20 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-17 |
| AUD13-21 | DONE | REOPEN_AFFECTED_ACCEPTANCE | AAA2-01, AAA2-03, AAA2-04 |
| AUD13-22 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-11 |
| AUD13-23 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-12 |
| AUD13-24 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-24 |
| AUD13-25 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-18 |
| AUD13-26 | DONE | CONTINUE_WITH_NEW_CRITERIA | AAA2-25 |
| AUD13-27 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-04, AAA2-05, AAA2-26 |
| AUD13-28 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-25 |
| AUD13-29 | PARTIAL | CONTINUE_WITH_NEW_CRITERIA | AAA2-20 |
| AUD13-30 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-19 |
| AUD13-31 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-21 |
| AUD13-32 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-22, AAA2-23 |
| AUD13-33 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-28 |
| AUD13-34 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-10, AAA2-27 |
| AUD13-35 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-09, AAA2-29 |
| AUD13-36 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-23, AAA2-30 |
| AUD13-37 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-01, AAA2-10, AAA2-31 |
| AUD13-38 | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-32 |
| AUD13-14A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-13 |
| AUD13-16A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-08, AAA2-14 |
| AUD13-17A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-15 |
| AUD13-18A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-16 |
| AUD13-20A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-17 |
| AUD13-25A | PLANNED | CONTINUE_WITH_NEW_CRITERIA | AAA2-18 |

A relação substitui duplicação de execução: acrescentar critérios à tarefa compatível ou criar filho com origem explícita; não manter dois status. Toda melhoria preservada também entra na regressão final.

## Requisitos e barra

A [matriz anterior de todos os 22 FRs e 13 NFRs](../plano-melhorias-2026-09-13/rastreabilidade.md) continua normativa para cobertura. A tabela acima fornece a ponte total de cada AUD13 para AAA2; os critérios originais são herdados, inclusive quando uma tarefa nova refina apenas parte do trabalho. AAA2-31 deve materializar a matriz de evidência de cada requisito, sem concluir por simples associação de IDs.

As 39 fases, 25 gates e 22 dimensões da barra v4 permanecem obrigatórias. Dimensões clínicas/dados/segurança priorizam AAA2-02–18; operação e supply chain AAA2-19–30; integração e decisão AAA2-31/32. Falta de prova em qualquer fase obrigatória impede promoção.
