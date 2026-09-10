# ADR-016 — Escritas normalizadas autoritativas para comandos clínicos

## Status

Aceito para implementação local; PostgreSQL concorrente, staging e promoção operacional continuam pendentes.

## Contexto

O snapshot canônico continua necessário para reconstrução, journal, recovery e idempotência, mas não deve ser a fonte operacional primária de cada bounded context. Antes desta decisão, `patients.create`, `appointments.create` e `encounters.create` podiam alterar o snapshot e depender apenas da projeção genérica para materializar a linha normalizada.

O risco é especialmente relevante em comandos mutáveis: uma segunda projeção pode sobrescrever uma linha já alterada ou aceitar silenciosamente uma divergência entre o resultado do domínio e o registro SQL. A fronteira também precisa manter a resposta HTTP, receipt, auditoria, journal e outbox no mesmo commit durável.

## Decisão

Cada comando que assumir a posse de uma linha normalizada expõe um `Repository` assíncrono e retorna a entidade produzida pelo domínio. Quando o runtime usa PostgreSQL, a rota passa essa entidade como `normalized*Write` para o commit durável. A persistência então:

1. valida que a entidade é byte-equivalente ao snapshot canônico e que todas as dependências pertencem à mesma organização e ao mesmo contexto;
2. estabelece `cvg.unit_id` e `cvg.workspace_id` antes do DML contextual;
3. executa uma única escrita SQL com `ON CONFLICT` condicionado à igualdade de todos os campos, usando `RETURNING` para distinguir replay compatível de divergência;
4. exclui o ID command-owned da projeção genérica, evitando uma segunda escrita operacional;
5. faz rollback e falha fechado em corrupção, conflito ou indisponibilidade, restaurando o baseline em memória quando necessário.

Nesta rodada, `POST /api/v1/encounters` foi incluído na mesma boundary de `patients.create` e `appointments.create`. O appointment opcional de um encounter é validado por organização, unidade, workspace e paciente; sem appointment, o valor nulo é preservado e comparado com `IS NOT DISTINCT FROM`.

Também foi normalizada a transição crítica `clinical.sign`: o contrato exige
`expectedVersion`, o domínio aplica `N -> N+1` e a persistência usa `UPDATE`
contextual com pré-condições de estado draft/review, assinatura nula e todos
os campos imutáveis do documento. O replay idempotente exclui o documento já
assinado da projeção genérica para que atividade de sessão não repita DML
clínico. Após a revisão fresh, a mesma operação passou a reservar o
`idempotency_lookup` em PostgreSQL como `IN_FLIGHT` antes de executar o domínio;
concorrentes são bloqueados/reproduzem o receipt durável, e falhas de execução
são assentadas como `FAILED`/`OUTCOME_UNKNOWN` sem inferir sucesso. O domínio
também verifica a consistência de organização e paciente entre documento e
encounter, e cada replay gera uma auditoria de observação sem substituir o
vínculo do receipt original.

## Alternativas consideradas

- **Projeção genérica do snapshot:** rejeitada como fonte operacional primária; mantém o risco de sobrescrita silenciosa e não expressa a autoridade do comando.
- **Escrita direta na rota:** rejeitada; mistura HTTP, transação e SQL e torna difícil garantir a unidade de trabalho completa.
- **Abstração genérica para todas as entidades imediatamente:** adiada; aumentaria o blast radius e esconderia invariantes diferentes de cada bounded context.
- **Port estreito por comando, com adapter PostgreSQL:** selecionado; mantém ownership explícito e permite migrar fatias sem fingir que os demais comandos já foram normalizados.

## Invariantes e falhas

- uma resposta `201` só pode ocorrer depois do commit durável quando PostgreSQL está ativo;
- replay com a mesma chave devolve o mesmo receipt e não repete o DML normalizado;
- ID, organização, unidade, workspace, paciente, appointment, conteúdo, estado e timestamps divergentes falham como corrupção;
- nenhum fallback para snapshot, Mock ou retry SQL cego é permitido após falha de autoridade;
- RLS é um backstop independente, não substituto da validação de dependências no application/persistence boundary.

## Consequências e migração

Não há migration nesta fatia: a tabela `encounters` existente já contém todos os campos necessários. O custo é manter temporariamente duas estratégias de escrita: os comandos normalizados usam o port explícito, enquanto outras mutações ainda usam projeção genérica e permanecem abertas no scorecard. A migração deve continuar por bounded context, com testes de contrato, conflito, replay e rollback antes de ampliar a abstração.

## Verificação e limites

Os testes locais cobrem claim durável sintético, conflito de digest, settlement
de falha, DML autoritativo, dependências de contexto, divergência do snapshot,
boundary HTTP PostgreSQL injetada, CAS de versão, replay sem segunda escrita e
falha de `UPDATE ... RETURNING` sem linha. Eles não provam concorrência
PostgreSQL/RLS em serviço real, staging, carga, recovery operacional ou
aceitação humana. Portanto esta decisão melhora a segurança local sem alterar
o veredito global `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
