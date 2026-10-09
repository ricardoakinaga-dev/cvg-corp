# ADR 039 — Isolamento transacional das rotas remotas de IA

**Status:** ACEITO (local, 2026-09-20)<br>
**Itens:** CVG-AUD19-013, CVG-AUD19-014 (origem AUD-2026-005)<br>
**Autoridade:** decisão de arquitetura local; promoção/externos permanecem bloqueados

## Contexto

As rotas que atravessam a fronteira remota de IA (`POST /api/v1/ai/turns` e
`POST /api/v1/ai/approvals/:id/retry`) não podem manter a trava global do
coordenador durante a chamada externa ao provider. Antes desta decisão, o
handler mutava o `CvgStore` singleton diretamente e o snapshot só era obtido ao
readquirir a trava de commit. Requisições concorrentes podiam observar/gravar
mutações não confirmadas de outra requisição, e uma requisição que recebia
conflito podia deixar mutações aplicadas no store global.

## Decisão

1. **Unidade de trabalho isolada por requisição.** Toda rota da fronteira
   remota executa contra um `CvgStore.fork(baseline)` hidratado a partir do
   snapshot durável (baseline lido em `preHandler`), nunca contra o store
   canônico. Os serviços recebem um proxy com `AsyncLocalStorage` que resolve
   para o fork dentro do escopo da requisição e para o store canônico fora dele.
2. **Fronteira antes/depois do provider.** A chamada externa roda sem trava. O
   fork é adotado (`canonicalStore.hydrate(snapshot)`) **somente após** o commit
   durável com CAS (`expectedRevision` = baseline) ter sucesso.
3. **CAS/revisão.** O commit usa a revisão do baseline. Se outro writer avançou
   a revisão, o CAS falha, o store canônico é recarregado do durável e a
   requisição responde 409 (`CONFLICT`); nenhuma mutação do perdedor permanece.
4. **Idempotência.** O claim durável de command receipt continua sendo feito
   antes do dispatch (`markCommandReceiptDispatched`), e um commit falho
   converte o receipt em `OUTCOME_UNKNOWN` em vez de sucesso.
5. **`OUTCOME_UNKNOWN`.** Falha de commit pós-dispatch nunca é reportada como
   sucesso; a reconciliação usa o receipt durável.
6. **Observabilidade de conflito.** Conflitos de commit são registrados em
   `persistence.commit.failed` com correlação e o código 409 é estável.

## Compatibilidade

- Rotas locais (que mantêm a trava durante toda a requisição) não mudam:
  `durableRequests` sem fork adota o caminho anterior.
- Modo memória (sem `persistence`) não cria fork: não há estado durável
  concorrente entre processos; o coordenador local continua serializando.
- `projectDomain` passou a inserir `ai_sessions` antes de `budget_reservations`
  para respeitar a FK no primeiro commit de um turno.

## Rollback / roll-forward

- Rollback: remover o wrapper `runWithRequestFork` e a adoção pós-commit,
  voltando ao comportamento anterior (hidratação direta). O modo memória não é
  afetado.
- Roll-forward: estender o mesmo padrão a outras rotas que vierem a cruzar
  fronteira externa, reutilizando `CvgStore.fork` e `runWithRequestFork`.

## Evidência

- `npm run verify:postgres:isolation` (POSTGRES_ISOLATION_VERIFIED): controle
  commitado; turno bloqueado invisível no store canônico e no durável; writer
  concorrente avança a revisão; commit bloqueado responde 409; mutação do
  perdedor descartada.
- `npm test` 540 (539 pass, 1 skip, 0 fail).
- `verify:postgres`, `verify:postgres:concurrency`, `verify:postgres:restore`,
  `verify:postgres:schema-gates` verdes no mesmo PostgreSQL descartável.

## Limitações

- A prova é local/descartável; multi-instância real, staging e carga/chaos
  permanecem externos (`CVG-AUD19-027/028`).
