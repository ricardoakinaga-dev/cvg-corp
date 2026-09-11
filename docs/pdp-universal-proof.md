# Prova de PDP universal

Status: `VERIFIED_LOCAL`

Escopo: prova local executável do boundary HTTP/application/worker no artifact atual. Este status não é uma aprovação de staging, provider, DeepSeek, carga, chaos, recovery, CI do mesmo SHA ou Triplo AAA. Base da retomada: `e43b3b0032aafb9d17563b1fce00fbae88ee0d51`; mudanças locais posteriores exigem nova evidência de SHA/CI.

## Boundary HTTP

`npm run verify:pdp` agora coleta recursivamente os arquivos TypeScript de `apps/api/src` e confronta registros HTTP com `API_ROUTE_CATALOG`. `scripts/pdp-route-inventory.ts` trata shorthand, objeto route, arrays de métodos, aliases simples, plugins inline e acesso por colchetes. Registro desconhecido, duplicado, ausente, handler não resolvido e operação divergente falham. Prefixos e registros dinâmicos não suportados falham explicitamente. `GET /internal/metrics` no arquivo exato da API é a única exceção de inventário fora do catálogo; seu acesso é admitido pela política de rede do catálogo de runtime e pelo guard de escopo interno.

`apps/api/src/route-catalog.ts` instala a mesma admissão no Fastify real, mantém referências das opções registradas, valida `GET`/`HEAD`/`OPTIONS` e sela um inventário congelado depois de `app.ready()`. Registros tardios, aliases, constraints, handlers ou métodos mutados, plugins e violações capturadas envenenam o runtime e impedem readiness. O inventário local corrente contém 114 registros, incluindo os derivados de `HEAD` e o preflight CORS.

A operação precisa aparecer no handler correspondente: comentários, outro handler e lambda não executada não satisfazem o vínculo. Entradas PUBLIC são inventariadas, mas sua autenticação específica (login/MFA/HMAC) ainda precisa de prova própria. O analisador não é um resolvedor integral de tipos/call graph: wrappers, reexports, mutação dinâmica e aliases complexos exigem corroboração do inventário real em Fastify. Presença local de requestContext não demonstra dominância do controle sobre todos os efeitos.

## Boundary application

`scripts/pdp-boundary.ts` exige uma chamada inicial de PDP executável ou delegate síncrono verificado nos services convencionados. Public callable properties, accessors e métodos estáticos também entram na inspeção. Anotações textuais não liberam métodos; readiness tem identidade e corpo exatos. O verificador rejeita checks tardios, condicionais, engolidos por catch ou presos em callback não executado, além de delegação falsa.

As únicas validações prévias aceitas são as chamadas exatas de validateContext nos services Agent e Export inspecionados; sua implementação continua parte da confiança do gate. Isso é guard conservador de padrões aceitos, não prova geral da semântica JavaScript.

O boundary local também exige seams explícitas para as escritas do adapter de memória: API e harness não podem chamar `set/delete/clear` diretamente nos mapas de receipts, projeções de IA ou reservas de budget. `verify:pdp-universal` percorre `apps/` e `packages/` e falha com `DIRECT_STORE_MUTATION` quando encontra esse padrão fora do módulo de domínio. O `CvgStore` mantém cada coleção em um backing `private`, expõe apenas uma visão `ReadonlyMap` que clona valores e rejeita `set/delete/clear`, e concentra mutações em seams de domínio; isso fecha a mutação direta do adapter local. A evidência continua limitada ao adapter em memória e não substitui a prova PostgreSQL.

## Limites que permanecem fora desta prova local

- A prova não substitui a execução do mesmo artifact em staging com credenciais reais e rede controlada.
- A prova de policy dos jobs é fail-closed: somente tipos presentes em `WORKER_POLICY_REGISTRY` podem chegar ao handler; novos tipos precisam de registro e teste antes do deploy.
- Cobrir identity, auth e admin integralmente com rastreabilidade route → service → PDP → repository e testes negativos de recursos/escopo.
- `verify:pdp-universal` compõe a cobertura estática, a admissão Fastify e a registry de jobs. O nome do comando não substitui a evidência operacional das fases seguintes.

## Verificação e crítica

Testes focados em `tests/unit/pdp-coverage.test.ts` e `tests/unit/pdp-route-inventory.test.ts`; regressão global em `npm test`. A crítica fresh identificou lacunas em registros encadeados, bind por colchetes, prefixos/plugins, constructor parameter properties e defaults destructurados. Cada achado gera fixture negativa antes de reparo e revalidação; resultados finais deste recorte serão registrados em `docs/verification-2026-09-10-pdp-operational-repair.md`.


A revisão `VER-CVG-174` também enumera `outbox/outbox.dispatch` e verifica no código que a policy é aplicada antes de qualquer claim do relay.

## Revalidação VER-CVG-216 — 2026-09-11

