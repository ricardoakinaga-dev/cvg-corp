# Scorecard final Triplo AAA

Resultado: `FAIL_WITH_LIMITATIONS`; Triplo AAA não provado. A escala abaixo (0–5) mede a evidência disponível nesta revisão, não uma certificação. `5` exigiria execução production-like, artefato rastreável e revisão independente.

| # | Dimensão | Score | Evidência/testes | Arquivos | Limitação | Risco residual |
|---:|---|---:|---|---|---|---|
| 1 | Arquitetura e boundaries | 4 | typecheck, static, audit F0 | `docs/final-closure-audit.md` | produção não executada | drift de composição |
| 2 | Domínio e fonte de verdade | 3 | testes de domínio/API | `packages/domain/` | repositories universais incompletos | inconsistência de projeção |
| 3 | Dados, RLS e migrações | 4 | migrations/RLS sintéticos | `db/migrations/` | staging PostgreSQL ausente | isolamento operacional não medido |
| 4 | DeepSeek bridge | 3 | testes HTTP/port + probe real ACP `initialize`/`session/new` com attestation de commit/manifesto; HMAC de contexto; turn nativo default-deny | `packages/deepseek-bridge/`; `apps/deepseek-bridge/`; `scripts/verify-deepseek-acp.ts` | turno de modelo, tools CVG, approval/replay, provider e staging não executados | resposta/usage/proveniência e falhas do engine não observadas |
| 5 | Provider externo | 3 | vertical sintética outbox → provider → unknown → reconciliação + servidor HTTP loopback real com replay, receipt, consulta e callback HMAC | `docs/provider-production-integration.md`; `scripts/verify-provider-sandbox.ts`; `tests/integration/provider-sandbox.test.ts` | provider/callback/receipt externos e settlement reais não executados | duplicidade/unknown em produção |
| 6 | Idempotência e efeitos | 3 | CAS/ledger/reconciliation fixtures | `packages/persistence/` | prova completa de restart ausente | efeito duplicado |
| 7 | PDP universal | 3 | policy/tool/API tests; `verify:pdp` com 64 operações, 68 regras de aplicação, 6 policies canônicas de tools e comparação do catálogo | `docs/pdp-universal-coverage.md`; `scripts/verify-pdp-coverage.ts` | matriz 100% route/domain/repository/job pendente | bypass de autorização |
| 8 | Secrets, MFA e break-glass | 3 | secret reference/readiness tests, TOTP enrollment/revocation/challenge tests e BreakGlassRegistry lifecycle tests | `packages/auth/`, `packages/config/`, `packages/integrations/`, `apps/api/` | authority/WebAuthn/persistência operacional ausentes | credencial/override |
| 9 | Worker e concorrência | 3 | fault/worker tests, budgets, concorrência limitada, backpressure e heartbeat/shutdown local | `apps/worker/`; `tests/unit/worker.test.ts` | execução/carga/backpressure production-like ausentes | backlog/lease |
| 10 | Observabilidade | 3 | redaction, SDK/exporter OTLP protobuf, teste de envio local e contratos de sinais | `packages/ops/src/otel.ts`; `tests/unit/ops.test.ts`; `docs/observability-production.md` | collector/staging, métricas/logs correlacionados, alert dispatch e SLO reais não executados | incidente sem detecção operacional |
| 11 | SLO e alertas | 2 | regras propostas/runbooks | `docs/runbooks/slo-breach.md` | sem amostra/dispatch real | budget desconhecido |
| 12 | Staging e TLS | 1 | verificador fail-closed | `docs/staging.md` | sem URL/evidência | configuração insegura |
| 13 | Frontend states | 3 | E2E Chromium/Firefox, screenshots reais e estados offline/revalidação | `apps/web/` | WebKit e estados externos continuam sem prova | UX ambígua sob engine/dep externa |
| 14 | Acessibilidade/browser matrix | 3 | axe login/dashboard/admin 8/8; Chromium/Firefox × 375/768/1440; stress em 320 CSS px, DPR 2, touch e reduced-motion; contraste computado | `docs/visual-qa-vNext.md` | WebKit bloqueado por dependências do host; leitor de tela, baseline visual e zoom real de 200% ausentes | regressão cross-engine/assistiva |
| 15 | Carga/performance | 2 | benchmark sintético | `docs/load-and-chaos.md` | sem carga production-like | saturação |
| 16 | Chaos/resiliência | 2 | fault fixtures | `tests/integration/faults.test.ts` | sem infra/provider chaos | recuperação desconhecida |
| 17 | Backup/recovery | 3 | restore sintético autenticado | `docs/recovery-proof.md` | backup gerenciado/RTO/RPO ausentes | perda prolongada |
| 18 | Auditoria/proveniência/custo | 3 | audit chain local `previousHash/recordHash`, usage/provenance locais | `packages/domain/`; `packages/persistence/`; `packages/ops/` | WORM/assinatura externa/settlement incompletos | contestação/uso não conciliado |
| 19 | Supply chain/CI/release | 3 | static/SBOM/workflow declarado | `.github/workflows/`, `README.md` | run remoto e scan atual não observados | artifact vulnerável |
| 20 | Crítica independente e aceite | 2 | dois pareceres I1 + F0 | `.gauntlet/`, `docs/final-closure-audit.md` | sem aprovação AAA e sem prova externa | liberação prematura |

## Veredito

Os pontos fortes locais são reais e reproduzíveis. O boundary ACP nativo agora tem prova local, o contexto do bridge é autenticado por HMAC, a UI revalida após 403/409 e o turno ACP direto está bloqueado sem governança; ainda assim, os bloqueadores críticos continuam sendo turno DeepSeek/provider/secret/staging reais, observabilidade, WebKit/assistive tech, carga/chaos, recovery operacional e CI remoto. A tentativa final de crítica fresca expirou sem relatório, portanto não existe aprovação independente. O próximo gate só pode mudar o veredito com evidência correspondente ao mesmo commit, não com documentação adicional isolada.
