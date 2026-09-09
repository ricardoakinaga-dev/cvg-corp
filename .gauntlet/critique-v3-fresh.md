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
