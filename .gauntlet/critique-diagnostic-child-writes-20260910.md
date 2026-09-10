# Fresh critique — diagnostic child integrity backstop

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:NORMALIZED-DIAGNOSTIC-CHILD-WRITES`

## Resultado

O critic fresh Ramanujan (`01a08c55-75fc-73a1-bc82-bcc26c55dcef`) concluiu uma
revisão read-only do commit
`400e40f5a76529f9a661c31a66d6950d7d0bfc2e` e não emitiu aprovação AAA.
Não encontrou P0, confirmou os ports/application services, `RETURNING`,
replay sem segundo DML e os gates locais já executados. Encontrou os seguintes
achados:

- **P1 — escopo `NULL/NULL`:** a migration 033 permitia que uma inserção SQL
  direta omitisse o escopo de um filho de pedido vinculado, pois as FKs
  compostas com `NULL` não eram suficientes e a policy de leitura era
  permissiva;
- **P1 — cadeia clínica incompleta:** as FKs existentes não obrigavam o
  `request_id` e `patient_id` do resultado a permanecerem coerentes com o
  espécime e o pedido;
- **P2 — idempotência HTTP:** a rota de espécime aceitava qualquer string
  presente, sem aplicar o formato/limite comum de `requireIdempotencyKey`;
- riscos de prova: negativos de RLS/SQL direto, migração/backfill e
  concorrência/replay PostgreSQL.

Os achados foram aceitos e tratados em uma nova migration aditiva 034, sem
alterar o checksum da migration 033: FKs de paciente/cadeia, guards
`BEFORE`/`SECURITY DEFINER` para escopo e integridade, guard de atualização do
pedido e policies de leitura DML-exatas. A rota agora chama
`requireIdempotencyKey`; `verify-postgres` foi ampliado com tentativas
negativas e leitura sem contexto. O CI do SHA corrigido é obrigatório antes de
fechar a lane.

## Veredito

`REVIEW_ONLY_FINDINGS`; sem P0 encontrado, sem aprovação AAA. O programa
continua `FAIL_WITH_LIMITATIONS / AAA_NOT_PROVEN` até a nova migration ser
executada em PostgreSQL, a concorrência externa ser demonstrada e os gates de
provider/DeepSeek, staging, observabilidade/SLO, carga/chaos/recovery, matriz
assistiva e aceite humano serem satisfeitos.
