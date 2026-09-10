# Runbook — break-glass

**Estado:** `BLOCKED` para ativação pública/produção; o registro durável do ciclo de vida está implementado na migration `030_break_glass_durable_lifecycle.sql`.
**Owner:** autoridade clínica/segurança a nomear. **Abortar se:** não houver MFA, motivo, dupla aprovação, escopo, TTL e revisão posterior.

O papel break-glass não é o papel `admin` comum. Até existir política aprovada, WebAuthn verificado por provider real, alçada independente, TTL curto, audit append-only, notificação e revogação automática, nenhuma operação de emergência é habilitada pelo CVG. A migration 030 persiste apenas a evidência do grant já admitido pela boundary de aplicação; ela não verifica WebAuthn e não abre a capability.

O adapter PostgreSQL oferece `createBreakGlassGrant`, `assertActiveBreakGlassGrant`, `revokeBreakGlassGrant`, `reviewBreakGlassGrant` e `listBreakGlassGrants`. O banco força RLS organizacional, FKs de ator/aprovador/revisor, MFA `WEBAUTHN`, janela máxima de 15 minutos e transições forward-only (`ACTIVE → EXPIRED|REVOKED → REVIEWED`). Expiração é lazy e fail-closed; motivo, alvo e metadados de aprovação são imutáveis.

Em uma futura habilitação, negar por padrão, exigir finalidade e recurso exatos, registrar antes/depois, limitar dados D-class e executar revisão pós-incidente. Não usar este runbook para contornar uma policy comum. A evidência local de migration/RLS e testes sintéticos não substitui provider WebAuthn, autorização humana, staging, alertas ou exercício operacional.
