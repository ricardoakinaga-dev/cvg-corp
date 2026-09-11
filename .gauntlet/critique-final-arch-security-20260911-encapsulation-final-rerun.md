# Addendum — rerun final de encapsulamento, arquitetura e PDP

Data: 2026-09-11  
Escopo: endurecimento final de `CvgStore`, seams de application/harness e guarda de mutação.  
Modo: audit-only; nenhum código-fonte, `state.json`, barra ou outro registro de controle foi alterado. Este addendum é a única escrita desta crítica.

## Veredicto

**Local: PASS_WITH_LIMITATIONS.** O reparo solicitado para H-03 está **REPAIRED/CLOSED** no caminho público de coleções: todos os backing stores são `private`, as propriedades públicas são views `ReadonlyMap` congeladas, todas as operações de leitura devolvem clones, e `set`/`delete`/`clear` falham. `quarantined` agora é um getter sobre backing privado que devolve array clonado e congelado. Os seams (`setCommandReceipt`, `persistAi*`, `persistBudgetReservation` e updates) clonam entrada e saída. A inspeção atual não encontrou mutação direta de mapas governados em application, harness ou worker.

**Global: AAA_NOT_PROVEN.** O resultado global continua sem prova de provider/DeepSeek/Secret Authority reais, PostgreSQL e carga/chaos/recovery production-like, staging de container/observabilidade/headers, provenance same-SHA, revisão independente válida e aprovação humana criptograficamente atestada. Este reparo local não substitui esses hard blockers.

## Findings residuais

### CRITICAL

**C-01 — gates externos de promoção continuam ausentes.** A barra global não pode ser promovida por inspeção local. Até que as evidências externas atuais sejam vinculadas ao mesmo artefato, `AAA_NOT_PROVEN` permanece o veredicto correto.

### HIGH

**H-01 — métodos de domínio fora dos seams ainda podem retornar aliases internos.** Os seams endurecidos clonam entrada/saída, mas métodos públicos de `CvgStore` como criação/autenticação ainda retornam objetos que são colocados diretamente nos backing stores (por exemplo, sessão, usuário e desafios). Um consumidor interno que retenha esse retorno pode alterar estado canônico sem passar por um comando/update. O fechamento completo requer cópia defensiva nos retornos públicos restantes ou tipos de domínio imutáveis.

**H-02 — flags e credenciais de bootstrap permanecem propriedades públicas mutáveis.** `bootstrapCredentials` é `readonly` apenas na referência; seus campos podem ser alterados. `storageMode` e `healthStatus` são propriedades públicas graváveis. Um consumidor interno pode trocar a identidade de bootstrap ou reabrir um store em quarentena sem um seam autorizado. Esses valores devem ter getters clonados/imutáveis e transições privadas ou explicitamente governadas.

**H-03 — a guarda textual ainda é parcial.** `verify-pdp-universal.ts` detecta os seis nomes de mapas que motivaram o reparo e exclui legitimamente `packages/domain`, mas não resolve aliases, casts `any`, acesso dinâmico, mutação de objetos retornados ou novos seams. O encapsulamento privado e o typecheck reduzem o bypass normal; a guarda não prova dominância universal de PDP por si só.

## Evidência e limites

- Inspecionados `packages/domain/src/index.ts`, `apps/api`, `packages/harness/src/index.ts`, `apps/worker`, `docker/worker.ts` e `scripts/verify-pdp-universal.ts`.
- Confirmados: cópia na entrada/saída dos seams; updates retornando cópias; `ReadonlyMap` com cópia em `get`, `values`, `entries` e `forEach`; `quarantined` como visão congelada de cópias.
- A inspeção estrutural encontrou os consumers usando seams explícitos e nenhum `.set/.delete/.clear` direto em mapas governados fora do domínio.
- Nenhum teste, gate runtime, staging, provider externo, revisão humana ou mutation sentinel criptográfico foi executado neste rerun. Essas verificações permanecem `NOT_RUN`/externas.

Independência: I1, contexto fresco e leitura contra o artefato atual.  
Próximo passo seguro: fechar os aliases de retornos públicos e as flags de controle, ampliar a guarda com typecheck/testes de mutação, e só então repetir os gates externos exigidos para AAA.
