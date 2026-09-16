# Security review — Agent Runtime embarcado (local)

**Status:** revisão local concluída; produção, staging e provider real `NOT_PROVEN`.
**Data:** 2026-09-16. **Escopo:** runtime embarcado e pacotes de apoio (`agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`, `agent-skills`, `model-runtime`, `model-adapters`, `embedded-agent-runtime`).
**Referências:** `docs/agent-runtime-threat-model.md`, `docs/agent-runtime-red-team.md`, `docs/embedded-harness-audit.md`, `docs/adr/ADR-agent-runtime-embedding-decision.md`.

Nenhuma parte deste documento autoriza promoção de release. A promoção exige aprovação humana e evidência externa ainda não obtida.

## 1. O que foi verificado (evidência local)

Comandos executados nesta revisão, com resultado observado:

| Gate | Comando | Resultado observado |
| --- | --- | --- |
| Suíte adversarial | `npm run verify:agent-security` | `AGENT_SECURITY_VERIFIED attacks=10 scope=injection,plugin,skill,approval,fencing,tenant,secrets,gateway` |
| Harness embarcado | `npm run verify:embedded-harness` | `EMBEDDED_HARNESS_VERIFIED artifacts=17 focusedTests=43 license=MIT decision=HYBRID embeddedFiles=0` |
| Kernel/estado global | `npm run verify:agent-runtime` | `AGENT_RUNTIME_VERIFIED states=13 stops=9 focusedTests=46` |
| Invariantes de arquitetura | `npm run verify:architecture` | `ARCHITECTURE_VERIFIED runtimePackages=13 domainImports=0 applicationProviderImports=0` |
| IA desabilitada | `npm run verify:ai-disabled` | `AI_DISABLED_VERIFIED core=health,ready,auth patients=401 aiReadiness=503/DISABLED degradation=AI_DEGRADED` |

Cobertura por arquivo de teste:

- `tests/unit/agent-security.test.ts` — 10 ataques adversariais: injeção direta/indireta, tool fora da allowlist, replay cross-tenant, forja/reuso/expiração/autoaprovação de approval, fencing obsoleto, plugin malicioso, skill maliciosa, material de segredo em contexto não-confiável, efeito sem gateway/PDP, digest de manifesto de plugin.
- `tests/unit/agent-plugins.test.ts` — allowlist, digest adulterado, permissão proibida, plugin de risco, ausência de autoridade ambiente, cliente de tool condicionado a permissão, dependências ausentes, conflito de versão, ciclo/startup fail-closed, disable removendo hooks, redaction de logger.
- `tests/unit/agent-session.test.ts` — escopo de sessão, lease/fence concorrente, `DENIED_STALE_FENCE`, renew/release exigindo owner+fence, checkpoint append-only/versionado/tamper-evident, ledger de turnos fenced, SQL do `PostgresAgentSessionStore` com executor falso.
- `tests/unit/embedded-runtime.test.ts` — health e kill switch, turno normal com provenance/usage, tool read-only pelo gateway, pausa/retomada/consumo de approval, idempotência, quarentena de injeção, tool fora do profile, data policy do provider, kill switch/safe mode, concorrência por sessão, replay estável, manifesto determinístico.
- `tests/unit/model-runtime.test.ts` — capability obrigatória, classe de dados não autorizada, fallback fail-closed, kill switch dinâmico, circuit breaker (open/block/half-open/close), retry com jitter apenas para erros retryable, classificação de desconhecidos, reconciliação de usage sem reescrever histórico.
- `tests/unit/model-adapters.test.ts` — mock determinístico, DeepSeek fail-closed sem credencial, mapeamento de chat-completions/usage, tool calls e argumentos malformados, normalização de HTTP/timeout, provider local on-prem, rejeição de HTTP inseguro sem opt-in.
- `tests/unit/agent-context.test.ts`, `tests/unit/agent-kernel.test.ts`, `tests/unit/agent-skills.test.ts` — firewall de contexto, limites/stop conditions, checkpoints com digests, skills sem autoridade.

Invariantes estáticas verificadas pelos gates: o domínio não importa pacotes de runtime; o kernel não importa domínio/persistência/tools/harness nem I/O (`node:fs`, `node:net`, `node:http`, `pg`); serviços de aplicação dependem da porta `AgentRuntime`, não de adapters de provider; nenhum arquivo do upstream foi incorporado.

## 2. O que NÃO foi verificado

