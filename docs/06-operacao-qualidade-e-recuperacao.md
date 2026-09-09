# CVG-Corp — Operação, qualidade e recuperação

**Estado:** TARGET/PROPOSED; targets numéricos aguardam baseline e aprovação.

Este documento transforma “State of Art” e “Triplo AAA” em comportamento mensurável. Os números abaixo são hipóteses iniciais, não SLOs contratados nem evidência de capacidade.

## 1. Quality model Triplo AAA

| Pilar | Promessa | Controles necessários | Falha que bloqueia aceite |
|---|---|---|---|
| A1 — Assistência segura | O sistema melhora percepção e documentação sem transferir decisão clínica à IA. | contexto mínimo, fontes, rascunho, revisão/assinatura, approval, estados, auditoria, fallback manual. | IA publica, prescreve, dispensa, assina ou comunica alto impacto sem autoridade humana definida. |
| A2 — Administração íntegra | A operação preserva escopo, integridade de dados e reconciliação. | tenant isolation, RBAC/ABAC, transações, versionamento, idempotência, outbox/inbox, ledger, backup/restore. | cross-scope, duplicidade clínica/financeira, saldo negativo silencioso ou histórico sobrescrito. |
| A3 — Aceleração governada | Automação é útil, controlável, observável e reversível. | profile/bundle, policy, tools, budget, approval, sandbox, jobs bounded, telemetry redigida, kill switch. | tool/MCP/skill bypassa policy, provider key desce, custo não é reconciliado ou falha vira sucesso. |

O rubric é interno e `PROPOSED`; não afirma certificação AAA, conformidade regulatória ou segurança clínica sem gate específico.

## 2. Workload de referência

Antes de medir, registrar uma amostra sintética e representativa por unidade/turno:

| Workload | Composição mínima proposta |
|---|---|
| W-A Recepção | pesquisa tutor/paciente, disponibilidade, criação concorrente, confirmação, lembrete |
| W-B Clínico | abertura de atendimento, leitura contextual, gravação de evolução, anexos e assinatura |
| W-C Diagnóstico | pedido, ingestão de resultado, validação de vínculo, revisão e notificação |
| W-D Internação | tarefas, monitoramento, handoff, transferência e alta com pendências |
| W-E Farmácia | consulta lote, reserva, dispensação, administração, devolução e inventário concorrente |
| W-F Financeiro | estimativa, cobrança, pagamento, webhook duplicado, conciliação e estorno aprovado |
| W-G IA | prompt curto/longo, retrieval, tool read, draft, approval, retry, Code Mode se habilitado |
| W-H Integração | provider lento, resposta perdida, webhook fora de ordem, credencial revogada e fila cheia |

Cada benchmark deve informar dataset sintético, volume, concorrência, distribuição de tokens/anexos/tools, cold/warm state, provider, região, versão de profile e número de repetições. Média isolada não é evidência de cauda.

## 3. Targets iniciais propostos

