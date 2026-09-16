# Threat model — Agent Runtime embarcado

**Estado:** modelo de ameaças local, baseado em código e testes do repositório; validação externa/pentest `NOT_RUN`.
**Escopo:** runtime embarcado (`packages/agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`, `agent-skills`, `model-runtime`, `model-adapters`, `embedded-agent-runtime`) e suas fronteiras com PDP, Tool Gateway, retrieval, plugins e provider de modelo.
**Fora de escopo:** frontend, infraestrutura de rede, operação do harness externo (coberto por `docs/runbooks/deepseek-harness-outage.md`).

Método: STRIDE-like, com controle existente citado por arquivo/identificador, evidência em teste e risco residual honesto. Nenhuma mitigação é declarada verificada em produção.

## 1. Assets

| Asset | Autoridade no código | Impacto se comprometido |
| --- | --- | --- |
| Domínio clínico/operacional | `packages/domain`, rotas de `apps/api/src/app.ts` | escrita indevida em prontuário, agenda, internação, estoque, financeiro |
| PDP | `packages/agent-policy` (`StaticPolicyDecisionPoint`, registries) | autorização indevida de capability |
| Tool Gateway + ledger de execução | `packages/agent-tools` (`createGovernedToolGateway`, `ToolGatewayError`) | efeito externo sem governança ou replay |
| Segredos | `SecretProvider` + referências (`CVG_DEEPSEEK_BEARER_TOKEN_REF`) | exfiltração de credencial |
| RLS e isolamento por organização | `db/migrations/038_agent_runtime_session_state.sql` | acesso cross-tenant |
| Audit chain | `cvg_audit_ledger`/`audit_records` com `previous_hash`/`record_hash` (`packages/persistence`) | repúdio/perda de evidência |
| Effect ledger / reconciliação | `ExternalEffectLedger` (`packages/integrations`) + estados do gateway | efeito duplicado ou não reconciliado |
| Estado de sessão do agente | `agent_sessions`, `agent_turns`, `agent_checkpoints`, `agent_leases` (migration 038) | resume adulterado, replay, perda de trabalho |

## 2. Trust boundaries

| Fronteira | O que cruza | Controle |
| --- | --- | --- |
| Context Builder (`packages/agent-context`) | projeções de domínio, retrieval e conversa → mensagens do modelo | trust level por item, `renderUntrusted` (dados delimitados), data class, prioridade e budget |
| Model provider (`packages/model-runtime`, `model-adapters`) | contexto minimizado → wire externo | `dataPolicy.allowedDataClasses`, roteamento, timeout, sem autoridade de tool |
| Plugins (`packages/agent-plugins`) | código de terceiro → hooks e tool client | allowlist, digest do manifesto, permissões fechadas, sem autoridade ambiente |
| Retrieval (`KnowledgeGovernor` + `knowledgeDocuments`) | documentos → contexto | `APPROVED`, escopo, classe de dados, filtro de injeção |
| Tools (`packages/agent-tools` + PDP) | pedido do modelo → efeito de domínio | registry canônico, profile, PDP, aprovação one-shot, idempotência, ledger |
| Sessão (`packages/agent-session` + migration 038) | checkpoint/lease → estado durável | fencing monotônico, digest de checkpoint, append-only, RLS forçada |

## 3. Ameaças, controles e risco residual

### 3.1 Prompt injection direta
- **Controle:** `looksLikeInjection` marca o prompt e persiste turno `QUARANTINED` sem chamar modelo ou tool (`packages/embedded-agent-runtime/src/index.ts:452-455,1232`).
- **Evidência:** `tests/unit/embedded-runtime.test.ts` "embedded runtime quarantines prompt injection without dispatch"; `tests/unit/agent-security.test.ts` "direct and indirect injection never reach the model or the tool gateway".
- **Residual:** detecção por regex é sinal, não prova; formulações novas podem passar. A garantia estrutural é que o prompt do usuário nunca altera policy, tools ou approvals.

### 3.2 Prompt injection indireta (retrieval, documento, tool result)
- **Controle:** `inspectUntrustedContent` + `renderUntrusted` (`packages/agent-context/src/index.ts:147-159`); item não-confiável com finding é removido e auditado; `TOOL_RESULT` permanece como dado delimitado e sanitizado; `buildContext` filtra documentos com padrão de injeção (`packages/embedded-agent-runtime/src/index.ts:755-758`).
- **Evidência:** `tests/unit/agent-context.test.ts` "context builder quarantines injection patterns in untrusted retrieval".
- **Residual:** a proteção depende de o conteúdo de fato entrar como `RETRIEVED_UNTRUSTED`/`TOOL_RESULT`; qualquer novo caminho de contexto que marque conteúdo externo como `CVG_TRUSTED` contorna o firewall.

