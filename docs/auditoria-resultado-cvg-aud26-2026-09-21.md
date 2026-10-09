# Resultado da reauditoria CVG-AUD26 — 2026-09-21

Este documento registra a fotografia final desta execução local do programa CVG-AUD26. O estado canônico de tarefas e receipts está em `.agent/`; o manifesto de evidência em `artifacts/aud26/evidence-snapshot.json` é a única fonte do fingerprint exato da candidata. Os documentos anteriores continuam históricos e não são sobrescritos.

## Veredito e scores

**Veredito:** `AAA_NOT_PROVEN` — `PROMOTION_BLOCKED`.

**Score ponderado de evidência local:** **77,1/100**. É um score de engenharia da candidata, não uma aprovação Triple AAA. A promoção não recebe score numérico enquanto staging, providers, collector durável, proveniência/assinatura autorizada, operação production-like e aprovação humana não tiverem receipts legítimos.

| Dimensão | Peso | Nota | Base corrente |
|---|---:|---:|---|
| Documentação e rastreabilidade | 6 | 82 | pacote current, control plane append-only e matriz F01–F39 |
| Arquitetura e modularidade | 7 | 74 | seams melhorados; monólitos centrais ainda existem |
| Domínio e regras de negócio | 7 | 82 | invariantes e isolamento cobertos localmente |
| API e contratos | 6 | 80 | envelope executável; schemas específicos ainda incompletos |
| Segurança/auth/PDP | 10 | 86 | role, SSRF, rate limit e PDP com known-bads locais |
| Persistência e integridade | 12 | 76 | PostgreSQL real descartável; 24 slices ainda snapshot-primary |
| Restore/backup/recuperação | 11 | 62 | matriz local forte; managed RTO/RPO ausentes |
| IA e governança | 6 | 82 | limites e SSE bounded; provider real ausente |
| Worker e integrações | 6 | 83 | idempotência, fencing, egress e sandbox local |
| Frontend/acessibilidade | 6 | 82 | Chromium/Firefox e viewports passaram; WebKit host bloqueado |
| Testes/verificação | 8 | 86 | regressão, cobertura e E2E suportado; qualificação dupla não fechada |
| CI/supply chain | 5 | 70 | build/runtime/SBOM policy local; assinatura/OCI externo pendente |
| Observabilidade/operação | 5 | 63 | harness, retenção bounded e alertas locais; backend durável externo |
| Performance/escalabilidade | 3 | 74 | budget e 10k sintético; carga representativa ausente |
| Manutenibilidade/DX | 2 | 65 | TS strict/governança; modularização ampla pendente |
| **Total ponderado** | **100** | **77,1** | **não promove** |

## Tarefas CVG-AUD26

| Tarefa | Estado | Evidência/limite |
|---|---|---|
| 001 | DONE | control plane, barra e inventory current |
| 002 | DONE | migration 045/046 e role matrix de sete atributos |
| 003 | DONE | matriz real PostgreSQL, memberships/grants/ownership e oracle |
| 004 | DONE | verifier sem `GRANT ALL`, `CREATE` ou ownership artificial |
| 005 | DONE | rollback tardio pelo entrypoint público |
| 006 | DONE | replay, concorrência, alvo não vazio, desconexão e unknown local |
| 007 | PARTIAL | receipts/freshness current; alguns domínios dependentes permanecem parciais |
| 008 | PARTIAL | uma rodada completa suportada; segunda/qualificação externa não fechada |
| 009 | DONE | cardinalidade 10k bounded, redaction e labels estáveis |
| 010 | DONE | success/error/abort/timeout/disconnect sem spans órfãos |
| 011 | DONE | cleanup incremental, concorrente, observável e fail-closed |
| 012 | DONE | leitura de modelo SSE/body bounded e cancelamento incremental |
| 013 | DONE | messaging body/chunks bounded, cancelamento e unknown explícito |
| 014 | DONE | DNS/IP/rebind/redirect/IPv4-mapped policy |
| 015 | PARTIAL | egress/ADR/harness pass; schemas específicos de rota ainda são genéricos em parte da superfície |
| 016 | DONE | 32 collections classificadas; 8 command-authoritative/24 snapshot-primary explícitas |
| 017 | PARTIAL | framework/ADR e registry; cutovers das 24 slices ainda não executados |
| 018 | PARTIAL | coordinator bounded/idempotente; backfills reais das slices pendentes |
| 019 | PARTIAL | replay/concurrency do framework; migração completa ainda pendente |
| 020 | PARTIAL | reconciliação do framework; aposentadoria de legado ainda não autorizada |
| 021 | PARTIAL | ESLint e scan histórico passam; scanner dedicado e mutantes de gate pendentes |
| 022 | PARTIAL | thresholds line/branch/functions; Node não fornece statements neste relatório |
| 023 | PARTIAL | Chromium/Firefox e isolamento pass; WebKit bloqueado por dependência do host |
| 024 | DONE | split de rotas e bundle budget executável |
| 025 | PARTIAL | tokens/contraste estáticos pass; cobertura computed/rendered ainda limitada |
| 026 | DONE | `.dockerignore`, runtime compilado, non-root e smoke local |
| 027 | PARTIAL | digests/SBOM policy local; referências mutáveis e assinatura dependem de autoridade |
| 028 | PARTIAL | provenance/OCI preparados; atestação e verificação externa não executadas |
| 029 | PARTIAL | seams seguros incrementais; modularização dos monólitos ainda incompleta |
| 030 | PARTIAL | README/docs/resultado e pacote current; fechamento depende da matriz completa de dependências |
| 031 | PARTIAL | package manager, governança e TS strict pass; aprovação legal/supply externa ausente |
| 032 | PARTIAL | sink/retention/correlation local; backend durável externo ausente |
| 033 | PARTIAL | SLO/alerts/drill local; delivery/collector externo ausente |
| 034 | PARTIAL | load/chaos/DR sintéticos pass; production-like/RTO/RPO desconhecidos |
| 035 | BLOCKED_EXTERNAL | staging, providers, secrets, collector, AT/zoom e signed receipts não autorizados |
| 036 | BLOCKED_HUMAN | pacote de decisão preparado; nenhuma aprovação humana foi inferida |

