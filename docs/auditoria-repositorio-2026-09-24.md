# Auditoria do repositório CVG-Corp — 24/09/2026

**Objeto:** árvore de trabalho local em `c990914148a8f375082cd12bbdb2ad20cfe1900f`, com alterações tracked e untracked (`git status --short` = 339 entradas, 225 untracked).  
**Método:** leitura integral dos 265 arquivos de `docs` (3,3 MB; 252 `.md`), conduzida por seis leituras temáticas paralelas, seguida de inspeção direta de código, testes, banco, CI e infraestrutura e da execução dos comandos registrados abaixo.  
**Independência:** revisão da mesma sessão, sem segunda qualificação independente; nenhum arquivo do repositório foi alterado durante a fase de auditoria.  
**Nota técnica ponderada:** **71/100** (71,27 antes do arredondamento).  
**Prontidão para produção:** **35/100**, julgamento separado da nota técnica.  
**Veredito:** `PROMOTION_BLOCKED / AAA_NOT_PROVEN` — concorda com a autodeclaração corrente do projeto.

Este relatório registra a fotografia observada nesta data e é derivado da mesma sessão que produziu o [pacote de 23/09](./auditoria-repositorio-2026-09-23.md); as notas não são automaticamente comparáveis entre rodadas. As ações propostas estão no [roadmap](./roadmap-2026-09-24.md) e no [backlog](./backlog-2026-09-24.md) deste pacote, com IDs `MEL24` ainda `PROPOSTO`, sem importação para `.agent`.

## Critérios e pontuação

Usei os mesmos pesos da [auditoria de 23/09](./auditoria-repositorio-2026-09-23.md) para permitir comparação por dimensão. Cada nota considera implementação, prova atual e risco residual; um teste local não satisfaz automaticamente um gate de produção.

| Dimensão | Peso | Nota | Fundamentação resumida |
|---|---:|---:|---|
| Documentação e rastreabilidade | 6 | 68 | Acervo amplo, vocabulário controlado e limites explícitos; índice corrente com claims vencidos e contradições internas. |
| Arquitetura e fronteiras | 7 | 74 | Monorepo com boundaries claros; `verify:architecture` vermelho (`app.ts` 2.515 linhas > orçamento 2.500). |
| Domínio e invariantes | 7 | 84 | Invariantes relevantes cobertos; migração de comandos e snapshot verificada. |
| API e contratos | 6 | 84 | 105 rotas; 80 schemas; fixtures 103/105 em memória + 2/2 PostgreSQL; contract tests passam. |
| Segurança e privacidade | 10 | 78 | PDP universal e RLS `FORCE` com boa evidência local; scan de segredo falha e ambiente externo não qualificado. |
| Persistência e migrações | 12 | 62 | 49 migrations e harness verdes; 24/32 coleções `SNAPSHOT_PRIMARY`; 5 coleções de IA sem escrita normalizada; cobertura da área 78,57%. |
| Backup, restore e recuperação | 11 | 68 | AES-256-GCM e quarentena locais; RTO/RPO e restore equivalente ao ambiente final ausentes. |
| IA e governança | 6 | 76 | Kernel, plugins, evals e limites locais; turno de modelo real `NOT_RUN` e teto de custo ausente. |
| Workers e integrações | 6 | 75 | Fencing, migração snapshot→comando e sandbox passam; provedores reais pendentes. |
| Frontend e acessibilidade | 6 | 75 | Build e um projeto E2E verdes; WebKit e tecnologia assistiva não avaliados. |
| Testes e verificabilidade | 8 | 60 | 735 testes, mas 13 falhas na árvore atual; cobertura abaixo do próprio ratchet. |
| CI/CD e cadeia de suprimentos | 5 | 74 | Workflow extenso e pinado; proveniência não assinada; sem `LICENSE` de raiz; gate de produção não reproduzível localmente. |
| Observabilidade | 5 | 70 | OTLP conectado e alertas declarados; coleta e entrega externas `NOT_RUN`. |
| Desempenho e resiliência | 3 | 55 | Baseline sintético; carga, caos e DR sem medição em ambiente equivalente. |
| Manutenibilidade | 2 | 58 | Extrações parciais; `persistence/index.ts` com 4.792 linhas e orçamento de `app.ts` estourado. |
| **Total ponderado** | **100** | **71** | **71,27 arredondado.** |

## Evidência executada nesta auditoria

