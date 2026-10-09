# Auditoria do repositório CVG-Corp — 23/09/2026

**Objeto:** árvore de trabalho local em `c990914148a8f375082cd12bbdb2ad20cfe1900f`, com alterações tracked e untracked.  
**Método:** inventário dos 253 arquivos de `docs`, leitura direcionada dos requisitos, ADRs, relatórios recentes, código, testes, CI e configuração; execução dos checks indicados abaixo.  
**Independência:** revisão da mesma sessão, sem segunda qualificação independente.  
**Nota técnica ponderada:** **68/100** (67,85 antes do arredondamento).  
**Prontidão para produção:** **35/100**, julgamento separado da nota técnica.  
**Veredito:** `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

Este relatório registra a fotografia observada nesta data. As auditorias anteriores continuam históricas; seus resultados não qualificam automaticamente a árvore atual. As 50 ações derivadas estão em [melhorias priorizadas](./melhorias-50-priorizadas-2026-09-23.md), com [plano executivo](./plano-executivo-2026-09-23.md), [roadmap](./roadmap-2026-09-23.md) e [backlog proposto](./backlog-2026-09-23.md).

## Critérios e pontuação

Usei os mesmos pesos da [reauditoria AUD27 de 21/09](./auditoria-resultado-cvg-aud27-2026-09-21.md), para permitir comparação por dimensão. Cada nota considera implementação, prova atual e risco residual; um teste local não satisfaz automaticamente um gate de produção.

| Dimensão | Peso | Nota | Fundamentação resumida |
|---|---:|---:|---|
| Documentação e rastreabilidade | 6 | 56 | Acervo extenso, porém o índice corrente contém afirmações vencidas. |
| Arquitetura e fronteiras | 7 | 69 | Verificador de arquitetura passou; módulos centrais continuam grandes. |
| Domínio e invariantes | 7 | 82 | Jornadas e invariantes relevantes cobertas por testes locais. |
| API e contratos | 6 | 84 | Catálogo com 105 rotas; registro atual com 80/80 schemas de payload. |
| Segurança e privacidade | 10 | 78 | PDP e isolamento têm boa evidência local; ambiente externo não qualificado. |
| Persistência e migrações | 12 | 58 | Harness de migração passou; 24/32 coleções seguem `SNAPSHOT_PRIMARY`. |
| Backup, restore e recuperação | 11 | 63 | Provas locais existem; RTO/RPO e restore equivalente ao ambiente final faltam. |
| IA e governança | 6 | 78 | Políticas e limites locais; integração real não qualificada. |
| Workers e integrações | 6 | 75 | Fencing e falhas testados; provedores externos pendentes. |
| Frontend e acessibilidade | 6 | 67 | Build passou; matriz completa de browsers e tecnologia assistiva não foi concluída nesta auditoria. |
| Testes e verificabilidade | 8 | 70 | Suíte ampla, mas o run atual tem uma falha. |
| CI/CD e cadeia de suprimentos | 5 | 55 | Gates definidos; política de licenças falhou. |
| Observabilidade | 5 | 60 | Harness sintético passou; coleta e alertas externos não foram observados. |
| Desempenho e resiliência | 3 | 52 | Carga/caos sintéticos; metas em ambiente equivalente sem medição. |
| Manutenibilidade | 2 | 54 | Extrações recentes; quatro arquivos centrais ainda somam cerca de 12 mil linhas. |
| **Total ponderado** | **100** | **68** | **67,85 arredondado.** |

## Evidência executada nesta auditoria

| Procedimento | Resultado observado |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:static` | PASS |
| `npm run verify:architecture` | PASS; 13 pacotes de runtime, 24 casos de writer e zero ciclos reportados. |
| `npm run verify:pdp-universal` | PASS; 85 operações, 88 regras e 26/26 testes de catálogo runtime. |
| `npm run verify:aud27-semantics`, `verify:schema-manifest`, `verify:aud27-evidence-completeness` | PASS local. |
| `npm run verify:aud27-migration-harness` | PASS, 4/4 testes. |
| `npm run verify:observability-local` | PASS no harness; carga, caos e DR externos explicitamente `NOT_RUN`/`BLOCKED_EXTERNAL`. |
| `npm test` | FAIL: 669 testes, 667 pass, 1 fail e 1 skip. |
| Teste isolado `tests/unit/control-plane-aud23.test.ts` | FAIL reproduzido em `missing_transition`. |
| `npm run verify:control-plane` | FAIL: `LAST_GATE_NOT_TAIL` e `LAST_EVENT_NOT_TAIL`. |
| `npm run verify:aud27-evidence-root` | FAIL: fingerprint do pacote não corresponde à árvore atual. |
| `npm run audit:licenses` | FAIL: 10 dependências fora da allowlist. |
| `git diff --check` | PASS. |

