# Prova de provider externo real

Status: `BLOCKED_EXTERNAL`.

`npm run verify:provider-real` usa o adapter HTTP governado, allowlist de host, segredo fornecido pelo ambiente, idempotency key e query de reconciliação. O comando exige `CVG_PROVIDER_REAL_URL`, `CVG_PROVIDER_REAL_BEARER_TOKEN`, `CVG_PROVIDER_REAL_ALLOWED_HOST`, `CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY` e destinatário controlado. O bundle vertical same-SHA referencia um arquivo por etapa (`appointment → PDP → approval → outbox → worker → provider → receipt → callback → inbox → effect-ledger → reconciliation → audit`); cada etapa também precisa de timestamp atual (máximo de sete dias de idade e máximo de cinco minutos no futuro). O verificador confere os bytes, rejeita symlink/traversal, valida a janela temporal e só então permite o envio. Uma resposta ambígua nunca é reenviada; ela exige `queryStatus` conclusivo.

O servidor loopback e o provider sintético têm cobertura de contrato, timeout, HMAC, receipt, `OUTCOME_UNKNOWN` e reconciliação. Isso não prova autorização para enviar uma mensagem a um provider externo nem o callback real.

O arquivo de evidência também precisa carregar uma atestação Ed25519 do produtor. O verificador recalcula o payload canônico, confere `signatureDigest`, exige uma chave pública confiável em `CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY` e só depois resolve as referências de evidência. Produtor e revisor devem ser distintos, a revisão independente deve estar marcada, e limitações e risco residual são obrigatórios. A chave não pode ser inferida do bundle; sem ela a execução permanece `BLOCKED_EXTERNAL`.
