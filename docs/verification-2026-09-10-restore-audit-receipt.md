# Verificação — restore durável de auditoria e recibos

Data: 2026-09-10
Base da lane: `b932b4d34a5e918cbd2222b05510a43b3bc907ba`
Resultado: `PASS_WITH_LIMITATIONS` local/CI; `AAA_NOT_PROVEN` global

## Escopo

O drill passa `auditRecords` e `commandReceipts` ao commit do destino,
confere as tabelas canônicas pelos IDs na ordem dos ledgers append-only,
preserva a cadeia de hash e compara os digests dos ledgers na mesma sequência.
Após a persistência, o snapshot do destino continua em quarentena e sem
sessões ativas. A origem é comparada antes/depois. Não há provider real,
staging, dados reais, deploy/promoção ou autoridade de backup gerenciado.

## Evidência

- `scripts/verify-postgres-restore.ts` projeta os dois conjuntos de registros
  e compara IDs/digests ordenados no snapshot e no banco destino;
- `scripts/verify-static.ts` protege a composição do drill e a presença dos
  dois ledgers canônicos;
- `tests/integration/persistence.test.ts` já cobre a projeção transacional de
  auditoria e recibos no commit durável;
- comandos locais previstos: `npm run test:database`, `npm run verify:static`,
  `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` e
  `git diff --check`.
- CI exato: run `34482107578`, job principal `102887199009`, imagens
  `102889497843`; o `PostgreSQL restore gate` terminou `success`.

## Limitações

O banco fonte/destino real só é exercitado quando o CI fornece PostgreSQL;
este documento não transforma uma execução sintética em prova de backup
gerenciado, RTO/RPO, concorrência/RLS, crash recovery, staging, telemetria,
provider/DeepSeek ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