### 3.3 Confused deputy (modelo induz o gateway)
- **Controle:** tool só executa se declarada no `profile.allowedTools` **e** no `TOOL_REGISTRY` (`packages/harness/src/index.ts:34`), com role e capability revalidados (`packages/embedded-agent-runtime/src/index.ts:836-843,467`); o gateway valida descriptor contra a policy canônica (`packages/agent-tools/src/index.ts:166`).
- **Evidência:** `tests/unit/agent-security.test.ts` "a tool outside the allowlist is denied with no dispatch" e "an AI turn cannot produce a side effect without the tool gateway and PDP".
- **Residual:** o conjunto de tools do produto é pequeno e read-mostly; a superfície cresce com cada nova tool e exige revisão de policy correspondente.

### 3.4 Cross-tenant
- **Controle:** comparações de `organizationId`/`actorId`/unidade/workspace em `getOrCreateSession`, `approve`, `replay` e `buildContext` (`packages/embedded-agent-runtime/src/index.ts:413,382,741,1056`); RLS forçada nas tabelas `agent_*` (migration 038).
- **Evidência:** `tests/unit/agent-security.test.ts` "cross-tenant replay and cross-organization resource access are denied".
- **Residual:** o teste depende da existência de um segundo usuário de fixture; e RLS/isolamento em PostgreSQL real é `NOT_RUN` localmente (ver `docs/agent-runtime-security-review.md`). `NOT_PROVEN` em banco real.

### 3.5 Escalação de privilégio via plugin
- **Controle:** allowlist + digest + permissões fechadas; risco `HIGH`/`UNTRUSTED` exige aprovação explícita (`packages/agent-plugins/src/index.ts:140-153`); contexto do plugin não inclui database/filesystem/secrets/http (`buildContext`, linhas 283-303); plugin `FAILED`/`DISABLED` nunca expõe capability (linha 250).
- **Evidência:** `tests/unit/agent-security.test.ts` "malicious plugin cannot escalate privileges or reach ambient authority"; `tests/unit/agent-plugins.test.ts` "plugin receives no ambient authority: no database, filesystem, secrets or http client".
- **Residual:** o modelo de plugin é novo e não há plugin de produção carregado; a revisão de um plugin real (dependências, hooks) ainda é manual.

### 3.6 Replay de lease/fence
- **Controle:** fence monotônico por sessão; escritor antigo rejeitado com `DENIED_STALE_FENCE` (`packages/agent-session/src/index.ts:271-276`); lease só é re-adquirido após expiração ou pelo mesmo owner (`acquireLease`, linhas 345-364).
- **Evidência:** `tests/unit/agent-session.test.ts` "leases fence concurrent owners and reject stale writers"; `tests/unit/agent-security.test.ts` "stale fencing prevents an old writer from committing".
- **Residual:** o lease do runtime embarcado é de 60s sem renovação (`packages/embedded-agent-runtime/src/index.ts:974`): turnos longos podem ser assumidos por outra instância (o escritor antigo é rejeitado, mas há trabalho perdido). Não verificado com múltiplas instâncias sobre PostgreSQL real.

### 3.7 Adulteração de checkpoint
- **Controle:** `checkpointDigest` sobre o payload canonicalizado; divergência lança `CHECKPOINT_TAMPERED` na leitura (`packages/agent-session/src/index.ts:129,202,341`); `agent_turns`/`agent_checkpoints` são append-only por trigger (migration 038).
- **Evidência:** `tests/unit/agent-session.test.ts` "checkpoint is append-only, versioned and tamper-evident".
- **Residual:** o digest detecta alteração de payload sem atualização do digest; não é assinatura/HMAC. Um atacante com escrita direta no banco capaz de reescrever payload **e** digest não é detectado por esse controle — a detecção dependeria do audit chain e de controles de banco.

### 3.8 Exfiltração de segredo
- **Controle:** finding `SECRET_MATERIAL` remove conteúdo não-confiável com aparência de segredo (`packages/agent-context/src/index.ts:139,257-266`); logger de plugin redige metadados sensíveis (`packages/agent-plugins/src/index.ts:286-293`); credenciais são resolvidas por referência a cada chamada e nunca guardadas no provider (`packages/model-adapters/src/index.ts:108,167`); tools declaram `secretRefs`/egress na policy (`packages/agent-policy/src/index.ts:418-425`).
- **Evidência:** `tests/unit/agent-security.test.ts` "secret-like material in untrusted context is quarantined"; `tests/unit/agent-plugins.test.ts` "plugin logger redacts secret-like metadata".
- **Residual:** não há DLP no lado do provider; o provider recebe o que a policy de dados autorizar. Segredo colado pelo usuário em conversa que não case com os padrões pode chegar ao modelo.