## Matriz F01–F39

`PASS_LOCAL` significa que a parte reproduzível no checkout passou; `PARTIAL` significa que há implementação/prova local, mas o critério completo ainda não fecha; `BLOCKED_EXTERNAL/HUMAN` não é sucesso.

| Achado | Estado | Tarefa | Evidência current ou condição restante |
|---|---|---|---|
| F01 | PASS_LOCAL | 002,003 | role real e autoridade mínima no PostgreSQL descartável |
| F02 | PASS_LOCAL | 002 | sete atributos negativos, incluindo `NOREPLICATION` |
| F03 | PASS_LOCAL | 003 | matriz SQL independente de memberships/grants/ownership |
| F04 | PASS_LOCAL | 001 | M0 corrigiu estados AUD25 e importou 36 itens |
| F05 | PASS_LOCAL | 004 | verifier não fabrica autoridade ampla |
| F06 | PASS_LOCAL | 005 | failpoint tardio preserva destino/digest/ledger |
| F07 | PASS_LOCAL | 006 | replay/concurrency/disconnect/unknown no harness local |
| F08 | PASS_LOCAL | 007 | snapshot current bound ao sujeito; stale/`NOT_RUN` falha fechado |
| F09 | PARTIAL | 008 | falta segunda qualificação completa independente |
| F10 | PASS_LOCAL | 009,010 | cardinalidade e lifecycle de spans bounded |
| F11 | PARTIAL | 016–020 | 24 coleções continuam snapshot-primary |
| F12 | PARTIAL | 032 | durabilidade externa de logs ainda não provada |
| F13 | PARTIAL | 033,034 | drills locais; carga/DR representativos ausentes |
| F14 | BLOCKED_EXTERNAL/HUMAN | 033,035,036 | SLO delivery, staging e aceite humano |
| F15 | PASS_LOCAL | 011 | buckets com retenção/cleanup bounded |
| F16 | PARTIAL | 015 | contrato HTTP executável, schemas específicos incompletos |
| F17 | PASS_LOCAL | 012 | SSE incremental com byte budget/cancelamento |
| F18 | PASS_LOCAL | 013 | messaging bounded antes do buffering completo |
| F19 | PASS_LOCAL | 014 | DNS rebinding, redirects e IP policy |
| F20 | PASS_LOCAL | 010 | abort/timeout/disconnect fecham spans |
| F21 | PASS_LOCAL | 023 | portas/estado/retries nos projetos suportados |
| F22 | PASS_LOCAL | 023 | tablet e viewports Chromium/Firefox passaram |
| F23 | BLOCKED_EXTERNAL | 023,035 | WebKit não inicia: host sem `libgstcodecparsers-1.0.so.0` |
| F24 | PARTIAL | 021 | ESLint real passa; scanner dedicado ainda não instalado |
| F25 | PARTIAL | 022 | line 87,9%, branch 75,4%, functions 85,7%; sem métrica statements nativa |
| F26 | PASS_LOCAL | 024 | split e budget do build falham acima do limite |
| F27 | PASS_LOCAL | 025 | auditoria strict de tokens sem findings |
| F28 | PARTIAL | 025 | 12 pares estáticos; computed themes/estados ainda limitados |
| F29 | PASS_LOCAL | 026 | contexto/runtime non-root local |
| F30 | PARTIAL | 027 | alguns Compose/base inputs ainda exigem digest/update process |
| F31 | BLOCKED_EXTERNAL | 028,035 | signing/attestation de autoridade CI não executados |
| F32 | PASS_LOCAL | 026 | produção usa bundle compilado sem `tsx` |
| F33 | PASS_LOCAL | 030 | documentos atuais apontam para fonte canônica e históricos estão marcados |
| F34 | PARTIAL | 029 | seams incrementais; `app.ts`/persistence ainda grandes |
| F35 | PASS_LOCAL | 007 | diagnostics preservam stdout/stderr completos por gate |
| F36 | PARTIAL | 021 | scan atual/histórico pass; cobertura de scanner dedicado pendente |
| F37 | PASS_LOCAL | 031 | `packageManager` exato e install reproduzível |
| F38 | PASS_LOCAL | 031 | CODEOWNERS/SECURITY/CONTRIBUTING/CHANGELOG presentes |
| F39 | PASS_LOCAL | 031 | `noUnused*` e `skipLibCheck: false` no typecheck |