| Procedimento | Resultado observado |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS; lint em 300 arquivos-fonte; build web em 278 ms. |
| `npm run verify:static` | PASS; 250 artefatos obrigatórios e 297 arquivos-fonte. |
| `npm run verify:control-plane` | PASS; 334 itens, ativo `AUD27-001:SEMANTIC-RECONCILIATION`. |
| `npm run verify:schema-manifest`, `verify:docs-integrity` | PASS; manifesto `latest=049`, 12 marcadores; 256 arquivos e 0 achados. |
| `npm run verify:aud27-semantics` | PASS; 39 achados, 36 tarefas AUD26 e known-bad rejeitado 5/5. |
| `npm run verify:audit-chain` | PASS; adulteração rejeitada. |
| `npm run verify:pdp`, `verify:pdp-universal` | PASS; 26/26 testes de catálogo runtime em cada. |
| `npm run verify:provider-sandbox`, `verify:agent-runtime`, `verify:embedded-harness`, `verify:agent-security` | PASS; runtime com 13 estados e 66 testes; harness 17 artefatos, licença MIT, 0 arquivos incorporados; 10 ataques cobertos. |
| `npm run verify:snapshot-command-migration` | PASS; 32 coleções — 8 `COMMAND_AUTHORITATIVE` e 24 `SNAPSHOT_PRIMARY`. |
| `npm run verify:aud27-migration-harness`, `verify:aud27-evidence-completeness`, `verify:aud26-evidence`, `verify:claims` | PASS; veredito de claims permanece `AAA_NOT_PROVEN`. |
| `npm audit --omit=dev`, `npm run audit:licenses`, `npm run verify:diff` | PASS; 0 vulnerabilidades; 183 pacotes aprovados; diff sem whitespace inválido. |
| `npx playwright test --project=chromium-wide-1440` | PASS; 56 aprovados, 2 skips, 0 falhas em 2,4 min. |
| `npm test` | **FAIL**; 735 testes, 721 pass, **13 fail**, 1 skip. |
| `npm run verify:coverage` | **FAIL**; `persistence` 78,57% < 80% e ratchet global 88,14% < 88,4%. |
| `npm run verify:authoritative-writes` | **FAIL**; `sql` incompleto para `ai_sessions, ai_turns, ai_drafts, ai_approvals, budget_reservations`. |
| `npm run verify:architecture` | **FAIL**; `apps/api/src/app.ts` 2.515 linhas excede o orçamento de 2.500. |
| `npm run verify:secrets` | **FAIL**; achado `generic-api-key` não allowlistado em estado local `.opencode/` (diretório gitignored). |
| `npm run verify:mel23-evidence`, `verify:aud27-evidence-root` | **FAIL**; 50/50 requisitos bloqueados por fingerprint divergente; raiz externa não corresponde ao sujeito. |
| `npm run verify:production --structural` | Interrompido após mais de 10 minutos sem saída; entra na matriz local de gates e não há resultado atribuível. |

Não executei nesta rodada PostgreSQL real, deploy, staging, provedores externos, carga/caos/DR, RTO/RPO, revisão independente ou aceite humano.

## Achados atuais

### AR24-F01 — Suíte local vermelha e claim documental contradito — P0

`npm test` termina com 13 falhas em `tests/integration/persistence.test.ts`, todas em rotas HTTP que passam pelo boundary durável e devolvem `503 QUARANTINED`. A causa-raiz foi reproduzida: o duplo de teste `fakePool` responde `{ revision }` sem `snapshot`/`snapshot_digest` à consulta de leitura corrente do commit, e o código novo em [packages/persistence/src/index.ts](../packages/persistence/src/index.ts) desserializa esse campo, lançando `PersistenceCorruptionError: "undefined" is not valid JSON`. O [índice](./README.md) e o [roadmap de 23/09](./roadmap-2026-09-23.md) afirmam `npm test` com 734 aprovados e 0 falhas. Ou as últimas edições quebraram a suíte após o registro, ou a afirmação não se reproduz; em ambos os casos o gate está vermelho na árvore auditada. Fontes: [teste](../tests/integration/persistence.test.ts), [índice](./README.md).

### AR24-F02 — Gates estruturais vermelhos — P0

`verify:coverage` (persistência 78,57% < 80% e ratchet 88,14% < 88,4%), `verify:architecture` (`app.ts` acima do orçamento) e `verify:authoritative-writes` (cinco coleções de IA sem escrita SQL normalizada) falham. Nenhum dos três aparece como bloqueio corrente no índice. Fontes: [scripts/verify-coverage.ts](../scripts/verify-coverage.ts), [scripts/verify-architecture.ts](../scripts/verify-architecture.ts), [scripts/verify-authoritative-writes.ts](../scripts/verify-authoritative-writes.ts).