No checkpoint histórico VER-CVG-216, as seams clonaram entrada e saída, os updates retornavam cópias e `quarantined` era uma visão congelada sobre backing privado; `npm run verify:pdp-universal` passou 68 operações/70 regras/6 tools/26 testes. A guarda e o typecheck continuam sendo uma prova local parcial: o critic final fechou a mutação dos mapas e os aliases das seams, mas registrou aliases de retornos de outros métodos públicos do domínio e flags/credenciais de controle mutáveis. Isso permanece residual HIGH e não altera `AAA_NOT_PROVEN`.

## Estado de controle VER-CVG-217 — 2026-09-11

`bootstrapCredentials` agora é uma cópia por getter, e `storageMode`/`healthStatus` ficam em estado privado com `setStorageMode` explícito. O critic H2 confirmou o fechamento dessa mutabilidade. A guarda continua estrutural/parcial e há aliases possíveis em outros retornos públicos do domínio; typecheck e os testes de mutação conhecidos permanecem necessários para esta prova local.


## Revalidação VER-CVG-218 — 2026-09-11

O guard universal agora enumera as 41 coleções do CvgStore e exige, para cada uma, backing private em Map, visão pública ReadonlyMap construída por readOnlyMap e ausência de declaração pública mutável. Fora do módulo de domínio, a varredura rejeita set/delete/clear em qualquer coleção governada. O CvgStore também clona os retornos de usuários, sessões, desafios, assignments, pacientes e entidades/listas; somente getUserRecord e findPatientRecord retornam referências internas a helpers privados. markUserLogin e recordChallengeFailure mantêm mutação governada e devolvem cópias.

No checkpoint histórico VER-CVG-218, `npm run verify:pdp-universal` passou 68 operações/70 regras/6 tools/26 testes. O critic H-01 confirmou CLOSED/REPAIRED para aliases públicos e bypass direto de mapas. A prova continua local e o guard é textual/parcial: não substitui análise completa de call graph, staging, provider, DeepSeek ou aceitação humana. Esse residual HIGH mantém AAA_NOT_PROVEN.


## VER-CVG-219 — addendum fresh da guarda universal do PDP — 2026-09-11

A auditoria read-only [.gauntlet/critique-final-arch-security-20260911-h02-guard-final-rerun.md](../.gauntlet/critique-final-arch-security-20260911-h02-guard-final-rerun.md) confirmou o fechamento de H-02 para o artefato atual: a guarda enumera as 41 coleções governadas do CvgStore, exige backing privado e view ReadonlyMap defensiva para cada uma e não encontrou mutador direto fora do domínio em API, harness ou worker. O resultado local é PASS_WITH_LIMITATIONS.

No checkpoint histórico VER-CVG-219, o residual H-02-L permanecia HIGH porque a guarda era textual/parcial e não provava call graph ou data flow; aliases dinâmicos, casts any e campos futuros continuavam fora do alcance dessa técnica. O addendum não reexecutou runtime nem adicionou provider/DeepSeek/Secret Authority, staging, PostgreSQL multi-instância, observabilidade, carga/chaos/recovery, provenance, promoção ou aprovação humana. O gate Triplo AAA permanecia VER-CVG-218, exit 2, AAA_NOT_PROVEN, com promoção bloqueada.
## VER-CVG-220 — prova AST, snapshot e reentrada de quarentena — 2026-09-11

O guard universal agora trata aliases, casts, destructuring, bracket access estático e acesso computado dinâmico em um alias de `CvgStore`; qualquer coleção dinâmica não resolvida falha fechado. O registro verifica as 41 coleções governadas contra backing privado, views `ReadonlyMap` defensivas e `StoreSnapshot`. A crítica operacional fresh classificou o residual H-02-L como `MEDIUM/advisory`: a guarda não substitui análise completa de call graph/data flow e não há bypass direto observado.

Resultados diagnósticos incompatíveis são registrados apenas em `quarantined`; não entram em `diagnosticResults`. `hydrate` e `restore` validam a cadeia request → specimen → patient antes de substituir a autoridade e rejeitam snapshots adulterados com resultado `QUARANTINED` órfão. A regressão final passou 284 testes (283 pass, 1 skip), static 120/164, lint 162 e o snapshot de evidências vinculou bytes, mtime, prompt SHA e HEAD. O veredito global continua `AAA_NOT_PROVEN` porque as provas externas, o bundle same-SHA e a aprovação humana não existem.

Crítica fresh: [operational-evidence-rerun](../.gauntlet/critique-final-arch-security-20260911-operational-evidence-rerun.md).

## VER-CVG-221 — revalidação da fronteira de snapshots — 2026-09-11

O parser de `StoreSnapshot` agora usa allowlist de campos de topo e rejeita estados diagnósticos não hidratáveis. A validação de domínio e a validação autoritativa de persistência repetem a regra para impedir que uma linha `QUARANTINED` ou um campo desconhecido atravesse `hydrate`, `restore` ou a projeção normalizada. O controle local foi coberto na suíte de domínio; a evidência não altera o residual H-02-L nem o estado global `AAA_NOT_PROVEN`.

