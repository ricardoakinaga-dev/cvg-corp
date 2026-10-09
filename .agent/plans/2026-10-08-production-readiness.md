# CVG-Corp — fechamento dos achados abertos e prontidão local para produção

<!-- engineering-framework: active_action_id: AUD27-001:SEMANTIC-RECONCILIATION -->

## Purpose / Big Picture

Retomar a partir da documentação o ponto em que as melhorias pararam e levar o
programa ao estado pronto para produção no que é verificável localmente. O plano
de 04/10 terminou PARTIAL: verificação local aprovada, revisão final (PROD-08)
sem parecer e nenhum commit. A auditoria de 03/10 deixou dez achados de produto,
segurança e ferramental sem correção no código, apesar de registrados.

## Context and constraints

Recuperação em 2026-10-08: o código atual tinha o mesmo fingerprint registrado em
04/10 (`sha256:15ece6ef…`), e a suíte foi reexecutada antes de qualquer mudança
(990 casos, 989 aprovados, 1 skip; typecheck e lint aprovados). Os artefatos de
auditoria e os recibos anteriores são preservados; as provas novas ficam em
`artifacts/production-readiness-2026-10-08/`. Nenhuma migration aplicada foi
alterada. Nenhum commit, push, deploy, provedor real ou dado real foi usado.

## Findings closed in this unit

| Achado (03/10) | Prioridade | Correção | Regressão que falha no código original |
| --- | --- | --- | --- |
| FQ-06 logout durante revalidação reabre a sessão e não revoga | P1 | `signOut` invalida a revalidação em voo e revoga no servidor fora do modo offline; `/auth/logout` deixa de ser bloqueado pelo gate de runtime | E2E `logout durante revalidação…` (Chromium/Firefox/móvel) e unit do cliente |
| SEC-AI-03 chave de callback não vinculada ao provider | P1 | Vínculo `provider=keyRef` mantido pelo servidor (`CVG_INTEGRATION_CALLBACK_KEYS`), rotação dentro do provider, recusa antes de resolver segredo ou escrever | `tests/unit/integration-callback-binding.test.ts`; verificador PostgreSQL recebe 403 |
| SEC-AI-04 produção sem IA exige DeepSeek | P1 | `CVG_AGENT_RUNTIME=disabled` dispensa os pré-requisitos DeepSeek na configuração e em `verify:production`; demais modos seguem recusando o mock | `vnext.test.ts` e `production-config.test.ts` |
| FQ-01 produto criado antes de lote recusado fica irrecuperável | P2 | Nova rota `GET /stock/products` (catálogo com RLS); formulário mantém o produto criado e usa nova intenção após recusa definitiva | E2E com reload; verificador PostgreSQL (lista, 409 na chave recusada, 201 na nova intenção) |
| FQ-02 pagamento parcial abre com o total | P2 | Valor sugerido = saldo em aberto | E2E financeiro verifica `100,00` e depois `60,00` |
| FQ-03 boundary afirma que nada foi alterado | P2 | Mensagem não nega escritas já aceitas | `root-boundary.spec.ts` |
| FQ-04 mutação conta falha de execução como KILLED | P2 | Classificação por eventos estruturados do runner: só falha lançada dentro de um teste em execução mata; arquivo que não carrega ou termina o processo, timeout, sinal, spawn e baseline reprovada = INVALID | `mutation-verifier.test.ts` dirige o runner real (erro de sintaxe, `process.exit`, throw no topo); execução real 30/30 KILLED |
| FQ-05 execuções E2E concorrentes compartilham saídas | P2 | Cada execução local usa `test-results/runs/<run>/` por padrão (traces, screenshots, relatório, cache Vite); `PLAYWRIGHT_OUTPUT_DIR` escolhe outro; CI mantém caminhos | Duas execuções simultâneas sem variável: diretórios distintos, relatório compartilhado intocado |
| Dependências fastify/fast-uri (moderadas) e source-map-js (alta) | — | `npm audit fix` restrito a 4 pacotes do registro oficial | `npm audit` sem vulnerabilidades |
| Ponte DeepSeek lê resposta sem limite | — | Leitura incremental com teto (padrão 2 MiB) | `vnext.test.ts` |

## Critical review of this unit (2026-10-08, second round)

Uma revisão crítica da entrega confirmou as correções e apontou cinco pendências
reais, todas reproduzidas antes de corrigir:

