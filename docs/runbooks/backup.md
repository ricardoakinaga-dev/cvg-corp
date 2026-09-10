# Runbook — backup

**Estado:** contrato operacional; backup gerenciado `NOT_RUN`.
**Owner:** dados/ops. **Abortar se:** watermark, integridade, retenção, chave ou escopo não puderem ser comprovados.

O backup deve produzir manifest com artifact/schema, watermark reconciliado, escopo, classes de dados, digest, timestamp, retenção e referência de chave externa. Snapshot, journal, audit, receipts, outbox/inbox, usage/provenance e efeitos externos são inventariados sem incluir segredo. Quando uma cópia governada for necessária pelo caminho da aplicação, use `POST /api/v1/ops/export` com purpose, TTL e `Idempotency-Key`; essa capability exige PostgreSQL e não substitui backup gerenciado.

Validar contagem, digest e isolamento antes de marcar o job como concluído. Falha ou watermark incompleto deixa o bundle bloqueado e abre incidente; não se anuncia RPO a partir de um arquivo local.