## VER-CVG-222 — auditoria fresh da fronteira H-04 — 2026-09-11

O critic independente confirmou que o parser e as validações rejeitam campos desconhecidos, `QUARANTINED`, status inválidos e cadeias request/specimen/patient órfãs. O residual M-03 é a cobertura semântica limitada de `hydrate`/`restore` para entidades não diagnósticas; isso não reabre H-04, mas impede alegação de validação in-memory exaustiva. O resultado global permanece `AAA_NOT_PROVEN`.

## VER-CVG-224 — registry e validação semântica compartilhados — 2026-09-11

O registry de coleções autoritativas foi movido para `@cvg/contracts`, e o validator puro em `packages/domain/src/snapshot-validation.ts` agora é chamado tanto por `CvgStore.hydrate/restore` quanto pela persistência antes do DML. Isso fecha a divergência H-04/M-03 entre o boundary in-memory e o projetor PostgreSQL. O gate global continua `AAA_NOT_PROVEN` enquanto as provas externas e humanas permanecerem ausentes.

O módulo compartilhado `packages/domain/src/snapshot-validation.ts` também faz parte do inventário obrigatório do static gate, evitando que a validação comum seja alterada sem revalidar o proof set.

## VER-CVG-225 — revalidação pós-integridade do aggregate — 2026-09-11

No checkpoint histórico VER-CVG-225, o boundary universal permanecia verde: `68` operações, `70` regras, `6` políticas de ferramenta e `26` testes de admissão de rotas. O validator semântico compartilhado e os novos testes de FKs não introduziram mutação direta fora dos seams; typecheck, lint, static e a suíte de `293` testes passaram. O critic fresh confirmou a ausência de ciclo domínio → persistência e o fechamento local de M03/H05/M04. Essa prova continua local e não substitui execução em staging nem aprovação de promoção.


## VER-CVG-226 — revalidação do boundary local — 2026-09-11

No checkpoint histórico VER-CVG-226, a execução final do Triplo AAA e a repetição sequencial de produção preservaram o boundary universal verde: `68` operações, `70` regras, `6` políticas de ferramenta e `26` testes de admissão, além de `293` testes globais (`292 pass`, `1 skip`). O snapshot `6ea94fb7ddb9706b08cc3fc6a6536c6225ec997368ce2683dbb2ce61ada2eb2e` e o static gate foram regenerados. Essa prova permanece local e não substitui staging, execução externa ou aprovação humana; o estado global continua `AAA_NOT_PROVEN`.

## VER-CVG-227 — boundary corrente — 2026-09-11

O boundary universal permanece em 68 operações, 72 regras, 6 políticas de ferramenta e 26 testes de admissão de rotas. A regressão global corrente passou 306 testes (305 pass, 1 skip), e o novo contrato do Final Gauntlet exige as 15 categorias de críticos com veredito e findings tipados antes de aceitar uma receipt. Isso fortalece a admissão local sem provar call graph completo, staging, provider, DeepSeek ou aprovação humana; o estado global continua AAA_NOT_PROVEN.

## VER-CVG-228 — aplicação e break-glass — 2026-09-11

O guard de identidade/contexto rejeita chamadas diretas de store.getUser, resolveContext, contextOptions e listUsers nas rotas, preservando somente os seams pré-contexto explicitamente auditados. O serviço de break-glass executa o PDP antes de qualquer efeito, valida a finalidade e a vinculação do contexto e permanece fechado sem autoridade WebAuthn, escopo e persistência reais. A execução corrente registra 68 operações, 72 regras, 6 políticas de ferramenta, 26 testes de rota e 306 testes globais; isso é prova local, não autorização de promoção.

## VER-CVG-256 — revalidação corrente do boundary — 2026-09-11

A fotografia corrente do boundary universal foi reexecutada no mesmo checkout: `68` operações request-bound, `72` regras de aplicação, `6` policies canônicas de ferramenta, `114` registros Fastify e `26/26` testes de runtime. O guard de coleções cobre as `41` coleções autoritativas, aliases e destructuring testados, e falha fechado para acesso dinâmico não resolvido. O residual H-02-L é `MEDIUM/advisory`: esta guarda estrutural não substitui análise completa de call graph/data flow.

Os parágrafos sob VER-CVG-216, VER-CVG-218 e VER-CVG-225/226 preservam contagens históricas daqueles checkpoints; não são a fotografia corrente. O resultado continua `VERIFIED_LOCAL` e `AAA_NOT_PROVEN` globalmente, sem promoção de staging, provider, DeepSeek, PostgreSQL externo ou aprovação humana.

A admissão de critics desta fotografia também falha fechado para findings `CRITICAL` ou `HIGH` não reparados e exige o conjunto exato de IDs de critérios da gate, sem duplicatas ou critérios extras. O relatório fresh de 15 categorias [VER-CVG-256](../.gauntlet/critique-final-gauntlet-20260911-VER256.md) continua `FAIL / AAA_NOT_PROVEN` e review-only; essa revisão reforça a receipt local e não constitui aprovação independente.