- **Pentest externo:** `NOT_RUN`. A suíte é interna, determinística e baseada em fixtures; não houve terceiro independente.
- **CVE scan do upstream DeepSeek:** `NOT_RUN`. A auditoria registra explicitamente que Trivy/`pnpm audit` não foi executado sobre o upstream (`docs/embedded-harness-audit.md` §1). Relevante porque o harness externo continua operável como processo separado.
- **Staging:** `NOT_RUN`. Não houve deploy do runtime embarcado em ambiente staging com tráfego sintético realista.
- **Provider real (DeepSeek/local):** `NOT_RUN`. Toda a evidência usa `MockModelProvider`; as trilhas de credencial, rate limit, timeout e erro HTTP foram exercitadas apenas com `fetchImpl` controlado nos testes de adapter (`tests/unit/model-adapters.test.ts`). `scripts/verify-deepseek-real.ts` não foi executado nesta revisão.
- **RLS e persistência em PostgreSQL real:** `NOT_RUN`. A migration `038_agent_runtime_session_state.sql` existe no repositório, mas não foi aplicada ao banco local consultado nesta revisão (`DATABASE_URL` não definido; o banco `cvg_test` no container local não possui tabelas `agent_*`). O `PostgresAgentSessionStore` foi coberto apenas por teste unitário com executor SQL falso, que verifica o texto/queries e o caminho `DENIED_STALE_FENCE`, não as políticas RLS nem o trigger append-only em servidor real.
- **Concorrência multi-instância com PostgreSQL real:** `NOT_RUN`. O fencing foi provado no store em memória; a garantia de `SKIP LOCKED`/`ON CONFLICT ... fence + 1` não foi exercitada com processos concorrentes reais.
- **Limites de custo:** `NOT_PROVEN`. `maxCostMicros` é `null` nos profiles e o custo do provider normalmente é `null` (`costKnown = false`), então não há limite de custo efetivo verificado.
- **Integração HTTP ponta a ponta do runtime embarcado:** `NOT_RUN`. O gate `verify:ai-disabled` injeta requisições com o runtime `disabled`; não há teste de integração que execute um turno embarcado completo através da API com provider configurado.
- **Egress/SSRF de tools:** as tools do registry são `LOCAL_ONLY` (`packages/agent-policy/src/index.ts:418-425`), mas não houve teste de egress com rede real.
- **Side channels e infraestrutura:** latência, uso de memória, isolamento de rede e abuso de credencial não foram avaliados.

## 3. Processo de third-party security watch

- Nenhum arquivo do upstream foi incorporado (`embeddedFiles=0`): o que existe é conceito + contrato `/v1` + adapter CVG (`docs/adr/ADR-agent-runtime-embedding-decision.md`).
- Acompanhamento em `docs/third-party/deepseek-harness-upstream.md`: baseline `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (`dsh 0.1.5-alpha.1`), procedimento de `git fetch`/`log`/`diff`, e política de atualização sem *blind update*.
- Qualquer release upstream deve ser triado por: mudanças no contrato `/v1`, correções de segurança relevantes para operar o processo externo e breaking changes que exijam atualização de `expectedEngineCommit`/`expectedManifestVersion` — sempre depois de exercitar o commit contra a ponte (`docs/runbooks/embedded-harness-upgrade.md`).
- Enquanto o upstream não for escaneado, o produto não deve declarar postura de supply chain verificada para o harness externo.

## 4. Follow-ups recomendados

1. Aplicar a migration 038 em banco PostgreSQL dedicado de teste e rodar concorrência multi-instância real (lease/fence, RLS, trigger append-only).
2. Definir limite de custo efetivo (`maxCostMicros`) ou documentar formalmente por que custo desconhecido é aceitável; hoje `costKnown = false` desarma o teto.
3. Executar CVE scan do upstream e registrar no `docs/third-party/deepseek-harness-upstream.md` antes de qualquer promoção que dependa do processo externo.
4. Configurar `DATABASE_URL`/staging para os gates que hoje só rodam com store de memória.
5. Ampliar o catálogo adversarial com os itens da seção "ataques ainda não cobertos" de `docs/agent-runtime-red-team.md`, começando por hooks de plugin em runtime e quarentena de retrieval via HTTP.

## 5. Veredito local

Os controles exercitados localmente resistiram aos 10 ataques catalogados em `docs/agent-runtime-red-team.md`, com evidência reproduzível por gates. Isso é evidência **local-only**; staging, provider real, pentest externo, CVE scan do upstream e RLS em PostgreSQL real permanecem `NOT_RUN`/`NOT_PROVEN`. Nenhuma afirmação de prontidão de produção é feita aqui.

## Reparos pós-crítica independente (2026-09-16)

Uma crítica independente de contexto fresco encontrou e esta rodada reparou:

- **RLS/tenant scoping no agent store PostgreSQL:** todas as instruções passam a
  executar em transação com `set_config('cvg.organization_id', …, true)`
  (`createScopedSqlExecutor` em `packages/agent-session/src/index.ts`).
- **Fence e sequência no SQL:** `agent_turns`/`agent_checkpoints` só inserem quando
  o fence é o autoritativo (`WHERE EXISTS … fence = $n`) e a sequência é global por
  sessão; `latestCheckpoint` ignora checkpoints de fence futuro.
- **Lease:** TTL dimensionado pelo wall budget + 180 s e renovação obrigatória antes
  de checkpoint e da escrita final (`assertLeaseHeld`); lease perdido ⇒
  `DENIED_STALE_FENCE`.
- **Budget:** reserva `UNKNOWN` interrompe o loop (`DEPENDENCY_UNAVAILABLE`).
- **Approval:** consumo one-shot antes do dispatch; falha posterior não permite reuso.
- **Ledger/checkpoint:** falha de checkpoint falha fechado; turno sem entrada de
  ledger é rebaixado a `OUTCOME_UNKNOWN`.
- **Usage:** provider sem medição (`UNAVAILABLE`) resulta em
  `RECONCILIATION_REQUIRED`, nunca em settlement silencioso.
- **Contexto:** histórico de conversa/tool passa pelo firewall (delimitado, com
  findings), não apenas retrieval.

Limitação de prova remanescente: esses caminhos SQL não foram executados contra
PostgreSQL real nesta máquina; a prova real exige staging/PostgreSQL autorizado.
