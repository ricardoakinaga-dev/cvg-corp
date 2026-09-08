# Gauntlet — crítica independente round 2

**ID:** `CRIT-CVG-20260908-002`
**Escopo:** `CVG-FULL-IMPLEMENTATION`
**Bar congelada:** `.gauntlet/bar-v2.json`
**Independência:** leitura read-only em contexto fresco (`fork_context: false`); o crítico não editou o worktree e executou build/E2E em cópia isolada.

## Evidência executada

- `npm run typecheck`: passou.
- `npm test`: 20/20 passaram.
- `npm run build`: passou.
- `npm run verify:static`: passou.
- `npm run test:e2e`: 9/9 passaram em Chromium nos viewports `375/768/1440`.
- `npm run audit:contrast`: passou.
- `npm run audit:tokens -- --strict`: passou com 72 sinais heurísticos médios de cores próximas.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- `git diff --check`: passou.
- `npm run db:check`: bloqueado por `ECONNREFUSED 127.0.0.1:5440`; Docker também não está disponível nesta sessão.

## Resultado contra a barra

| Critério | Estado atual | Observação principal |
|---|---|---|
| IMPL-01 | EVIDENCED | API/web, health e readiness locais observados. |
| IMPL-02 | PARTIAL | Envelope, UUIDs e schemas existem; faltam rejeição de campos desconhecidos, `schemaVersion` operacional e compatibilidade. |
| IMPL-03 | EVIDENCED | Login, cookie HttpOnly, CSRF, logout, sessão revogada e escopo server-side cobertos. |
| IMPL-04 | PARTIAL / CRÍTICA | Invariantes passam no processo local, mas não há transação, lock ou crash/concurrency real. |
| IMPL-05 | PARTIAL / CRÍTICA | Receipts/auditoria existem, mas não são duráveis nem atomicamente vinculados ao efeito; desaparecem no restart. |
| IMPL-06 | PARTIAL / ALTA | Harness local cobre allowlist, policy, approval, budget simples, provenance e replay; não há dispatch/admission/egress real. |
| IMPL-07 | EVIDENCED | Contratos e rotas mínimas atravessam os contextos do recorte. |
| IMPL-08 | PARTIAL / CRÍTICA | Restore local bloqueia e revoga; journal independente e restore operacional não foram comprovados. |
| IMPL-09 | PARTIAL / ALTA | Health, readiness, métricas e correlation existem; observabilidade ainda é superficial. |
| IMPL-10 | PARTIAL / ALTA | E2E cobre cockpit e estados básicos; offline, ação negada visível e recovery/foco completo não têm implementação/evidência. |
| IMPL-11 | PARTIAL / ALTA | Viewports e overflow cobertos; só Chromium/dashboard padrão, sem matriz completa de browsers/DPR/touch/estados. |
| IMPL-12 | PARTIAL / ALTA | Escopo e limites estão alinhados após esta atualização; esta crítica é o ledger fresco, mas os critérios acima impedem aprovação integral. |

## Gap dominante e veredito

O maior gap é persistência transacional durável com journal independente. Ele bloqueia simultaneamente IMPL-04, IMPL-05 e IMPL-08. O veredito do escopo integral é **FAIL**: há critérios P0 em `PARTIAL` e a prova PostgreSQL/restore está bloqueada. O artifact local continua útil como demonstração sintética e base de implementação, mas não é release nem uso operacional.