`verify:production --structural` foi iniciado, entrou na matriz completa de E2E e foi interrompido; não há resultado final atribuível a esse gate. Não executei nesta rodada PostgreSQL real, deploy, staging, provedores externos, RTO/RPO ou revisão independente. Nenhum arquivo foi alterado durante a fase de auditoria.

## Achados atuais

### AR23-F01 — Control plane e regressão local vermelhos — P0

O estado aponta para `VER-CVG-AUD27-001-103` e `EVT-CVG-AUD27-001-103`, enquanto os ledgers já possuem caudas `...006-003`. O teste `missing_transition` altera a cauda, mas o verificador lê o evento apontado pelo estado; assim, o teste não prova a rejeição que pretende testar na fotografia atual. Reconciliar ponteiros por evento append-only, ajustar o caso negativo e repetir a suíte. Fontes: [estado](../.agent/state.json), [teste](../tests/unit/control-plane-aud23.test.ts), [verificador](../scripts/verify-control-plane.ts).

### AR23-F02 — Candidato e evidência divergentes — P0

`git status --short` mostrou 249 entradas, portanto a revisão Git não representa sozinha o candidato. A raiz externa AUD27 existe, corrigindo o achado histórico de ausência, mas seu pacote tem outro fingerprint. Congelar um candidato versionado e ligar a evidência aos seus bytes exatos. Fontes: [manifesto de sujeito](../scripts/subject-manifest.ts), [gate da raiz](../scripts/verify-aud27-evidence-root.ts).

### AR23-F03 — Persistência ainda dependente de snapshot — P0

O [inventário de migração](../packages/persistence/src/snapshot-migration.ts) declara 8 coleções `COMMAND_AUTHORITATIVE` e 24 `SNAPSHOT_PRIMARY`. O harness verifica protocolo e paridade sintética; não demonstra os 24 cutovers de domínio, rollback e restore do modelo final.

### AR23-F04 — Política de licenças falha — P0 para CI

Dez dependências foram rejeitadas pelo [gate](../scripts/verify-licenses.ts); a raiz não possui `LICENSE` nem `COPYING`. Isso não prova incompatibilidade jurídica: exige remediação de dependência ou decisão documentada sobre a política e a licença de raiz.

### AR23-F05 — Documentação corrente desatualizada — P1

O [índice](./README.md) ainda informa 78/80 schemas genéricos e ausência da raiz externa. O registro atual tem 80/80 schemas específicos, e a raiz existe, embora divergente. [Estado da implementação](./12-estado-da-implementacao.md) e [production readiness vNext](./production-readiness-vNext.md) também preservam fotografias antigas sem destaque suficiente para a leitura corrente. Três ADRs usam o número 036.

### AR23-F06 — Gates externos de produção não comprovados — P0 para promoção

Staging, provedores reais, secret authority, restore gerenciado, carga/caos, alertas externos, WebKit/tecnologia assistiva, qualificação independente e decisão humana seguem sem evidência atual para o mesmo candidato. O [roadmap AUD27](./roadmap-melhorias-cvg-aud27-2026-09-21.md) já reconhece essas dependências.

## Decisão e limite

O primeiro passo verificável é reconciliar o control plane e tornar a suíte local verde. Depois, congelar o candidato, refazer o vínculo da evidência e executar os cutovers. A nota de produção só deve ser revista após provas no ambiente correspondente; estes números são avaliação técnica desta fotografia, não certificação nem aceite clínico.
