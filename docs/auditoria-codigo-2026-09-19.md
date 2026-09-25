# Auditoria de código — 2026-09-19

> **Superada em 2026-09-20:** a implementação AUD19 foi reavaliada e contraprovas reabriram diversos itens declarados concluídos. Use a [reauditoria CVG-AUD19](auditoria-resultado-cvg-aud19-2026-09-20.md), o [roadmap AUD20](roadmap-melhorias-cvg-aud20-2026-09-20.md) e o [backlog AUD20](backlog-melhorias-cvg-aud20-2026-09-20.md) como estado corrente. Este documento permanece como registro histórico.

**Estado:** FINALIZADA<br>
**Revisão auditada:** `c990914148a8f375082cd12bbdb2ad20cfe1900f`<br>
**Veredito:** `FAIL / REJECT` para produção<br>
**Nota geral:** **75/100**<br>
**Confiança:** alta<br>
**Natureza:** auditoria somente leitura; nenhuma correção foi implementada neste trabalho

Documentos derivados:

- [Roadmap de remediação](roadmap-remediacao-auditoria-2026-09-19.md)
- [Backlog de remediação](backlog-remediacao-auditoria-2026-09-19.md)

## 1. Resumo executivo

A base possui arquitetura modular, controles locais amplos e uma suíte de testes relevante. Ainda assim, não está pronta para produção. Foram confirmadas falhas de severidade alta em isolamento de dados clínicos, recuperação do estado do agente, readiness do banco, concorrência de sessões e persistência, privilégios do papel de runtime e ordenação de sucesso dos workers.

A nota geral é a média aritmética dos 22 critérios congelados. Ela não substitui o veredito: qualquer achado alto não resolvido impede aprovação, independentemente da média.

## 2. Escopo e método

- Leitura byte a byte dos **214 arquivos regulares** de `docs/`, totalizando **2.231.524 bytes**.
- Inspeção conectada de aplicações, pacotes, testes, migrations, scripts, CI, Docker, observabilidade e evidências operacionais.
- Execução de typecheck, build, testes unitários/integração, verificadores arquiteturais, segurança, PDP, runtime de agentes, supply chain e matriz de browsers disponível.
- Reprodução isolada dos defeitos de autorização clínica e expiração de sessão.
- Dois críticos independentes especializados e um crítico final de contexto fresco.
- Critérios congelados antes do julgamento; achados altos não foram compensados por notas altas em outras dimensões.

## 3. Achados materiais

### AUD-2026-001 — Dados clínicos de outro workspace alcançam o modelo

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** segurança, autorização, PDP, gateway de ferramentas, governança de IA e integridade de domínio

Um usuário no workspace A pode informar como `resourceId` um atendimento do workspace B, dentro da mesma organização, deixando `encounterId` ausente. A fronteira HTTP valida apenas `encounterId`; o PDP recebe o workspace do chamador como se fosse um fato do recurso; e `cvg.clinical.draft` valida somente a organização. Identificadores do atendimento/paciente e status entram no histórico da ferramenta e podem chegar ao modelo/provider antes do saneamento final da resposta.

O cenário foi reproduzido: o executor retornou `COMPLETED` com dados do atendimento estrangeiro em `resultPreview`.

Evidências:

