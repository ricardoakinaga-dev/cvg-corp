# ADR 004 — Persistência transacional e ledgers

**Status:** accepted; migrations aplicadas permanecem imutáveis.

Cada mutação usa unidade transacional, source normalizado, snapshot/journal, audit e receipt. Outbox, inbox e effect ledger mantêm idempotência, lease, fencing, resultado desconhecido e reconciliação. A migration 029 liga `ai_turns` ao ledger de usage por `usage_record_id`, persiste `provenance_json` e aplica escopo DML estrito nas projeções contextuais.

Um commit local não confirma efeito externo. O efeito só pode ser concluído com receipt verificável ou observação autorizada do provider. Exportações de recuperação passam por `ExportApplicationService`, purpose/TTL, PDP, auditoria, idempotência e envelope AES-256-GCM; o caminho exige PostgreSQL e referência de chave resolvida por `SecretProvider`.
