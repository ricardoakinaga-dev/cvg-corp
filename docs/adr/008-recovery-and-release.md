# ADR 008 — Recuperação e liberação por evidência

**Status:** accepted for implementation; gate integral permanece `FAIL_WITH_LIMITATIONS`.

Backup/restore precisa de manifest, checksum, criptografia, key reference, quarentena, revogação de sessão, validação e replay supervisionado. Rollback de aplicação só ocorre quando schema e dados são compatíveis; efeitos externos posteriores são reconciliados.

Release, dados reais, break-glass e provider exigem gate específico, evidência atual e autoridade humana. A barra v3 nunca é reduzida para converter lacuna em aprovação.