- [`apps/api/src/app.ts`](../apps/api/src/app.ts#L962)
- [`apps/api/src/agent-tool-executor.ts`](../apps/api/src/agent-tool-executor.ts#L86)
- [`packages/agent-policy/src/index.ts`](../packages/agent-policy/src/index.ts#L440)
- [`packages/agent-kernel/src/index.ts`](../packages/agent-kernel/src/index.ts#L788)
- [`apps/api/src/application/agent-service.ts`](../apps/api/src/application/agent-service.ts#L61)

### AUD-2026-002 — Recuperação omite o estado durável do agente

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** banco de dados, recuperação, confiabilidade e governança de IA

A migration 038 cria `agent_sessions`, `agent_turns`, `agent_checkpoints` e `agent_leases`, mas o contrato e a exportação de `DurableRecoveryBundle` não incluem essas tabelas. O verificador de restore também não as valida. Uma restauração pode manter uma referência `AiSession` no snapshot e perder sua sessão autoritativa, turnos, checkpoints e leases.

Evidências:

- [`db/migrations/038_agent_runtime_session_state.sql`](../db/migrations/038_agent_runtime_session_state.sql#L6)
- [`packages/persistence/src/index.ts`](../packages/persistence/src/index.ts#L507)
- [`packages/persistence/src/index.ts`](../packages/persistence/src/index.ts#L3089)
- [`scripts/verify-postgres-restore.ts`](../scripts/verify-postgres-restore.ts#L171)

### AUD-2026-003 — Readiness pode ficar verde sem migrations 038/039

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** banco de dados, confiabilidade e prontidão produtiva

`assertSchema` verifica o esquema somente até a migration 037. A saúde do agente prova o modelo, e `/ready` volta a verificar conectividade, mas não a presença das tabelas duráveis do agente. O serviço pode iniciar e anunciar prontidão antes de falhar no primeiro turno.

Evidências:

- [`packages/persistence/src/index.ts`](../packages/persistence/src/index.ts#L2924)
- [`apps/api/src/app.ts`](../apps/api/src/app.ts#L569)
- [`packages/embedded-agent-runtime/src/index.ts`](../packages/embedded-agent-runtime/src/index.ts#L350)
- [`apps/api/src/routes/health.ts`](../apps/api/src/routes/health.ts#L50)

### AUD-2026-004 — Sessões expiradas continuam utilizáveis e leases podem se sobrepor

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** confiabilidade, governança de IA e integridade de domínio

Foi reproduzido que uma sessão com TTL de 10 ms ainda pode ser carregada e receber lease após o relógio avançar para 11 ms. Os caminhos em memória e PostgreSQL não aplicam `expiresAt/expires_at`. A reaquisição pelo mesmo owner incrementa o fencing token enquanto a execução anterior ainda pode estar ativa; chaves idempotentes diferentes permitem sobreposição na mesma sessão.

Evidências:

- [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L172)
- [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L405)
- [`packages/embedded-agent-runtime/src/index.ts`](../packages/embedded-agent-runtime/src/index.ts#L1194)

### AUD-2026-005 — Requisições remotas podem disputar um store singleton

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** arquitetura, confiabilidade e persistência

As rotas remotas de IA evitam manter o coordenador durante a chamada externa, mas hidratam e alteram o store global. O snapshot é obtido somente após readquirir a trava de commit. Requisições concorrentes podem misturar mutações ou persistir trabalho de uma requisição que posteriormente recebe conflito.

Evidências:

- [`apps/api/src/app.ts`](../apps/api/src/app.ts#L693)
- [`apps/api/src/application/idempotency-service.ts`](../apps/api/src/application/idempotency-service.ts#L133)

### AUD-2026-006 — Papel de runtime provavelmente mantém DML excessivo

**Severidade:** ALTA<br>
**Confiança:** média-alta, pendente de confirmação no PostgreSQL implantado<br>
**Critérios afetados:** segurança, autorização e banco de dados

A migration 022 concede `SELECT`, `INSERT`, `UPDATE` e `DELETE` sobre tabelas atuais e futuras. A migration 038 concede permissões mais estreitas, mas não revoga explicitamente os privilégios herdados. Por isso, `agent_sessions` provavelmente continua deletável pelo papel de runtime. A conclusão final exige `has_table_privilege` em um PostgreSQL migrado do caminho canônico.

Evidências:

- [`db/migrations/022_runtime_database_role.sql`](../db/migrations/022_runtime_database_role.sql#L14)
- [`db/migrations/038_agent_runtime_session_state.sql`](../db/migrations/038_agent_runtime_session_state.sql#L115)

### AUD-2026-007 — Worker registra sucesso antes do acknowledge durável

**Severidade:** ALTA<br>
**Confiança:** alta<br>
**Critérios afetados:** workers, confiabilidade, auditoria e efeitos externos

Auditoria e métricas de sucesso são emitidas antes de `complete/acknowledge`. Uma falha nessa confirmação pode deixar um registro de sucesso seguido de retry ou expiração do lease. O timeout depende de `Promise.race`; handlers que não cooperam com o sinal de abort podem continuar executando depois do agendamento de retry/quarentena.

Evidências:

- [`apps/worker/src/worker.ts`](../apps/worker/src/worker.ts#L674)
- [`packages/integrations/src/index.ts`](../packages/integrations/src/index.ts#L1191)
- [`apps/worker/src/runtime-controls.ts`](../apps/worker/src/runtime-controls.ts#L102)
- [`tests/unit/worker.test.ts`](../tests/unit/worker.test.ts#L205)

### AUD-2026-008 — Leitura PostgreSQL de turnos/checkpoints não aplica actor scope

**Severidade:** MÉDIA<br>
**Confiança:** alta

O contrato de escopo inclui `actorId`, mas `latestCheckpoint` e `listTurns` filtram somente sessão e organização. O RLS também é apenas organizacional. Guards atuais reduzem a alcançabilidade, mas a persistência não garante a propriedade pelo ator.

Evidências:

- [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L387)
- [`packages/agent-session/src/index.ts`](../packages/agent-session/src/index.ts#L462)
- [`db/migrations/038_agent_runtime_session_state.sql`](../db/migrations/038_agent_runtime_session_state.sql#L99)

### AUD-2026-009 — Contratos de payload do frontend falham abertos

**Severidade:** MÉDIA<br>
**Confiança:** alta<br>
**Critérios afetados:** frontend, confiabilidade e testes

Somente um pequeno conjunto de rotas possui schema runtime. As demais respostas usam `passthrough` e depois são convertidas para o tipo solicitado pelo chamador. Componentes como `Overview` desreferenciam imediatamente `.items`, e a raiz não possui error boundary. Uma resposta HTTP bem-sucedida, porém malformada, pode derrubar a árvore React.

Evidências:

- [`apps/web/src/api/validation.ts`](../apps/web/src/api/validation.ts#L33)
- [`apps/web/src/api/client.ts`](../apps/web/src/api/client.ts#L130)
- [`tests/unit/contracts.test.ts`](../tests/unit/contracts.test.ts#L108)
- [`apps/web/src/features/overview/Overview.tsx`](../apps/web/src/features/overview/Overview.tsx#L31)
- [`apps/web/src/main.tsx`](../apps/web/src/main.tsx#L1)

### AUD-2026-010 — Topologia de alertas e logs está incompleta

**Severidade:** MÉDIA<br>
**Confiança:** alta<br>
**Critérios afetados:** observabilidade e operação

Prometheus carrega regras, mas não declara `alerting.alertmanagers`. O verificador estrutural não cobre essa conexão. Fastify está com logger desabilitado, OTel exporta traces e os logs redigidos permanecem somente em um buffer de memória, apesar de o collector declarar um pipeline de logs.

Evidências:

- [`docker/observability/prometheus.yml`](../docker/observability/prometheus.yml#L1)
- [`docker-compose.observability.yml`](../docker-compose.observability.yml#L60)
- [`scripts/verify-production.ts`](../scripts/verify-production.ts#L217)
- [`packages/ops/src/otel.ts`](../packages/ops/src/otel.ts#L99)
- [`packages/ops/src/index.ts`](../packages/ops/src/index.ts#L107)
- [`apps/api/src/app.ts`](../apps/api/src/app.ts#L672)

### AUD-2026-011 — Evidência de promoção não corresponde ao HEAD

**Severidade:** CRÍTICA para promoção<br>
**Confiança:** alta<br>
**Critérios afetados:** testes, DevOps, supply chain e prontidão produtiva

O HEAD auditado é `c990914…`, mas o snapshot de evidências aponta para `141d767…`, o estado de qualidade para `08813b8…` e a matriz anterior de browsers para `e43b3b0…`. `verify:static` rejeitou corretamente a combinação. Entretanto, o gate de proveniência documental permite `WORKTREE` sempre que existir qualquer sujeira, sem vincular `subjectSha` ao HEAD ou ao delta real.

Evidências:

- [`artifacts/operational-proof/evidence-snapshot.json`](../artifacts/operational-proof/evidence-snapshot.json#L3)
- [`artifacts/quality/current-state.json`](../artifacts/quality/current-state.json#L3)
- [`scripts/verify-docs-provenance.ts`](../scripts/verify-docs-provenance.ts#L21)
- [`scripts/verify-claims.ts`](../scripts/verify-claims.ts#L8)

## 4. Notas por critério

| Critério | Nota | Meta | Estado | Fundamentação resumida |
|---|---:|---:|---|---|
| Arquitetura | 88 | 97 | FAIL | Bons limites de imports; corrida de store compartilhado e recuperação incompleta. |
| Integridade de domínio | 84 | 97 | FAIL | Recurso de outro workspace alcança IA; sessão expirada permanece utilizável. |
| Segurança | 72 | 97 | FAIL | Divulgação entre workspaces e privilégios de banco provavelmente excessivos. |
| Autenticação | 97 | 97 | PASS local | Testes locais atuais de auth/MFA/sessão passaram; nenhuma falha contrária foi encontrada. |
| Autorização | 70 | 97 | FAIL | Identidade do recurso não é resolvida antes da decisão e execução. |
| PDP/políticas | 82 | 97 | FAIL | Cobertura ampla, mas fatos declarados pelo contexto são usados como verdade do recurso. |
| Gateway de ferramentas | 70 | 97 | FAIL | O gateway aceita recurso estrangeiro com facts incorretos. |
| Banco de dados | 68 | 97 | FAIL | Readiness incompleto, actor scope ausente e privilégios incertos. |
| Confiabilidade | 66 | 97 | FAIL | Expiração, leases, store singleton e timeout não cooperativo. |
| Workers | 78 | 96 | FAIL | Sucesso antes do acknowledge e handler potencialmente vivo após timeout. |
| DeepSeek | 73 | 95 | BLOCKED | Adapters locais passam; execução real autorizada está ausente. |
| Governança de IA | 72 | 97 | FAIL | Saneamento ocorre depois da divulgação; fencing insuficiente. |
| Integrações externas | 71 | 95 | BLOCKED | Loopback passa; vertical real de provider está ausente. |
| Frontend | 83 | 95 | FAIL | Payloads sem schema e risco de queda da árvore React. |
| Acessibilidade | 88 | 95 | BLOCKED | Chromium/Firefox cobertos; WebKit, AT e zoom real permanecem sem prova. |
| Testes | 86 | 97 | FAIL | Suíte local forte, mas WebKit não executou assertions e regressões críticas faltam. |
| Observabilidade | 65 | 95 | FAIL | Alertmanager desconectado e logs apenas em memória. |
| Performance | 68 | 95 | BLOCKED | Sem carga representativa; chunk principal excede 500 kB. |
| Recuperação | 55 | 97 | FAIL | Estado durável do agente ausente no backup/restore. |
| DevOps/CI | 82 | 96 | STALE | Pipeline amplo, mas evidência exata do SHA está obsoleta. |
| Supply chain | 92 | 95 | NOT_RUN final | Audit/SBOM/licenças locais passam; scans e provenance do artefato promovido faltam. |
| Prontidão para produção | 35 | 95 | FAIL | Faltam fechamento dos altos, staging, recovery, observabilidade e aprovação humana. |

## 5. Verificações executadas

| Verificação | Resultado observado | Limitação |
|---|---|---|
| `npm run typecheck` | PASS | Escopo TypeScript configurado pelo projeto. |
| `npm run lint` | PASS, 221 arquivos | Verificador heurístico próprio; não equivale a ESLint/React Hooks/JSX a11y. |
| `npm test` | 529 total; 528 PASS; 1 SKIP; 0 FAIL | Não cobre os defeitos reproduzidos acima. |
| `npm run build` | PASS | JS 530,62 kB raw; aviso de chunk acima de 500 kB. |
| Arquitetura/PDP/writes/audit/runtime/agentes/workers | PASS local | Prova local, não substitui staging ou fornecedor real. |
| `npm audit` e `npm audit --omit=dev` | 0 vulnerabilidades | Retrato do momento da auditoria. |
| CycloneDX SBOM | PASS; 138 componentes e 139 dependências | Ainda não ligado a imagem promovida exact-SHA. |
| Licenças | PASS; 163 pacotes aprovados | Não cobre provenance da imagem final. |
| Browser Chromium | 151 PASS; 11 SKIP; 0 FAIL | Store compartilhado em memória; não prova distribuição. |
| Browser Firefox | 149 PASS; 13 SKIP; 0 FAIL | Mesma limitação. |
| Browser WebKit | 162 bloqueados antes das assertions | Host sem `libgstcodecparsers-1.0.so.0`; não são 162 falhas do produto. |
| `npm run verify:static` | FAIL | SHA/evidências obsoletas ou fora da janela. |
| `npm run verify:triplo-aaa` | FAIL / `AAA_NOT_PROVEN` | Providers, staging, PostgreSQL atual e provas externas incompletas. |
| Backup gerenciado/RTO/RPO | BLOCKED/NOT_RUN | Ambiente e autoridade externa ausentes. |

## 6. Documentação e evidência

A documentação declara explicitamente que o estado global não está provado, mas mantém relatórios históricos contraditórios sobre PostgreSQL, browser, migrations e quantidade de testes. Foram encontrados:

- 53 documentos contendo `AAA_NOT_PROVEN`;
- 58 contendo `NOT_PROVEN`;
- 25 contendo `BLOCKED_EXTERNAL`;
- 84 contendo `NOT_RUN`.

O estado canônico atual também registra `productionState: NOT_PROVEN` e `aaaState: AAA_NOT_PROVEN`, além de providers reais, staging, backup gerenciado e aprovação humana ausentes.

## 7. Limitações

Não houve, nesta auditoria:

- consulta de privilégios em um PostgreSQL implantado pelo caminho completo;
- teste atual de concorrência/restore em PostgreSQL real para migrations 038/039;
- execução de DeepSeek ou providers reais;
- staging autorizado e vinculado a imagem imutável;
- carga/chaos representativa, RTO/RPO medido ou entrega real de alertas;
- WebKit funcional no host, leitor de tela ou zoom manual real;
- CI e pacote de promoção vinculados ao `HEAD` auditado;
- decisão humana de aceitar risco residual ou promover para produção.

## 8. Decisão

O sistema não deve ser promovido enquanto os achados altos permanecerem abertos. O primeiro fechamento obrigatório é a resolução autoritativa de recursos antes do PDP e do tool executor, acompanhada por regressão HTTP que capture o conteúdo realmente enviado ao provider. Em seguida, devem ser corrigidos recovery/readiness, sessão/leases, isolamento de persistência, privilégios do banco e ordenação do worker.

A execução proposta está detalhada no [roadmap](roadmap-remediacao-auditoria-2026-09-19.md) e no [backlog](backlog-remediacao-auditoria-2026-09-19.md).

## 9. Integridade da auditoria

- Fingerprint inicial e final: `95f6363076627e5347c9b13d37ac18aad8cd2576117fe259351d178f6b7aa6a7`.
- O repositório permaneceu sem mutação durante a auditoria.
- Alterações preexistentes no worktree foram preservadas.
- Duração aproximada: 28 min 25 s.
