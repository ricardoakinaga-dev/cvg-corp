# ADR 004 — Persistência transacional e ledgers

**Status:** accepted; migrations aplicadas permanecem imutáveis.

Cada mutação usa unidade transacional, source normalizado, snapshot/journal, audit e receipt. Outbox, inbox e effect ledger mantêm idempotência, lease, fencing, resultado desconhecido e reconciliação.

Um commit local não confirma efeito externo. O efeito só pode ser concluído com receipt verificável ou observação autorizada do provider.
