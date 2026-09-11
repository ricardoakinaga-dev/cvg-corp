# ADR 024 — Admissão de rotas pelo catálogo no runtime

Estado: implementação autorizada; prova global de PDP permanece parcial.

## Problema e decisão

O inventário AST não observa todos os aliases, wrappers ou plugins executados.
Uma rota desconhecida pode entrar no router real mesmo que o código pareça
compatível com o catálogo. O runtime Fastify passa a admitir somente o inventário
de `API_ROUTE_CATALOG`, os HEAD derivados de GET e duas rotas de infraestrutura
enumeradas: `OPTIONS *` de CORS e `GET /internal/metrics` (com seu HEAD).

O hook `onRoute` é instalado antes dos plugins. A URL resolvida com prefixo,
método e handler são registrados. Qualquer rejeição permanece registrada mesmo
que um plugin capture a exceção. `onReady` valida completude, a declaração final
e a presença no router; `createRuntime` só retorna após readiness e fecha os
recursos em erro. HEAD exige o mesmo handler de GET; variantes com constraints
e aliases implícitos de prefix-root são rejeitadas por não terem contrato no
catálogo. CORS é uma exceção exata, nunca um bypass geral para OPTIONS.

## Alternativas e limites

Manter somente AST não resolve a evidência runtime. Reescrever cada rota em um
novo DSL aumentaria a migração sem eliminar a necessidade de conferir o router.
O guard usa os hooks públicos do framework e preserva handlers e PDP existentes.
Seu custo é linear no inventário durante bootstrap; não adiciona consultas ou
IO externo por solicitação. Não há mudança de schema, contrato de dados ou
efeito externo. Rollback consiste em reverter o guard antes de promoção.

Catalogar uma rota não prova autorização do seu handler. Authentication PUBLIC,
política de rede de métricas, acesso direto à persistência e workers continuam
com critérios próprios. O guard não isola plugins maliciosos com poder de
alterar o processo; ele detecta drift de registro e padrões inesperados usando
hooks, referências finais e `hasRoute`.

## Barra de aceite

- RT-R1 (USER/HIGH): runtime real rejeita rota não catalogada, método extra,
  prefixo divergente, handler HEAD independente e variante constrained.
- RT-R2 (DERIVED/HIGH): ausência de rota, declaração alterada depois do hook e
  erro de registro capturado impedem readiness; handler sensível não executa.
- RT-R3 (USER/HIGH): o inventário atual completo é verificado em Fastify,
  com HEAD/CORS explícitos; login, leitura e demais testes API não regridem.
- RT-R4 (DERIVED/HIGH): foco, regressão, typecheck/build e crítica fresh com
  fixtures reais e sentinels, sem promover esse aceite a PDP universal/AAA.
