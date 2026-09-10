# Cobertura universal de PDP e idempotência

Status: `PARTIAL/LOCAL-GUARDED` para os boundaries implementados; a admissão durável dos comandos retryable cobertos está composta, mas a cobertura universal distribuída em todos os comandos, tools e repositories ainda `NOT_PROVEN`.

## Controles já presentes

- contexto autenticado com organização, unidade, workspace, ator, sessão, alvo, propósito, policy revision e correlation;
- application PDP antes das rotas protegidas e Tool Gateway antes da execução de capability;
- o `GovernedHarness` local chama `ToolGateway.execute()` — não apenas `authorize()` — com executor `LOCAL_ONLY`, timeout e `CvgStoreToolExecutionLedger`; o receipt de tool fica no ledger de comandos e é coberto por teste de alto impacto;
- escopo persistido e RLS/FORCE RLS como defesa de profundidade;
- digest/idempotency key, ledger durável, outbox, inbox, efeito externo e fencing em PostgreSQL;
- `AgentApplicationService`, repositories de leitura, `DomainCommandService` e `ExportApplicationService` revalidam o application PDP; exportações usam chave resolvida por referência, AES-256-GCM e manifesto de recuperação;
- `DurableIdempotencyService` centraliza claim/replay/conflict/settlement para as mutações retryable da API, os comandos de IA e `ops.export`; `clinical.sign` mantém sua variante especializada com a mesma autoridade durável;
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

## Atualização — 2026-09-10 — boundary durável de comandos

`apps/api/src/application/idempotency-service.ts` foi conectado como limite
único do runtime. Em PostgreSQL, a chave é admitida como `IN_FLIGHT` antes do
callback por `claimCommandReceipt`; replay confirmado não chama o trabalho,
corpo divergente retorna conflito, claim concorrente retorna
`OUTCOME_UNKNOWN` e falha pré-commit é assentada. O teste de integração de
encounter observou dois claims para a mesma chave e apenas um DML autoritativo.

Isso reduz a lacuna de idempotência local, mas não prova concorrência
multi-processo em PostgreSQL, restart/crash recovery, exactly-once de provider,
staging ou AAA. Emissão/revogação de credenciais e webhooks permanecem com
semânticas específicas, conforme ADR 019.

## Atualização — 2026-09-10 — guard universal e harness

O guard foi ampliado para analisar por AST todos os `ApplicationService`, o
`DomainCommandService` e o `GovernedHarness`. Cada método público precisa de
enforcement direto ou de uma delegação estática para `run`/`authorize`; cada
operação é resolvida contra o registry canônico. Fixtures known-good e
known-bad cobrem serviço sem PDP, operação desconhecida, operação dinâmica e
delegação enumerada.

O `GovernedHarness` agora aplica o mesmo PDP nos lifecycle operations de sessão,
turno, aprovação, promoção e replay. `health` é a única exceção anotada, pois
é metadata de readiness sem acesso a dados ou recursos. A divergência de
`ai.approval.retry` também foi corrigida na aplicação, alinhando rota,
contexto, policy e receipt.

`verify:pdp` tornou-se gate explícito de `verify:m1`, `verify:production` e CI.
O worker continua com a exceção arquitetural documentada: sua autoridade é o
job/outbox durável já admitido, com tenant, lease, fencing, backpressure e
effect ledger; ele não recebe uma sessão de usuário sintética. A verificação
local não transforma isso em prova de PDP de ator/sessão para worker.

## Atualização — 2026-09-10 — Guardian command-owned write

`POST /api/v1/guardians` agora atravessa `GuardianApplicationService` e um
`GuardianRepository` tipado. Em PostgreSQL, o resultado novo é gravado como
`normalizedGuardianWrite` no mesmo commit do snapshot, journal, auditoria,
receipt e outbox; o UPSERT exige escopo completo, igualdade dos campos e
`RETURNING`. O ID command-owned é removido da projeção genérica. Replay usa
`normalizedGuardianReplayId` e não repete Guardian DML.

Isso melhora a linha de escrita do contexto Guardian, mas não fecha
`V3-DATA-001`: os demais contextos ainda dependem parcialmente da projeção
genérica e concorrência PostgreSQL/RLS multi-processo, staging, provider,
telemetria operacional e aceite humano continuam sem prova.