| ID | Target inicial | Método de medição | Estado |
|---|---|---|---|
| PERF-01 | Comandos transacionais sem integração: p95 ≤ 300 ms e erro técnico < 0,1% no workload W-A/W-B/W-E. | teste de carga com p50/p95/p99, CPU, memória e queries. | PROPOSED/TBD |
| PERF-02 | Salvamento clínico após validação: p95 ≤ 500 ms, excluindo upload e provider externo. | trace de API até commit/receipt. | PROPOSED/TBD |
| PERF-03 | Decisão de policy/cache: p95 ≤ 100 ms e sem fail-open. | teste com cache quente/frio, revogado e corrompido. | PROPOSED/TBD |
| PERF-04 | AI time-to-first-token: p95 ≤ 5 s no workload W-G; respostas completas têm limite por tipo de tarefa. | provider fixado, mesma região, amostra ≥ 30 por cenário. | PROPOSED/TBD |
| REL-01 | Disponibilidade mensal do caminho transacional crítico ≥ 99,9%, separada da disponibilidade do provider IA. | monitor sintético e SLI de sucesso por operação. | PROPOSED/TBD |
| REL-02 | RPO transacional ≤ 5 min; RTO para operação manual essencial ≤ 60 min. | exercício de restore/incident drill com relógio e dados sintéticos. | PROPOSED/TBD |
| REL-03 | Timeouts, cancelamento, retry, backpressure e poison messages têm limites bounded; uma mesma idempotency key não duplica efeito. | fault injection, fila cheia, cancelamento e property tests. | PROPOSED/TBD |
| REL-04 | Escala é medida por workload, concorrência, tokens, tools, providers e p50/p95/p99; média isolada não aprova release. | benchmark W-A…W-H com dataset e ambiente fixados. | PROPOSED/TBD |
| OFF-01 | V1 offline é somente leitura D0–D2 com lease finito; não amplia policy nem produz escrita/efeito externo. Queda breve preserva o buffer volátil enquanto o contexto é válido; somente D0–D2 classificados/autorizados ficam visíveis, e D3–D5/desconhecido ficam ocultos em quarentena; `COMPOSER_CONTEXT_LOST` (fechamento, recarregamento, saída, expiração/revogação ou falha de revalidação) purga-o. Revogação é aplicada no primeiro boundary online, antes de ler/sincronizar. | texto clínico D3 e desconhecido → desconexão → ocultação sem persistência → reconexão/revalidação; D0–D2 autorizado, ausência/expiração de lease, revogação e fechamento/recarregamento. | PROPOSED/TBD |
| SEC-01 | 100% dos casos negativos da matriz de autorização são negados sem vazamento de existência. | suíte actor/resource/action/condition em API, DB, vector, object e export. | PROPOSED/TBD |
| CLIN-01 | 100% dos atos clínicos de alto impacto exigem role/estado/approval; zero publicação de draft. | known-good/known-bad de tool e UI. | PROPOSED/TBD |
| BUD-01 | Reserva atômica e hard stop cobrem tokens, mídia, transcrição, MCP, retry e nested calls; nenhum dispatch ocorre após o limite. | provider stub, modalidades mistas, nested/retry, crash e late usage. | PROPOSED/TBD |
| BUD-02 | Ledger reconcilia reserva, usage do provider e cobrança sem duplicação, inclusive eventos tardios/fora de ordem. | crash/out-of-order/late usage e duplicate event. | PROPOSED/TBD |
| OBS-02 | 100% dos efeitos clínicos/financeiros têm correlação e audit id consultáveis; telemetry redige, expira, identifica perda e duplicação sem substituir auditoria. | amostragem ponta a ponta, known-good/known-bad e collector indisponível. | PROPOSED/TBD |

Os targets podem ser revisados apenas com change control e baseline; a revisão não deve diminuir a barra para acomodar a implementação.

## 4. Observabilidade

### Logs estruturados

Cada log operacional inclui timestamp UTC, service/version, environment, correlation id, causation id, tenant/unit/workspace pseudonimizados, actor kind, operation, status, latency, retry count, policy revision/age, budget reservation/status e dependência. Não incluir prompt integral, segredo, token, imagem ou conteúdo clínico desnecessário.

### Métricas

- API: requests, status, latência p50/p95/p99, saturação, timeout e erro por operação e dependência.
- Domínio: conflitos de agenda, `STALE_VERSION`, pendências clínicas, quarentena, saldo/ledger, reconciliação e outbox lag.
- AI: turns, tokens/uso por modalidade, provider/model/version, tool denial, approval outcome, policy age, draft accept/reject, `OUTCOME_UNKNOWN` e session flush lag.
- Segurança: cross-scope deny, break-glass, credential failure, egress deny, tool admission, prompt injection signal e kill switch.
- Workers: queue depth, oldest age, attempts, poison messages, duplicate events, reconciliation lag e dead-letter/quarantine.

### Traces e receipts

Um trace liga BFF→domínio→outbox→worker/integração ou BFF→harness→policy→approval→tool→domínio→provider. O `ToolExecutionToken` do motor é interno; as fronteiras externas usam `commandId`, `sessionId`, `auditId` e `correlationId`.

Auditoria de negócio é durável e obrigatória. Telemetria do DeepSeek pode ser `FULL`, `FEEDBACK_ONLY` ou `DISABLED`, pode perder/duplicar eventos e não substitui a auditoria.

## 5. Saúde, degradação e recuperação

### Estados operacionais

