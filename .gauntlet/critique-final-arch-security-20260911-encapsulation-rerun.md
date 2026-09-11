# Addendum — rerun de encapsulamento, arquitetura e PDP

Data: 2026-09-11  
Escopo: reparo local de `CvgStore`, seams application/harness e guarda de mutação.  
Modo: audit-only; nenhum código-fonte ou artefato de prova foi alterado por esta crítica. A criação deste addendum foi a única escrita autorizada.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O finding H-03 anterior sobre mapas públicos mutáveis está **REPAIRED** para o caminho normal de TypeScript: os backing stores agora são `private`, cada coleção pública é uma `ReadonlyMap` congelada, `get`/`values`/`entries`/`forEach` devolvem clones e `set`/`delete`/`clear` falham. A aplicação, o harness e o worker não mantêm mutações diretas dos mapas governados; usam seams explícitos (`setCommandReceipt`, `persistAi*`, `persistBudgetReservation` e métodos de atualização). A guarda estrutural em `scripts/verify-pdp-universal.ts` mantém a rejeição `DIRECT_STORE_MUTATION` para os caminhos de mutação anteriormente observados.

**Global: AAA_NOT_PROVEN.** A barra global continua sem as provas externas obrigatórias: provider/DeepSeek/Secret Authority reais, PostgreSQL e carga/chaos/recovery production-like, staging de container/observabilidade/headers, provenance same-SHA, revisão independente válida e aprovação humana criptograficamente atestada. O reparo local não permite elevar o resultado global.

## Findings residuais

### CRITICAL

**C-01 — gates externos de promoção continuam ausentes.** Este rerun não executou nem poderia substituir as provas externas da barra v4. O resultado global permanece `AAA_NOT_PROVEN`/`FAIL_WITH_LIMITATIONS` até que esses gates tenham evidência atual vinculada ao mesmo artefato.

### HIGH

**H-01 — o seam de escrita ainda guarda a referência recebida.** `persistAiSession`, `persistAiTurn`, `persistAiDraft`, `persistAiApproval` e `persistBudgetReservation` fazem `Map.set` do objeto recebido sem clone; vários comandos também retornam o objeto que acabou de ser armazenado. Um consumidor interno que retenha o retorno ou o argumento pode alterar o registro por alias, fora das invariantes do domínio. O próximo endurecimento deve clonar na entrada e na saída dos seams/comandos, ou retornar tipos imutáveis.

**H-02 — `quarantined` continua sendo um array público mutável.** `public readonly quarantined: Array<...>` impede apenas reatribuição da propriedade; qualquer consumidor com o `CvgStore` pode chamar `push`, `splice` ou alterar um item. Isso pode falsificar ou apagar o estado de quarentena usado por health/observabilidade. Expor uma visão somente leitura clonada e manter a escrita apenas em um seam do domínio fecha essa exceção.

**H-03 — a guarda estrutural é defesa parcial, não prova de call graph.** A expressão em `verify-pdp-universal.ts` cobre os seis nomes de mapas que motivaram o reparo e ignora o módulo de domínio, onde as escritas legítimas vivem. Ela não detecta aliases, casts `any`, acesso dinâmico, mutação de registros já obtidos ou novas formas de seam. O encapsulamento privado/`ReadonlyMap` reduz o risco de compilação, mas a guarda deve continuar acompanhada de typecheck e testes de mutação conhecidos-bons/conhecidos-ruins; não prova dominância universal de PDP.

## Evidência e limites

- Inspecionados `packages/domain/src/index.ts`, `apps/api`, `packages/harness/src/index.ts`, `apps/worker`, `docker/worker.ts` e `scripts/verify-pdp-universal.ts`.
- A inspeção encontrou `private readonly <collection>Store = new Map(...)` e views `ReadonlyMap` com clones; os caminhos de application/harness usam os seams explícitos.
- Foi feita busca estrutural de chamadas `.set/.delete/.clear` nos mapas governados em application/worker/harness; não foi encontrado bypass direto no estado atual.
- Nenhum teste, gate runtime, staging, provider externo, revisão humana ou mutation sentinel criptográfico foi executado neste rerun. Portanto este relatório não declara esses checks como passados.

Independência da crítica: I1, contexto fresco e leitura contra o artefato atual.  
Mutation sentinel: não executado; a ausência de escrita de código é observada por inspeção, não apresentada como prova criptográfica.

Recomendação: preservar o reparo H-03, fechar os aliases e o array `quarantined`, ampliar a guarda/typecheck para todas as fronteiras de escrita e então repetir os gates locais antes de buscar as provas externas exigidas para AAA.