## Migrations e compatibilidade

As migrations `045_restore_role_contract_no_replication.sql` e `046_runtime_sequence_least_privilege.sql` são forward-only. A 045 fecha `NOREPLICATION` e os atributos da role de restore; a 046 remove o grant amplo de sequences herdado e concede somente a sequence necessária ao runtime. A instalação limpa e o upgrade foram executados no PostgreSQL 16 descartável: `migrations=46`, com inventory preservado e cleanup restrito ao banco efêmero criado pelo harness. Nenhuma migration anterior foi editada.

O framework de snapshot/comando é deliberadamente preparatório: classifica todas as 32 collections, registra 8 slices autoritativas e 24 slices `SNAPSHOT_PRIMARY`, e fornece coordinator de replay/concurrency/rollback/reconciliation. Ele não é apresentado como migração concluída das 24 slices.

## Checks reproduzidos

| Check | Resultado |
|---|---|
| `npm run verify:ephemeral-postgres -- --rounds=1 --run-restore` | PASS; migrations 46, oracle 10/10, restore PASS |
| `npm test` | regressão completa exigida; receipt current no ledger |
| `npm run typecheck` | PASS com `noUnusedLocals`, `noUnusedParameters`, `skipLibCheck: false` |
| `npm run lint` | PASS; custom 258 arquivos + ESLint flat config |
| `npm run verify:coverage` | thresholds line/branch/functions PASS após rebind; Node não expõe statements |
| `npm run build` / `build:runtime` | PASS; budget web e 3 entrypoints runtime |
| `npm run verify:schema-manifest` | PASS; latest 046 |
| `npm run verify:snapshot-command-migration` | PASS; 32/32, framework replay/rollback/reconciliation |
| `npm run verify:provider-sandbox` | PASS; loopback HTTP, replay/unknown/callback |
| `npm run verify:observability-local` | PASS local; external log/alert/RTO/RPO bloqueados |
| `npm run verify:load-local`, `verify:chaos-local`, `verify:dr-local` | PASS sintético; external/managed UNKNOWN ou BLOCKED |
| `npm run audit:tokens -- --strict`, `audit:contrast` | PASS; limitações estáticas declaradas |
| `npm run verify:pdp`, `verify:pdp-universal` | PASS; PDP e 26 rotas runtime |
| `npm run verify:secrets` | PASS histórico + working tree, exceção sintética documentada |
| `npm run test:e2e:smoke` | 332 pass, 22 skips condicionais, 0 falhas em Chromium/Firefox/stress |
| WebKit targeted | BLOCKED_EXTERNAL/toolchain: biblioteca GStreamer ausente; não houve skip silencioso |
| `git diff --check` | PASS |

## Gatilhos de desbloqueio

- `CVG-AUD26-008`: congelar a candidata e executar duas qualificações independentes com o mesmo manifesto, incluindo a matriz de browser disponível.
- `CVG-AUD26-017..020`: planejar e executar cutovers forward-only reais, backfill, reconciliação e retirement guard das 24 slices.
- `CVG-AUD26-023/035`: instalar dependência WebKit no runner autorizado e obter inspeção AT/zoom/manual.
- `CVG-AUD26-027/028/035`: fornecer identidade de CI, registry, signing key/issuer e receipts OCI assinados; nenhum segredo deve ser criado localmente.
- `CVG-AUD26-032..035`: fornecer staging/collector/backend de logs, providers e backup/restore gerenciados para medir RTO/RPO e delivery de alertas.
- `CVG-AUD26-036`: uma autoridade humana nomeada deve decidir `PROMOTE`, `REJECT` ou `DEFER`; o agente não escreve essa decisão.

Recomendação explícita: **PROMOTION BLOCKED**. O trabalho local seguro foi avançado e os limites restantes estão registrados; a candidata não deve ser promovida a produção nesta execução.
