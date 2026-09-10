# Cobertura universal de PDP e idempotência

Status: `PARTIAL/LOCAL-GUARDED` para os boundaries implementados; cobertura universal em todos os comandos, tools e repositories ainda `NOT_PROVEN`.

## Controles já presentes

- contexto autenticado com organização, unidade, workspace, ator, sessão, alvo, propósito, policy revision e correlation;
- application PDP antes das rotas protegidas e Tool Gateway antes da execução de capability;
- o `GovernedHarness` local chama `ToolGateway.execute()` — não apenas `authorize()` — com executor `LOCAL_ONLY`, timeout e `CvgStoreToolExecutionLedger`; o receipt de tool fica no ledger de comandos e é coberto por teste de alto impacto;
- escopo persistido e RLS/FORCE RLS como defesa de profundidade;
- digest/idempotency key, ledger durável, outbox, inbox, efeito externo e fencing em PostgreSQL;
- `AgentApplicationService`, repositories de leitura, `DomainCommandService` e `ExportApplicationService` revalidam o application PDP; exportações usam chave resolvida por referência, AES-256-GCM e manifesto de recuperação;
- `verify:pdp` compara o catálogo de rotas protegidas, operações dinâmicas de IA, capabilities server-side, worker com fence e recovery/export boundary;
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
| AI/usage | policy/tool/runtime | usage/provenance duráveis e replay local; provider/custo externo ausente | `PARTIAL/SYNTHETIC_ONLY` |
| Governed export | `ops.export` + idempotency | `ExportApplicationService` + recovery envelope criptografado | `PARTIAL/POSTGRES-BLOCKED` |

O próximo fechamento exige uma matriz route → operation → capability → PDP → repository → transaction → audit para 100% dos repositories/jobs ainda não cobertos, além de testes negativos entre organizações, unidades, workspaces, sessões, alvos e replay após restart. A existência de uma regra de PDP ou de RLS não é aceita como prova de cobertura de uma rota que não a invoca.

O guard executável atual é `npm run verify:pdp`: ele encontrou 68 operações vinculadas, 70 regras de aplicação, 6 policies canônicas de tools e os 12 domínios críticos. O guard compara o catálogo de rotas protegidas e de tools com a policy canônica — risco, capability, approval, roles, classes, escopo, recurso, idempotência, auditoria e egress — e exige controles de worker fenced e recovery/export. Isso prova o inventário e a presença da policy nos boundaries observados; ainda não prova concorrência PostgreSQL real em todos os repositories/jobs, nem substitui um turno DeepSeek real.