### 3.9 Forjamento/replay de aprovação
- **Controle:** `validateApproval` exige correspondência de organização, ator, sessão, tool, recurso, paciente, atendimento, unidade, workspace, finalidade, `policyRevision`, `requestDigest` e expiração, além de `decision === "allowed-once"`; aprovação é consumida após o uso (`packages/embedded-agent-runtime/src/index.ts:917-931,636`); `HIGH_IMPACT` exige aprovador independente (linhas 391,927); expiração de 5 minutos (linha 951).
- **Evidência:** `tests/unit/agent-security.test.ts` "approval cannot be forged, reused, expired or self-approved for high impact".
- **Residual:** o vínculo é por digest do request; qualquer alteração legítima de argumentos invalida a aprovação (por desenho) e pode frustrar operação — exige reapresentação, nunca reescrita.

### 3.10 Comprometimento do provider de modelo
- **Controle:** `dataPolicy` limita classes de dados por provider e a rota nega `DATA_CLASS_NOT_AUTHORIZED` (`packages/model-runtime/src/index.ts:368-378`); resposta é tipada e validada (`MODEL_INVALID_RESPONSE`, `packages/model-adapters/src/index.ts:184,261,271`); tool call do modelo não executa nada por si: passa por profile/registry/PDP/gateway; `responseDigest` entra na provenance do turno.
- **Evidência:** `tests/unit/model-runtime.test.ts` "model router never routes a data class the provider is not authorized for"; `tests/unit/model-adapters.test.ts` "deepseek provider maps tool calls and rejects malformed tool arguments"; `tests/unit/embedded-runtime.test.ts` "fails closed when the provider data policy does not cover the context".
- **Residual:** um provider comprometido ainda pode devolver texto plausível e falso ao usuário; a verificação default do kernel é `DEFAULT_ACCEPT` quando nenhuma `verification` port é injetada (`packages/agent-kernel/src/index.ts:818`). A saída de IA permanece rascunho sujeito a revisão humana, não fato.

### 3.11 Exaustão de recursos
- **Controle:** `CVG_AI_MAX_CONCURRENT_TURNS` (default 8, `packages/config/src/index.ts:80`) + supervisor (`tryBeginTurn`); limites do kernel (`maxTurns`, `maxToolCalls`, `maxTokens`, `maxWallTimeMs`, `maxFailures`); reserva de budget antes de cada chamada (`packages/agent-kernel/src/index.ts:547`); circuit breaker; timeout de provider; `maxOutput` limitado a 2048 e reserva limitada a 1024 (`packages/agent-kernel/src/index.ts:547,560`).
- **Evidência:** `tests/unit/agent-kernel.test.ts` "kernel stops on max turns", "kernel stops on token exhaustion", "kernel stops on cost exhaustion when the cost is known"; `tests/unit/embedded-runtime.test.ts` "respects tool kill switch and safe mode".
- **Residual:** `maxCostMicros` é `null` nos profiles e custo do provider tende a ser `null` (`costKnown = false`), então exaustão de custo não está limitada por padrão; a estimativa de tokens é heurística (`length/4`). Sem limite global de custo `NOT_PROVEN`.

### 3.12 Sessão/recurso bloqueado como negação de serviço
- **Controle:** lease expira e é re-adquirível com fence maior; `ADMISSION_IN_PROGRESS` é resposta tipada, não corrupção; drain com deadline (`packages/embedded-agent-runtime/src/index.ts:109-124`).
- **Evidência:** `tests/unit/embedded-runtime.test.ts` "denies concurrent execution of the same session across instances".
- **Residual:** não há cancelamento HTTP nem renovação de lease; uma sessão travada consome trabalho até a expiração. Operação documentada em `docs/runbooks/session-stuck.md`.

## 4. Limitações globais do modelo

- Evidência é local (MemoryAgentSessionStore, provider mock, dados sintéticos); staging, provider real, pentest externo e RLS em PostgreSQL real estão `NOT_RUN`/`NOT_PROVEN`.
- O audit chain e o effect ledger existem como autoridades, mas sua composição com o runtime embarcado não foi exercitada ponta a ponta em ambiente durável nesta rodada.
- Nenhuma dessas mitigações substitui revisão humana de saída clínica: drafts nascem `DRAFT` e só viram documento por promoção explícita (`promoteDraft`, `packages/embedded-agent-runtime/src/index.ts:396`).
