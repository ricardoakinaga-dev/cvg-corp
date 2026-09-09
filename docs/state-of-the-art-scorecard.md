# State of the Art / Triplo AAA scorecard

**Barra:** `.gauntlet/bar-v3.json` — congelada, 2026-09-08.
**Resultado:** `FAIL_WITH_LIMITATIONS`; não elegível para `AAA`.

**Fotografia de evidência local:** typecheck PASS; 56/56 testes unitários/integração; build PASS; 15/15 E2E Chromium em 375/768/1440; static PASS com 23 artefatos/97 fontes; dependency audit, SBOM CycloneDX, política de licenças, contraste e benchmark sintético PASS. O workflow declara Dependabot e scan Trivy de imagens; imagens não foram construídas neste host sem daemon Docker.

## Dimensões

| Dimensão | Situação | Evidência |
|---|---|---|
| Arquitetura e contratos | Parcial | packages de runtime/policy/tools, catálogo API e ADRs |
| Runtime e tools | Parcial | Mock + testes negativos; DeepSeek real não executado |
| API e aplicação | Parcial | entrypoint pequeno, services/routes/read repositories/command boundary extraídos; app ainda concentra composição HTTP |
| Dados e reliability | Parcial | migrations aditivas e testes locais; DB limpo/multi-instância não executados |
| Segurança e governança | Parcial | fail-closed, escopo, headers, secret refs; auth de produção ausente |
| Web e offline | Parcial | shell/features/state machine; browsers/axe profundo não executados |
| Deploy e operação | Parcial | Docker/Compose/CI/runbooks e baseline local; imagens/startup/SBOM não executados |
| Vertical real | Não executada | provider, receipt, settlement e reconciliação externos bloqueados |

## Regra de elegibilidade

A barra exige evidência executável para todos os critérios obrigatórios, mínimo de 95 por dimensão e no agregado, sem `PARTIAL`, `NOT_RUN`, blocker ou crítica independente negativa. O benchmark local possui amostras brutas, mas não há pontuação de capacidade nem SLO de produção. Os resultados acima não são pontuações; são uma classificação de cobertura e impedem qualquer alegação Triplo AAA.

## Próximo gate

Executar ambiente PostgreSQL/Docker production-like, completar observabilidade/segurança/backup, obter autoridade e provider aprovados e repetir críticas frescas. A integração local application/PDP/command boundary já está coberta; até lá, preservar o mock, o egress fechado e os dados sintéticos.
