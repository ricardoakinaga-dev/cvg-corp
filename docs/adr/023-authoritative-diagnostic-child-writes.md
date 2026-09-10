# ADR-023 — Escritas normalizadas autoritativas de espécime e resultado diagnóstico

## Status

Aceito para implementação local; PostgreSQL concorrente, staging e promoção
operacional continuam pendentes.

## Problema

As rotas de espécime e resultado já validavam a transição clínica no domínio,
mas o modo PostgreSQL ainda dependia da projeção genérica do snapshot. Além de
deixar o ownership da escrita implícito, a leitura reconstruía unidade e
workspace exclusivamente pelo atendimento, sem provar que o filho armazenado
mantinha o mesmo escopo.

## Decisão

Adicionar ports e application services para `diagnostics.specimen` e
`diagnostics.result`. O resultado de cada comando é passado ao mesmo commit
durável do snapshot como `normalizedSpecimenWrite` ou
`normalizedDiagnosticResultWrite`; replay passa somente o ID reproduzido.

O commit:

1. exige equivalência entre a linha command-owned e o snapshot canônico;
2. resolve pedido, paciente, espécime e atendimento dentro da mesma
   organização e valida a cadeia de escopo;
3. estabelece `cvg.unit_id` e `cvg.workspace_id` derivados do atendimento;
4. executa um UPSERT autoritativo condicionado à igualdade de todos os campos
   e exige `RETURNING id`;
5. retira a linha command-owned da projeção genérica;
6. em replay, retira a linha sem emitir um segundo DML do filho;
7. grava rollback e quarentena diante de divergência, dependência ausente ou
   ausência de linha normalizada.

A migration 033 adiciona `unit_id`/`workspace_id` a `specimens` e
`diagnostic_results`, faz backfill apenas pelo atendimento existente, rejeita
escopo parcial ou divergente, adiciona FKs compostas e instala policies RLS de
leitura e DML. Linhas legadas de pedidos sem atendimento continuam explícitas
como `null/null` e não aparecem nas leituras clínicas contextualizadas.

A migration 034 fecha o backstop que não pode depender apenas da aplicação:
adiciona FKs compostas para paciente e para a cadeia
pedido→espécime→resultado, instala guards `BEFORE` que rejeitam o bypass
`NULL/NULL` de pedidos vinculados a atendimento e impede mudanças de pedido que
deixariam filhos com escopo ou paciente divergentes. As leituras dos filhos
também usam a policy DML exata, portanto um contexto organizacional sem unidade
não enumera filhos de atendimentos.

## Invariantes

- A resposta PostgreSQL só é liberada depois do commit durável.
- O escopo persistido do filho é o mesmo escopo do atendimento do pedido.
- Um resultado só pode referenciar o espécime e o pedido da mesma organização.
- Um espécime mantém o paciente e o pedido de origem; um resultado mantém o
  mesmo pedido, espécime e paciente, inclusive em SQL direto.
- Filho de pedido vinculado a atendimento carrega exatamente o par
  `unit_id`/`workspace_id` do atendimento; `null/null` é reservado ao legado
  organizacional sem atendimento.
- Divergência de snapshot ou de `RETURNING` falha fechado, sem sucesso inferido.
- Replay não duplica DML do espécime ou do resultado.

## Alternativas rejeitadas

- Projeção genérica sem ownership: mantém duas possíveis autoridades de escrita.
- Derivar escopo somente no `SELECT`: não protege a integridade armazenada.
- SQL diretamente na rota: mistura transporte, domínio e transação.

## Verificação e limites

Os testes de persistência cobrem criação autoritativa conjunta, replay,
divergência e ausência de `RETURNING`; o gate PostgreSQL exercita as duas
rotas, leitura contextual sem escopo, tentativa de `NULL/NULL` em filho
vinculado, cadeia pedido/espécime inconsistente, colunas armazenadas e updates
fora de workspace ou unidade. O pool local é sintético e não substitui essa
prova.

Isto não prova ainda staging, provider/DeepSeek, segredos, observabilidade
operacional, carga/chaos/recovery ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
