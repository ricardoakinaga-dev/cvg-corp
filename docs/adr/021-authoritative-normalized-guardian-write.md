# ADR-021 — Escrita normalizada autoritativa de Guardian

## Status

Aceito para implementação local; PostgreSQL concorrente, staging e promoção
operacional continuam pendentes.

## Problema e evidência atual

`POST /api/v1/guardians` já validava sessão, CSRF, PDP e idempotência, mas o
comando terminava em `CvgStore.createGuardian` e o `onSend` só materializava a
entidade por meio da projeção genérica do snapshot. Isso deixava o owner da
linha `guardians` implícito e permitia que uma projeção posterior fosse tratada
como se fosse a escrita do comando.

A tabela já possui `organization_id`, `unit_id`, `workspace_id`, campos de
identificação, `data_class`, `status`, FKs compostas e RLS. Não foi necessária
uma migration. O contrato `Guardian` não expõe `created_at`; esse timestamp
continua sendo metadado gerado pelo banco e não participa da equivalência do
agregado.

## Decisão

Adicionar `GuardianApplicationService` e um port assíncrono de
`GuardianRepository`, com adapters de store e PostgreSQL. O resultado novo do
comando é passado como `normalizedGuardianWrite` ao commit durável. O commit:

1. exige Guardian idêntico ao snapshot e dependências da mesma organização,
   unidade e workspace;
2. estabelece o escopo PostgreSQL antes do DML;
3. executa um `INSERT ... ON CONFLICT (id) DO UPDATE` condicionado à igualdade
   de todos os campos do contrato, incluindo comparação nula de `email`, e
   exige `RETURNING id`;
4. remove o ID command-owned da projeção genérica;
5. em replay, usa `normalizedGuardianReplayId` para avançar auditoria/receipt
   sem emitir um segundo DML de Guardian;
6. propaga corrupção, conflito ou falha de persistência com rollback, sem
   inferir sucesso.

O schema `guardianInputSchema` passa a ser o contrato compartilhado pela rota,
catálogo e application service; `unitId` e `workspaceId` continuam derivados
do contexto autenticado, nunca do payload.

## Invariantes e falhas

- resposta de criação em PostgreSQL só ocorre depois do commit durável;
- mesma chave e mesmo corpo devolvem o mesmo receipt sem segundo Guardian DML;
- corpo divergente retorna conflito de idempotência;
- ID, organização, escopo, nome, telefone, email, `dataClass` ou status
  divergentes falham fechado;
- escopo incompleto, dependência cross-tenant, linha existente incompatível e
  falha no restante da transação causam rollback;
- RLS e FKs permanecem backstops independentes da validação de aplicação.

## Alternativas rejeitadas

- **Projeção genérica:** não expressa ownership e pode sobrescrever a linha.
- **SQL na rota:** mistura transporte e persistência e amplia o blast radius.
- **Abstração genérica para todos os contextos:** adiada até que os invariantes
  dos oito contextos restantes estejam delimitados.
- **Repository sem commit autoritativo:** rejeitado; apenas troca o nome da
  camada e não fecha a fronteira transacional.

## Verificação e limites

Testes locais cobrem schema, port, UPSERT condicionado, equivalência do
snapshot, escopo, replay sem segundo DML, boundary HTTP PostgreSQL injetada e
rollback. O pool usado nesses testes é sintético. A execução não prova
concorrência PostgreSQL multi-processo/RLS fora do CI, backup gerenciado,
staging, provider/DeepSeek, observabilidade operacional, carga/chaos/recovery
production-like ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
