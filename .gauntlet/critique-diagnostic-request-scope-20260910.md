# Fresh critique — diagnostic request source write and scope

Data: 2026-09-10
Escopo: `CVG-FULL-STATE-OF-THE-ART:NORMALIZED-DIAGNOSTIC-REQUEST-WRITE`

## Resultado

O critic fresh Beauvoir inspecionou o WIP read-only e retornou
`NOT_COMPLETED`, sem aprovação. Ele identificou como gaps de alta prioridade o
backstop RLS de `diagnostic_requests`, a fidelidade limitada do fake pool, a
contagem desatualizada da evidência e o inventário incompleto.

Os achados foram tratados na implementação corrente:

- `db/migrations/032_diagnostic_request_scope.sql` adiciona escopo derivado do
  atendimento, shape check, FKs compostas, índice e policies DML exatas;
- a persistência inclui o escopo no write autoritativo e na projeção genérica,
  com validação de paciente/atendimento e replay sem segundo DML;
- `verify-postgres` exercita criação/replay em PostgreSQL real do CI, verifica
  as colunas persistidas e testa ocultação/updates fora do workspace/unidade;
- ADR, evidência e migration foram adicionados aos inventários de release e ao
  índice de documentação; os números locais foram sincronizados.

Uma segunda tentativa fresh, Cicero, foi iniciada após essas correções e
encerrada como `NOT_COMPLETED` depois de várias janelas bounded sem relatório.
Não há aprovação independente atribuída. O pool sintético continua sendo
evidência de contrato local; a prova PostgreSQL depende do gate remoto/ambiente
explicitamente identificado.

## Limites preservados

Ainda não há prova de todos os demais writes normalizados (specimen/result,
queue, hospitalization, medication, stock, finance, communication, knowledge
e AI-session), concorrência fora do gate executado, staging autorizado,
provider/DeepSeek/segredos, Collector/SLO operacional, carga/chaos/recovery,
matriz assistiva completa ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS / AAA_NOT_PROVEN`.
