# Cobertura universal de PDP e idempotência

Status: `PARTIAL/CURRENT` para os boundaries implementados; cobertura universal em todos os comandos, tools e repositories ainda `NOT_PROVEN`.

## Controles já presentes

- contexto autenticado com organização, unidade, workspace, ator, sessão, alvo, propósito, policy revision e correlation;
- application PDP antes das rotas protegidas e Tool Gateway antes da execução de capability;
- escopo persistido e RLS/FORCE RLS como defesa de profundidade;
- digest/idempotency key, ledger durável, outbox, inbox, efeito externo e fencing em PostgreSQL;
- aprovação independente e quarentena para escrita de alto impacto.

## Mapa de cobertura

| Domínio | Boundary de aplicação | Tool/repository dedicado | Estado |
|---|---|---|---|
| Guardian/Patient | parcial | leituras normalizadas selecionadas | `PARTIAL` |
| Appointment/Encounter | parcial | store/transição em evolução | `PARTIAL` |
| Clinical/Diagnostic | parcial | comandos e RLS estruturais | `PARTIAL` |
| Hospitalization | parcial | comando local | `PARTIAL` |
| Medication/Stock | parcial | comando local | `PARTIAL` |
| Finance | parcial | comando local | `PARTIAL` |
| Communication | stage/approval/outbox | provider real ausente | `PARTIAL/BLOCKED` |
| Audit | boundary e ledger | cadeia tamper-evident ainda pendente | `PARTIAL` |
| AI/usage | policy/tool/runtime | adapter/custo real ausente | `PARTIAL/SYNTHETIC_ONLY` |

O próximo fechamento exige uma matriz route → operation → capability → PDP → repository → transaction → audit para 100% do catálogo, além de testes negativos entre organizações, unidades, workspaces, sessões, alvos e replay após restart. A existência de uma regra de PDP ou de RLS não é aceita como prova de cobertura de uma rota que não a invoca.

O guard executável atual é `npm run verify:pdp`: ele encontrou 62 operações vinculadas a `requestContext`, 64 regras registradas e os 12 domínios críticos. Isso prova o inventário e a presença da policy no boundary observado; ainda não prova que cada repository, mutation, export ou job fora do request HTTP revalida o PDP e persiste a auditoria correspondente.
