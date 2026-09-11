# State of the Art / Triplo AAA scorecard

**Barra ativa:** `.gauntlet/bar-v4.json` — congelada, 2026-09-11, com o prompt operacional de 2026-09-10 e SHA `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`.
**Barra histórica:** `.gauntlet/bar-v3.json` permanece imutável para rastreabilidade.
**Resultado:** `FAIL_WITH_LIMITATIONS`; não elegível para `AAA`.

**Fotografia de evidência local — 2026-09-09:** lint, typecheck, build e static PASS; 82/82 testes unitários/integração; recovery manifest, PDP target-bound, Tool Gateway com sessão/alvo/escopo e ledger durável, scheduler de seis lanes, provider HTTP fail-closed, reconciliação `OUTCOME_UNKNOWN`, catálogo de oito SLOs e alertas tipados, gates de staging/AAA e CSP sem `unsafe-inline` foram implementados. Static: 35 artefatos obrigatórios e 108 fontes; E2E Chromium: 22 testes executados PASS nos viewports 375/768/1440 e dois skips intencionais; contraste 7/7; tokens sem high/critical e 72 sinais medium heurísticos; `npm audit --omit=dev` sem vulnerabilidades; SBOM CycloneDX; licenças para 193 dependências; benchmark local explicitamente sintético. `verify:production` validou o Compose estrutural com limites de CPU/memória e valores sintéticos, sem iniciar serviços. `verify:triplo-aaa` retornou `AAA_NOT_PROVEN`/exit 2 e `verify:staging` retornou `STAGING_EVIDENCE_INCOMPLETE`/exit 2, preservando o fail-closed.

## Dimensões

| Dimensão | Situação | Evidência |
|---|---|---|
| Arquitetura e contratos | Parcial | packages de runtime/policy/tools, catálogo API e ADRs |
| Runtime e tools | Parcial | Mock + testes negativos; DeepSeek real não executado |
| API e aplicação | Parcial | entrypoint pequeno, services/routes/read repositories/command boundary extraídos e detalhe de paciente com PDP target-bound; app ainda concentra composição HTTP e o uso universal do PDP não foi provado |
| Dados e reliability | Parcial | migrations aditivas, manifesto de recovery, ledger/fencing e fault harness local; DB limpo/multi-instância/distribuído e backup gerenciado não executados |
| Segurança e governança | Parcial | fail-closed, escopo, headers, secret refs, MFA/lockout/rotação/recuperação local; autoridade real ausente |
| Web e offline | Parcial | shell/features, URL/history, agenda real, `REVALIDATING` bloqueador; browsers/axe profundo não executados |
| Deploy e operação | Parcial | Docker/Compose com limites, CI com actions pinadas por SHA, runbooks, worker lifecycle/scheduler de seis lanes e catálogo de SLO/alertas local; collector, baseline, alertas enviados, jobs/stores reais, imagens/startup/container smoke não executados |
| Vertical real | Não executada | provider, receipt, settlement e reconciliação externos bloqueados |

## Regra de elegibilidade

A barra exige evidência executável para todos os critérios obrigatórios, mínimo de 95 por dimensão e no agregado, sem `PARTIAL`, `NOT_RUN`, blocker ou crítica independente negativa. O benchmark local possui amostras brutas, mas não há pontuação de capacidade nem SLO de produção. Os resultados acima não são pontuações; são uma classificação de cobertura e impedem qualquer alegação Triplo AAA.

## Próximo gate

Executar ambiente PostgreSQL/Docker production-like, completar observabilidade/segurança/backup, medir os SLOs com workload aprovado, obter autoridade e provider aprovados, provar a cobertura universal do PDP/ledger e repetir críticas frescas. Até lá, preservar o mock, o egress fechado e os dados sintéticos.
