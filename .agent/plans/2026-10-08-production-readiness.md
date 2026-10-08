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
| FQ-04 mutação conta falha de execução como KILLED | P2 | Só falha de teste reportada mata; timeout/sinal/spawn/baseline falha = INVALID | `mutation-verifier.test.ts`; execução real 30/30 KILLED |
| FQ-05 execuções E2E concorrentes compartilham saídas | P2 | `PLAYWRIGHT_OUTPUT_DIR` isola traces, relatório e cache Vite; CI mantém caminhos | Execução isolada observada |
| Dependências fastify/fast-uri (moderadas) e source-map-js (alta) | — | `npm audit fix` restrito a 4 pacotes do registro oficial | `npm audit` sem vulnerabilidades |
| Ponte DeepSeek lê resposta sem limite | — | Leitura incremental com teto (padrão 2 MiB) | `vnext.test.ts` |

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