| Estado | Permitido | Bloqueado | Comunicação |
|---|---|---|---|
| `ONLINE` | operação autorizada e AI conforme policy | nada além da policy normal | status normal |
| `DEGRADED_AI` | operação manual, leituras transacionais, rascunho local explicitamente marcado | novos efeitos de AI sem provider/policy | banner + incident id |
| `DEGRADED_INTEGRATION` | registro local e fila de integração | confirmação externa sem receipt | estado `PENDING_EXTERNAL` |
| `OFFLINE_READ_ONLY` | leitura de cache D0–D2 autorizada por lease finito; buffer pré-existente só em memória: D0–D2 classificados/autorizados visíveis, demais conteúdos ocultos em quarentena conforme o [contrato de buffer em 05](05-seguranca-privacidade.md#buffer-de-composição-durante-desconexão) | edição/rascunho offline aceito ou persistido, exibição/cópia de D3–D5 ou conteúdo desconhecido/não autorizado, novo privilégio, assinatura, dispensação, cobrança, envio e sincronização de escrita | composer bloqueado, offline age, `expiresAt`, policy age, estado de revalidação, aviso visível e descarte em `COMPOSER_CONTEXT_LOST` |
| `RECOVERY` | replay, reconciliação, quarentena, operação manual priorizada | retry cego de efeito desconhecido | runbook + owner + janela |
| `LOCKDOWN` | consulta de incidentes e ações de contenção autorizadas | qualquer efeito de alto impacto | razão, autoridade e kill switch |

### Health e readiness

Readiness deve falhar se DB, policy store, secret provider, persistence necessária ou fila crítica não estiverem utilizáveis. Health informa processo vivo sem afirmar que o negócio está pronto. Checks devem distinguir `dependency unavailable`, `policy stale`, `credential unavailable`, `outbox lag` e `audit unavailable`.

### Retry e idempotência

Retry é permitido somente quando a operação é read-only, idempotente ou tem receipt/query de reconciliação. Uma reivindicação `ADMISSION_PENDING` expirada é resolvida pelo reconciliador: sem intent vira falha pré-dispatch persistida; com possibilidade de efeito vira `OUTCOME_UNKNOWN` e consulta externa. Usar limite de tentativas, backoff com jitter, deadline, circuit breaker, fila bounded e quarentena de poison messages. Não repetir automaticamente medicação, pagamento, mensagem, alteração clínica, exportação ou tool externa de resultado desconhecido.

### Backup e restore

Backups de DB, object store, vetor, auditoria e sessão devem ser criptografados, tenant-isolated e associados a versão/schema e a um `journalWatermark` de checkpoint reconciliado. Restore é executado em ambiente isolado com dados sintéticos; validar contagem, hashes, vínculos, ACL, estados, continuidade do journal corrente, eventos pós-watermark e decisões anteriores ainda não `COMPLETED`, além do replay idempotente de exclusões, restrições e revogações, outbox/inbox, ledger, auditoria e sessão. Também deve recuperar `ExportAuthorization`, `ExportOperation` e `ExportDeliveryAttempt` sem disparar novo envio, e testar a perda da tabela/store local de `LifecycleDecision` enquanto o evento ainda aponta para o registro independente. O cenário obrigatório é `backup → exclusão/restrição/revogação → restore`: nenhuma decisão posterior pode desaparecer ou ressuscitar dado/privilégio. A fault injection deve interromper antes do receipt durável, depois dele e antes/depois da transação local; em enforcement, o resultado é recuperado pelo journal de eventos e, em exportação, pelos contratos de autorização/tentativa, sempre permanecendo bloqueado ou reconciliável e nunca confirmado falsamente. O RPO/RTO acima só se torna requisito depois de evidência de exercício.

## 6. Estratégia de testes

| Camada | O que prova | Exemplos |
|---|---|---|
| Contrato/schema | campos, tipos, versões e erros estáveis | command/event/remote codecs, unknown field, `schemaVersion` |
| Unitário de domínio | invariantes sem depender de provider | estado clínico, estoque, ledger, idempotência, expectedVersion |
| Policy/security | allow/deny real no boundary | tenant, role, resource, estado, revogação, break-glass |
| Harness adapter | composição e pipeline | tool schema/output, pre/guard/approval/execute/post, cancelamento |
| Integração | DB, object, vector, outbox/inbox e provider stub | retry, duplicate, out-of-order, quarantine, receipt |
| Replay/recovery | reconstrução e continuidade | DSH session log, flush, crash repair, event version, restore |
| E2E | jornadas públicas | agenda→encounter→draft→review; medication; billing; offline |
| Red-team | conteúdo hostil e bypass | prompt injection, MCP/skill, SSRF, secret leakage, cross-scope |
| Carga/performance | cauda e saturação | W-A…W-H, p50/p95/p99, memory, queue, provider mix |
| UX/acessibilidade | operação com erro e confiança | teclado, foco, alerta, draft vs signed, offline, empty states |

Cada harness crítico deve rejeitar um known-bad e aceitar um known-good antes de ser usado como gate. Fixtures são sintéticas e não usam dados reais do CVG.

## 7. Gates de entrega

| Gate | Evidência mínima | Status atual |
|---|---|---|
| `DISCOVERY_READY` | problema, usuários, operação, restrições, unknowns e responsáveis | `IN_PROGRESS` |
| `PRODUCT_DEFINED` | PRD aprovado, workflows, regras, permissions, errors, acceptance | `PROPOSED` |
| `TECHNICALLY_SPECIFIED` | arquitetura, contratos, dados, falhas, segurança, operação e testes | `PROPOSED` |
| `IMPLEMENTATION_READY` | fatia, dependências, ownership, risk, approvals e comandos de validação | `NOT_RUN` |
| `VERIFIED` | todos os gates obrigatórios com evidência fresca e independente | `NOT_RUN` |
| `RELEASE_READY` | deploy, migration, observability, rollback, recovery e authority reais | `NOT_APPLICABLE_THIS_PHASE` |

Um documento de arquitetura pode passar `TECHNICALLY_SPECIFIED` somente quando as lacunas centrais do PRD e do modelo de dados tiverem dono e decisão; uma lista de “boas práticas” não substitui contrato.

## 8. Matriz de verificação AAA

| Pilar | Critérios | Evidência exigida | Estado desta fase |
|---|---|---|---|
| A1 | `DOC-01`, `DOC-02`, `SEC-01`, `CLIN-01`, `AAA-01`, `EV-01`, `INJ-01`, `INJ-02`, `AUTH-03`, `AUD-02`, `AI-01`, `VER-01` | proveniência de fonte/claim, jornadas com negação/recuperação, red-team, binding de approval, revisão clínica, redaction e replay versionado | `NOT_RUN` |
| A2 | `ARC-01`, `DATA-01`, `DATA-02`, `DATA-03`, `ISO-01`, `ISO-02`, `AUTH-02`, `INT-01`, `INT-02`, `BUD-02`, `AUD-01`, `REL-03`, `REL-04`, `OBS-02`, `TRACE-01`, `AAA-02`, `PLAN-01`, `DOC-03` | lifecycle por store, isolamento negativo, binding revogável, break-glass, integração/reconciliação, ledger, restore, benchmark, correlação e fingerprint | `NOT_RUN` |
| A3 | `ARC-02`, `OPS-01`, `AAA-03`, `BUD-01`, `BUD-02`, `INJ-02`, `INT-01`, `INT-02`, `AUTH-03`, `AUD-01`, `AUD-02`, `OBS-02`, `AI-01`, `REL-03`, `REL-04`, `EV-01`, `VER-01` | profile dump, registry/admission, pipeline comum de tools, approval digest, hard stop, egress, kill switch, telemetry e recuperação | `NOT_RUN` |

Todos os vinte critérios adicionados no Quality Bar v1.1 aparecem acima. A presença na matriz comprova cobertura documental do plano de prova; não converte `NOT_RUN` em aprovação de runtime.

## 9. Runbooks mínimos

Antes do piloto, criar runbooks para: provider indisponível; policy stale/corrompida; credencial revogada; tool comprometida; cross-scope suspeito; resultado clínico em quarentena; pagamento duplicado; outbox parada; sessão interrompida; perda de dispositivo; restore; SLO/error budget; break-glass; e kill switch de IA. O contrato local de SLO/error budget está em [`runbooks/slo-breach.md`](runbooks/slo-breach.md), mas sua medição e execução operacional permanecem `NOT_RUN`.

Cada runbook terá owner, pré-condições, comandos não destrutivos, métrica de decisão, janela, abort criteria, comunicação, reconciliação e confirmação de retorno. Nenhum runbook será considerado testado apenas por existir em Markdown.

## 10. Evidência atual

O corpus fornece documentação de capacidades e limitações do harness e sínteses de apresentações corporativas. O artifact local já tem health/readiness, métricas redigidas, testes de autorização do recorte, persistência sintética, leituras normalizadas, RLS forçado no catálogo de domínio, FKs compostas de proveniência organizacional, outbox/worker bounded, usage ledger idempotente, inbox atômico com assinatura HMAC injetada, efeitos externos com receipt/reconciliação, crash drill sintético após marcador de dispatch, bundle de restore AES-256-GCM com rejeição de adulteração, quarentena e E2E; ainda não há workload real, baseline, benchmark, backup operacional gerenciado, fault/crash drill de produção, red-team completo ou deploy. Portanto os targets, SLOs, RTO/RPO e veredito operacional permanecem `PROPOSED`/`NOT_RUN`, com a evidência corrente consolidada em [12](12-estado-da-implementacao.md).


## Transição entre ambientes e liberação por escopo

O [documento 11](11-transicao-para-producao.md) define a passagem da demonstração à homologação, ao piloto e à produção ampliada. Os critérios de prova deste documento continuam aplicáveis à fatia liberada. Antes do primeiro dado real, inclusive no piloto, exigir recuperação operacional demonstrada, metas acordadas, suporte, contingência e autoridade de release; o teste de bloqueio de restore de M1 não satisfaz essa exigência. Ambientes, implantação e passagens permanecem `NOT_RUN`.
