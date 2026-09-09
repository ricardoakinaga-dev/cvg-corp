# Críticas independentes frescas — v3

**Escopo:** `CVG-FULL-STATE-OF-THE-ART`
**Barra:** [`.gauntlet/bar-v3.json`](bar-v3.json)
**Resultado:** `FAIL_WITH_LIMITATIONS`; Triplo AAA não elegível.

Este registro consolida os resultados read-only produzidos em contextos frescos pelos críticos abaixo. O texto é um índice de evidência mantido pelo lead; não transforma crítica em aprovação independente nem substitui a saída original do worker.

## Linnaeus — arquitetura, API, runtime, tools e PDP

**Worker:** `01a08377-3e8d-7502-b761-4a9d58fa3577`
**Decisão:** `FAIL_WITH_LIMITATIONS`.

O crítico reconheceu a correção do catálogo de rotas e dos schemas estritos do adapter durante a rodada. Permanecem como riscos: `apps/api/src/app.ts` ainda concentra lógica demais; o bridge DeepSeek é um contrato CVG `/v1`, sem prova de protocolo nativo; o Tool Gateway e o PDP não foram demonstrados como caminho universal de toda rota/repository; e a cobertura de contratos/runtime real não foi executada.

## Sartre — segurança, dados e reliability

**Worker:** `01a08377-3ecc-7c03-b751-33fafcf797a7`
**Decisão:** `FAIL_WITH_LIMITATIONS`.

O crítico confirmou que projeções de IA derivam escopo da sessão, o hydrate mais recente reduz risco de snapshot obsoleto, a migration 019 adiciona guards das projeções e a configuração de produção falha fechado. Permanecem parciais a idempotência distribuída, o worker com sink habilitado, MFA/secret manager de produção, PostgreSQL production-like, fault injection, restore operacional e provas de concorrência/multi-instância.

## Nash — frontend, operação, deploy, supply chain e SLO

**Worker:** `01a08377-3f25-7711-8004-4c22359f4655`
**Decisão:** `FAIL_WITH_LIMITATIONS`.

O crítico reconheceu a web modular, os estados explícitos de conectividade, o bloqueio de writes fora de `ONLINE`, os artefatos de release, a política de dependências/SBOM e o seam OTel. Permanecem não executados cross-browser/axe/leitor de tela, CI remoto, build/scan de imagens, carga, collector/alertas/SLO e integrações reais. O bridge DeepSeek continua sem prova de ser uma implementação nativa do DSH.

## Decisão do gauntlet

Os críticos não encontraram autorização para liberar dados, segredos, egress, break-glass, provider externo ou produção. Findings corrigíveis foram incorporados e revalidados pelos gates locais; os blockers de ambiente/autoridade permanecem. A classificação correta é `FAIL_WITH_LIMITATIONS`, mantendo desenvolvimento sintético e exigindo uma nova rodada depois de evidência PostgreSQL/Docker/provider/authority production-like.

## Tentativa posterior de revisão final

Três novos workers read-only (`Arendt` `01a083c9-4675-7ea3-bad6-f0829aea7345`, `Plato` `01a083c9-46e1-7ab0-954e-4e8a0ed6af26` e `Hegel` `01a083c9-4638-75a0-bdcb-102b89cda68e`) foram iniciados após a integração final. Nenhum produziu relatório dentro de três janelas de 30 segundos; foram encerrados, sem escrita no workspace. Esta tentativa é `NOT_RUN`, não aprovação e não altera o veredito. Uma revisão independente final continua sendo requisito do próximo gate.
# Registro de tentativa de crítica fresca — round 2 — 2026-09-09

Após as mudanças de autenticação, UI, worker e fault harness, foi aberta uma crítica ampla read-only (`Zeno`, `01a08418-696a-7d61-b0fc-eb459aa519e5`) e, em seguida, três críticas estreitas independentes (`Carver`, `Aquinas`, `Hilbert`) para auth, frontend e operations. Nenhum relatório retornou após as janelas de espera; todos foram encerrados sem escrita. Esta tentativa é `NOT_RUN_TIMEOUT`, não aprovação. Os pareceres efetivamente disponíveis abaixo continuam sendo a evidência negativa/limitada da rodada anterior.

## Tentativa posterior — gates de CI/release — 2026-09-09

Dois workers read-only em contexto fresco (`Kant`, `01a08434-0f2c-79e1-bab9-efe9428a7a6e`, backend/segurança/reliability; `Halley`, `01a08434-0f8d-75c2-8d05-ccb9a50194a0`, frontend/runtime/operação) foram iniciados para revisar a barra corrente após os gates de CI/release. Após janelas de espera e pedido de encerramento conciso, ambos foram encerrados ainda em `running`, sem parecer entregue e sem escrita no workspace. Esta tentativa é `NOT_RUN_TIMEOUT`, não aprovação. A crítica negativa/limitada anterior permanece vigente e a revisão independente final continua requisito para qualquer decisão AAA.

## Críticos frescos posteriores — implementação final local — 2026-09-09

Dois críticos read-only em contexto fresco, `Bacon` e `Hubble`, revisaram o artifact após o endurecimento de Tool Gateway, persistência, provider, rate limit, UI e release. Ambos retornaram `FAIL`; a sentinela de mutação permaneceu intacta.

### Bacon — frontend, QA, acessibilidade e release

Reconheceu a UI responsiva e coerente, a remoção de dados estáticos enganosos, os estados offline/revalidação, CSP endurecida, actions pinadas e limites de recursos no Compose. Manteve como gaps a ausência de Firefox/WebKit/hasTouch/axe/leitor de tela, estados degradados de sessão/provider/stale não exercitados, ausência de smoke real de container/TLS e a classificação de tokens com 72 sinais heurísticos medium. Não encontrou base para aprovação AAA.

### Hubble — persistência, integrações e segurança operacional

Reconheceu runtime role não-superuser com RLS, rate limit distribuído, ledger durável de execução de tools, estados `OUTCOME_UNKNOWN`/`RECONCILING`/`FAILED_FINAL`, callback HMAC sobre corpo bruto, allowlist/SSRF guard do provider e proveniência de aprovação. Manteve como gaps a ausência de PostgreSQL/containers/secret authority/provider reais, wiring operacional externo, prova distribuída de recovery/SLO e a necessidade de demonstrar uso universal do PDP; apontou também que a execução local continua sintética. Não encontrou base para aprovação AAA.

### Integração do gauntlet

Findings corrigíveis desta rodada foram incorporados e revalidados pelos gates locais. Os blockers externos e de autoridade permanecem explícitos; a decisão final da rodada continua `FAIL_WITH_LIMITATIONS`, sem promoção de `AAA_NOT_PROVEN` para aprovação.
