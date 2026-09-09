# State of the Art / Triplo AAA scorecard

**Barra:** `.gauntlet/bar-v3.json` — congelada, 2026-09-08.
**Resultado:** `FAIL_WITH_LIMITATIONS`; não elegível para `AAA`.

**Fotografia de evidência local:** lint, typecheck, build e static PASS; 65/65 testes unitários/integração; static com 30 artefatos e 101 fontes; E2E Chromium com 22/22 casos executados PASS em 375/768/1440 e dois skips intencionais; contraste 7/7, dependency audit sem vulnerabilidades, SBOM CycloneDX, política de licenças para 193 dependências e fault/worker harness local PASS. `verify:production` validou os gates locais e o Compose estrutural com valores sintéticos, sem iniciar serviços. O workflow declara PostgreSQL/migrations/restore, E2E, segurança/visual, Dependabot, SBOM e scan Trivy de imagens; CI remoto, imagens e scan não foram executados neste host.

## Dimensões

| Dimensão | Situação | Evidência |
|---|---|---|
| Arquitetura e contratos | Parcial | packages de runtime/policy/tools, catálogo API e ADRs |
| Runtime e tools | Parcial | Mock + testes negativos; DeepSeek real não executado |
| API e aplicação | Parcial | entrypoint pequeno, services/routes/read repositories/command boundary extraídos; app ainda concentra composição HTTP |
| Dados e reliability | Parcial | migrations aditivas, ledger/fencing e fault harness local; DB limpo/multi-instância/distribuído não executados |
| Segurança e governança | Parcial | fail-closed, escopo, headers, secret refs, MFA/lockout/rotação/recuperação local; autoridade real ausente |
| Web e offline | Parcial | shell/features, URL/history, agenda real, `REVALIDATING` bloqueador; browsers/axe profundo não executados |
| Deploy e operação | Parcial | Docker/Compose/CI/runbooks, worker lifecycle e release estrutural; imagens/startup/container smoke não executados |
| Vertical real | Não executada | provider, receipt, settlement e reconciliação externos bloqueados |

## Regra de elegibilidade

A barra exige evidência executável para todos os critérios obrigatórios, mínimo de 95 por dimensão e no agregado, sem `PARTIAL`, `NOT_RUN`, blocker ou crítica independente negativa. O benchmark local possui amostras brutas, mas não há pontuação de capacidade nem SLO de produção. Os resultados acima não são pontuações; são uma classificação de cobertura e impedem qualquer alegação Triplo AAA.

## Próximo gate

Executar ambiente PostgreSQL/Docker production-like, completar observabilidade/segurança/backup, obter autoridade e provider aprovados e repetir críticas frescas. A integração local application/PDP/command boundary já está coberta; até lá, preservar o mock, o egress fechado e os dados sintéticos.
