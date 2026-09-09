# Runbook — break-glass

**Estado:** `BLOCKED` e não implementado para produção nesta etapa.
**Owner:** autoridade clínica/segurança a nomear. **Abortar se:** não houver MFA, motivo, dupla aprovação, escopo, TTL e revisão posterior.

O papel break-glass não é o papel `admin` comum. Até existir política aprovada, MFA, alçada independente, TTL curto, audit append-only, notificação e revogação automática, nenhuma operação de emergência é habilitada pelo CVG.

Em uma futura habilitação, negar por padrão, exigir finalidade e recurso exatos, registrar antes/depois, limitar dados D-class e executar revisão pós-incidente. Não usar este runbook para contornar uma policy comum.