### AR24-F03 — Scan de segredo falha localmente — P1

`verify:secrets` rejeita um valor com formato de chave em arquivo de estado local do runtime de agentes (`.opencode/`, gitignored). O achado é local e não alcança a CI, mas o gate não é verde na árvore auditada e a decisão de exclusão/allowlist não está documentada. Fonte: [scripts/verify-secrets.mjs](../scripts/verify-secrets.mjs).

### AR24-F04 — `verify:production --structural` não reproduzível — P1

O gate trava por mais de 10 minutos sem saída, pois executa a matriz local completa (incluindo E2E) antes de validar o Compose. Na fotografia atual ele também falharia por `npm test`. Falta um modo/limite documentado para execução local. Fonte: [scripts/verify-production.ts](../scripts/verify-production.ts).

### AR24-F05 — Candidato não congelado e evidência desvinculada — P0

`git status --short` mostra 339 entradas (225 untracked); o último commit é de 17/09. `verify:mel23-evidence` registra 50/50 requisitos bloqueados por fingerprint e `verify:aud27-evidence-root` rejeita a raiz externa. Toda prova verde expira na edição seguinte enquanto o sujeito permanecer sujo. Fontes: [estado](../.agent/state.json), [scripts/verify-mel23-evidence.ts](../scripts/verify-mel23-evidence.ts), [scripts/verify-aud27-evidence-root.ts](../scripts/verify-aud27-evidence-root.ts).

### AR24-F06 — Persistência parcial e cobertura da área em queda — P0

O inventário de migração declara 24 coleções `SNAPSHOT_PRIMARY` e cinco coleções de IA sem caminho SQL normalizado; a cobertura da área de persistência ficou em 78,57%, abaixo do limite global de 80%. O harness prova protocolo e paridade sintética, não os cutovers de domínio nem o restore do modelo final.

### AR24-F07 — Licença de raiz ausente apesar de `audit:licenses` verde — P1

O gate de licenças passa para 183 pacotes (metadados SPDX do lockfile), mas não existe `LICENSE`/`COPYING` na raiz nem campo de licença no `package.json`; a decisão é humana e está registrada como pendente no [pacote de revisão](./third-party/license-policy-review-2026-09-23.md). Fonte: [package.json](../package.json).

### AR24-F08 — Documentação corrente com claims vencidos e contradições — P1

Contradições confirmadas: fingerprint `585ac671…` atribuído a AUD26 e a AUD27; “105/105 rotas” no índice contra `PARTIAL` no estado da implementação; PostgreSQL 18 como alvo contra 16 executado; cobertura documentada 88,41%/76,62% contra 88,14%/76,06% medidos. Fontes: [índice](./README.md), [12-estado-da-implementacao.md](./12-estado-da-implementacao.md), [production-readiness-vNext.md](./production-readiness-vNext.md).

### AR24-F09 — Gates externos e humanos não comprovados — P0 para promoção

Staging, provedores reais e turno real do modelo, Secret Authority, restore gerenciado, carga/caos, alertas externos, WebKit e tecnologia assistiva, qualificação independente e decisão humana seguem sem evidência atual para o mesmo candidato. É o blocker perene de `AAA_NOT_PROVEN`, já reconhecido pelo [backlog AUD27](./backlog-melhorias-cvg-aud27-2026-09-21.md).

## O que passou e merece registro

A engenharia local é acima da média: typecheck, lint, build, static, control plane, schema manifest, integridade documental, semântica AUD27, cadeia de auditoria, PDP universal, sandbox de provider, runtime de agente, harness embarcado, segurança de agente, migração snapshot→comando e auditoria de dependências passam nesta árvore. A suíte exercita as 105 rotas com 103/105 fixtures de sucesso em memória e 2/2 PostgreSQL; o isolamento usa RLS `FORCE` em 17 migrations (24 statements); o CI é pinado por SHA e inclui Trivy, SBOM e proveniência. A documentação é incomumente honesta ao declarar `NOT_RUN`, `BLOCKED_EXTERNAL` e scores nulos em vez de inflar resultados.

## Decisão e limite

O primeiro passo verificável é tornar a suíte verde corrigindo a divergência entre o duplo de teste e o contrato de commit, e em seguida fechar os gates estruturais (cobertura, arquitetura, escrita autoritativa de IA). Depois, congelar o candidato, refazer o vínculo da evidência e concluir os cutovers. A nota de produção só deve ser revista após provas no ambiente correspondente; estes números são avaliação técnica desta fotografia, não certificação nem aceite clínico.