| Pendência | Correção | Commit |
| --- | --- | --- |
| P2 classificador de mutação aceitava erro de sintaxe e `process.exit(1)` como KILLED (o runner imprime `fail 1`) | Reporter estruturado; falha de processo/carregamento invalida; kill exige falha lançada num teste em execução | `60ae0c0` |
| P2 `ai.turn` auditava `OUTCOME_UNKNOWN` como `ALLOWED` | Mapa exaustivo por status; `UNKNOWN` com `turnStatus`; recibo vinculado ao registro honesto; regressão HTTP com ledger indisponível | `daef871` |
| P2 isolamento E2E dependia de variável manual | Diretório por execução por padrão; screenshots via `testInfo.outputPath` | `db04017` |
| P2 envelopes de evidência bloqueavam o job de imagens; upload pulado em falha | Job `evidence-binding` independente (ainda reprova o workflow); uploads com `!cancelled()` | `779cda2` |
| P2 relatório atribuía provas à versão errada (imagens de árvore não commitada, "todos aprovados" com dois recibos reprovados, 997×999 casos) | Requalificação do commit `8cd545f` com recibos que registram HEAD, commit de código, fingerprint e estado da árvore; docs do sujeito sem números circulares | `8cd545f` |

O primeiro CI do lote revelou mais uma falha que só existia fora desta máquina: 55 links de relatórios históricos apontavam para arquivos ignorados pelo Git (`*.log`, `artifacts/runs/*.png`). O gate de documentação passou a recusar esses links em qualquer ambiente (`LOCAL_ONLY_LINK`) e as referências viraram caminhos marcados como evidência local (`e658c00`). Ao levar o CI até o fim, a simulação local nas condições do CI revelou mais três: o passo PostgreSQL de integração não recebia `MIGRATION_DATABASE_URL`; o restore, depois do gate de concorrência, reprovava no oráculo exato pelo recibo-sonda fora da autoridade de snapshot (ordem passou a ser restore → concorrência); e o job precisava de mais tempo porque `verify:production` repete a matriz de navegador (`8e1aa10`). O Trivy do job de imagens, com o mesmo critério do CI, acusou HIGH corrigíveis nas bases (`libssl3t64`, `pcre2`, `tiff`); digest distroless atualizado e upgrade pontual na web (`33f0fee`). O CI desse commit passou no PostgreSQL e revelou a última: a cobertura regrava `artifacts/coverage-output.txt` (versionado) com espaços no fim das linhas da tabela do Node, e `git diff --check` reprovava em `verify:production`; o artefato passou a ser gravado sem eles (`3f5a736`). A requalificação local de `3f5a736` ficou cerca de 7 h parada na matriz de navegador, e quem detectou foi a segunda revisão crítica. O Firefox do projeto firefox-stress trava dentro do kernel deste host (SIGKILL pendente, impossível de matar; 2 de 2 tentativas) e segura o stdio do navegador, então o worker do Playwright esperava sem fim. O diagnóstico e os logs estão em `requalification-3f5a736/e2e-hang-diagnostics/`. O orquestrador ganhou watchdog de inatividade e de tempo, com rastreamento de descendentes. A matriz local foi refeita sem o firefox-stress, que passou no CI do mesmo código (run 37876416723). Também entraram as correções de CI pendentes: digest do AUD26 sem mtime
(`0c9a429`) e prompt AUD27 versionado com digest refixado com aprovação do
dono do repositório (`e5464ea`).

## Next Action — AUD27-001

- action_id: AUD27-001:SEMANTIC-RECONCILIATION
- status: PARTIAL
- completion_signal: candidato congelado em commit limpo (AUD27-004) com os
  recibos desta etapa; provas de staging e autoridades externas registradas
  separadamente; nenhuma alegação de release a partir de provas locais.

## Concrete Steps

1. [AUD27-001:SEMANTIC-RECONCILIATION] Consolidar o trabalho de 03/10, 04/10 e
   08/10 em commits temáticos numa branch e abrir pull request para o CI remoto.
2. Congelar o candidato a partir do commit revisado (AUD27-004) e repetir a
   qualificação sobre o mesmo fingerprint.
3. Levar as provas externas ao ambiente de destino: Secret Authority, TLS, MFA,
   OTLP, webhook do Alertmanager, provedores, DR com RTO/RPO e decisão humana.

## Decisions and risks

A rota nova altera contagens fixadas em testes (105→106 rotas, 80→81 schemas);
foram atualizadas, não removidas. O orçamento arquitetural de
`packages/persistence/src/index.ts` não foi aumentado: a leitura foi extraída para
`stock-product-persistence.ts`. O vínculo de callbacks falha fechado: sem pares
configurados, todo callback assinado é recusado. `source-map-js@1.2.2` foi
publicado em 30/09 (menos de duas semanas); é dependência de build (vite→postcss)
e corrige advisory alto. O harness de mutação passou a exigir baseline aprovada,
o que expôs uma contagem fixada que o primeiro run classificou corretamente como
INVALID.

## Progress and evidence

Recibos por comando (comando, exit, duração, SHA-256 do log) em
`artifacts/production-readiness-2026-10-08/verification/`. O resultado consolidado
e os limites estão em `artifacts/production-readiness-2026-10-08/resultado.md`.

## Outcomes and retrospective

Ver o resultado consolidado. Permanecem fora do alcance local: candidato
congelado (commit limpo, AUD27-004), staging com segredos/TLS/MFA/OTLP reais,
provedores reais, DR/RTO/RPO medidos e decisão humana de release.
