# ADR-022 — Escrita normalizada autoritativa de pedido de exame

## Status

Aceito para implementação local; PostgreSQL concorrente, staging e promoção
operacional continuam pendentes.

## Problema

`POST /api/v1/diagnostics/requests` validava o comando e registrava o pedido
apenas no `CvgStore`; no modo PostgreSQL a linha normalizada era materializada
somente pelo passe genérico do snapshot. Isso não deixava explícito qual
fronteira possuía a escrita nem protegia a resposta contra uma projeção
divergente.

## Decisão

Adicionar `DiagnosticRequestApplicationService` com um port
`DiagnosticRequestRepository`. O resultado do comando é passado como
`normalizedDiagnosticRequestWrite` ao mesmo commit durável do snapshot.

O commit:

1. exige equivalência entre o pedido command-owned e o snapshot canônico;
2. valida organização, paciente, atendimento, solicitante e escopo completo do
   atendimento;
3. estabelece `cvg.unit_id` e `cvg.workspace_id` derivados do atendimento;
4. executa um `INSERT ... ON CONFLICT ... DO UPDATE` condicionado à igualdade
   de todos os campos e exige `RETURNING id`;
5. remove o ID command-owned da projeção genérica;
6. em replay, remove o ID da projeção sem emitir outro DML do pedido;
7. propaga divergência, conflito ou falha transacional com rollback.

O paciente, o atendimento e o solicitante continuam sendo resolvidos pelo
contexto/autorização e pelo domínio; o payload não escolhe unidade nem
workspace.

## Invariantes

- A resposta de criação em PostgreSQL só é liberada após o commit durável.
- A mesma chave e corpo retornam o mesmo receipt sem segundo DML do pedido.
- Um candidato que diverge do snapshot, escopo ou dependências falha fechado.
- a migration 032 persiste o escopo derivado, adiciona shape check/FKs
  compostas com atendimento, paciente, unidade e workspace, e aplica policies
  DML exatas; RLS, FKs e a igualdade condicionada do UPSERT permanecem
  backstops independentes da aplicação;

## Alternativas rejeitadas

- Projeção genérica: deixa ownership implícito e pode competir com o comando.
- SQL na rota: mistura transporte, domínio e persistência.
- Abstração genérica sem validar as dependências clínicas: perderia a relação
  entre pedido, paciente e atendimento.

## Verificação e limites

Testes locais cobrem port, UPSERT condicionado, equivalência, dependências,
escopo, replay sem segundo DML, boundary HTTP PostgreSQL injetada e rollback.
`verify:postgres` cobre adicionalmente o caminho real em PostgreSQL efêmero no
CI, incluindo replay, colunas de escopo e isolamento RLS. O pool usado nos
testes locais é sintético. Isso não prova concorrência PostgreSQL multi-processo
fora do ambiente executado, staging, provider/DeepSeek, observabilidade
operacional, carga/chaos/recovery ou aceite humano.

O veredito global permanece `FAIL_WITH_LIMITATIONS` /
`AAA_NOT_PROVEN`.
