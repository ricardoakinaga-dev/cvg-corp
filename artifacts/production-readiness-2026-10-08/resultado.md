# Resultado — fechamento dos achados abertos e prontidão local (08/10/2026)

**Veredito local:** os dez achados abertos da auditoria de 03/10 que eram
corrigíveis no código foram corrigidos, cada um com regressão que falha no
código original. Todos os gates locais executáveis passaram sobre o código
final, incluindo PostgreSQL real descartável, imagens Docker e a matriz E2E.
**Veredito de release:** continua `PROMOTION_BLOCKED`. O que falta não é código:
candidato congelado (commit), staging com autoridades reais e decisão humana.

## Ponto de retomada

O plano de 04/10 (`.agent/plans/2026-10-04-production-hardening.md`) terminou
PARTIAL, com verificação local aprovada, revisão final indisponível e nenhum
commit. O fingerprint do código em 08/10 era idêntico ao de 04/10, e a suíte foi
reexecutada antes de qualquer mudança (990 casos, 989 aprovados, 1 skip). A
revisão do diff pendente não encontrou defeito. A leitura dos relatórios de
`artifacts/audit-2026-10-03/` mostrou que dez achados registrados nunca haviam
sido corrigidos no código; esta etapa os fechou.

## Achados fechados

| Achado | Prioridade | O que mudou | Prova de regressão |
| --- | --- | --- | --- |
| FQ-06 logout durante revalidação | P1 | A revalidação em voo é invalidada no logout; a revogação no servidor é tentada fora do modo offline e não é bloqueada pelo gate de runtime | E2E falha no código original (sessão reaberta, nenhum `POST /auth/logout`); passa em Chromium, Firefox e móvel |
| SEC-AI-03 chave de callback × provider | P1 | `CVG_INTEGRATION_CALLBACK_KEYS` com pares `provider=keyRef` mantidos pelo servidor; par ausente é recusado antes de resolver segredo ou escrever | Unit com a sonda da auditoria; PostgreSQL: mesma chave para outro provider → 403 |
| SEC-AI-04 produção sem IA | P1 | `CVG_AGENT_RUNTIME=disabled` dispensa pré-requisitos DeepSeek em config e `verify:production`; demais modos recusam o mock | `vnext.test.ts`, `production-config.test.ts` |
| FQ-01 produto órfão no estoque | P2 | `GET /stock/products` (catálogo com RLS); formulário mantém o produto criado e usa nova intenção após recusa definitiva | E2E com reload falha no original; PostgreSQL: produto sem lote listado, chave recusada → 409, nova intenção → 201 |
| FQ-02 pagamento parcial | P2 | Valor sugerido é o saldo em aberto | E2E falha no original (`100` em vez de `60,00`) |
| FQ-03 mensagem do error boundary | P2 | Não afirma mais que nada foi alterado | E2E falha no original |
| FQ-04 classificador de mutação | P2 | Só falha de teste reportada conta como KILLED; baseline sem mutação obrigatória; timeout, sinal e spawn são INVALID | Unit; execução real 30/30 KILLED, 0 INVALID |
| FQ-05 saídas E2E compartilhadas | P2 | `PLAYWRIGHT_OUTPUT_DIR` isola traces, relatório e cache do Vite; o CI mantém os caminhos | Execução isolada observada |
| Dependências | moderado/alto | fastify 5.12.5, fast-uri 4.2.1/3.1.8, source-map-js 1.2.2 (só registro oficial) | `npm audit`: 0 vulnerabilidades |
| Ponte DeepSeek sem limite de resposta | — | Leitura incremental com teto (2 MiB por padrão, configurável) | Unit com stream de 1 MB contra teto de 4 KiB |

## Evidência executada no código final

Recibos individuais (comando, exit, duração, SHA-256 do log) estão em
`verification/`. Resultados principais:

- `npm test`: 997 casos, 996 aprovados, 0 falhas, 1 skip opcional (ACP real).
- typecheck, lint (306 arquivos + oxlint), build com budgets, arquitetura
  (orçamentos mantidos, 0 ciclos), static, PDP (26 testes de rotas), PDP universal,
  schema manifest, integridade documental, claims, licenças, tokens, contraste,
  IA desligada, segurança do agente, sandbox de provedores, escritas
  autoritativas, worker runtime, estrutura de produção e `git diff --check`: exit 0.
- Cobertura: 89,50% linhas, 77,22% branches; persistence 86,35% (ratchet 84,2%).
- Mutação: 30/30 KILLED com o classificador estrito.
- PostgreSQL 16 descartável: 49 migrations, comportamento e restore, oráculo RLS
  sem resíduo, migração de dados e escritas normalizadas, 24/24 fatias com
  paridade, CLI de migração 7/7 (lock concorrente), rota de resposta com
  callback/produtos/idempotência. Bancos e containers removidos; inventário
  externo inalterado.
- Imagens: API e web construídas; smoke 10/10 cada (sem root, rootfs somente
  leitura, loopback, saúde, 401, 400 redigido, login, CSP, deep link, SIGTERM);
  smoke durável 13/13 (migrate compilado, papel sem privilégio, sessão após
  reinício, heartbeat do worker, nenhuma entrega externa).
- Navegador: matriz completa com 558 casos em Chromium, Firefox e WebKit (wide,
  tablet, mobile e stress), 521 aprovados, 37 skips condicionais já justificados,
  0 falhas e 0 flaky. Saídas isoladas fora do repositório.
- Scanner de segredos (gitleaks fixado): histórico Git e árvore atual aprovados.
- `npm audit`: 0 vulnerabilidades.
- Alertmanager: o gate exige o webhook real do ambiente (`CVG_ALERTMANAGER_WEBHOOK_URL`)
  e falha fechado sem ele; o render com sink sintético de loopback passou.

## Consolidação em commits

O trabalho de 03/10, 04/10 e 08/10 foi consolidado na branch
`production-readiness-2026-10-08` (commits temáticos sobre a `main` local, que
já estava 16 commits à frente de `origin/main`). Depois dos commits, os gates
equivalentes ao CI foram repetidos sobre o código commitado (`verification/after-commit/`,
registro `VER-CVG-AUD27-001-COMMITTED-SOURCE-20261008`): todos aprovados.

Dois ajustes foram necessários para que o controle fosse verificável em commit:

- O verificador de control plane exigia `sourceSha == HEAD`, o que nunca vale
  num commit que grava o próprio controle; o teste de estado vivo reprovava em
  todo commit de consolidação. Agora o SHA registrado pode ficar atrás do HEAD
  somente se o HEAD descende dele e todos os caminhos alterados depois estão
  fora do sujeito (`.agent/`, `artifacts/`…). Mudança de código depois dele
  continua reprovada; ambos os casos têm teste.
- Os passos de CI `verify:aud26-evidence --capture` e `verify:evidence-snapshot`
  amarram evidências ao SHA `c990914` e a uma janela de 7 dias sobre arquivos de
  setembro. Eles reprovam da mesma forma em `9aab406` e em `origin/main` hoje.
  Não foram relaxados: foram movidos para o fim do job, para não esconderem os
  demais gates. Passam somente quando o pacote de evidências do candidato
  congelado for capturado para o SHA exato (AUD27-004/005).

## Decisões

- Contagens fixadas em testes foram atualizadas pela rota nova (105→106 rotas,
  80→81 schemas, 45→46 GETs), não removidas.
- O orçamento de `packages/persistence/src/index.ts` não foi aumentado; a leitura
  de produtos foi extraída para `stock-product-persistence.ts`.
- Callbacks falham fechado: sem pares configurados, toda assinatura é recusada.
- `source-map-js@1.2.2` tem 8 dias de publicação; é dependência de build
  (vite→postcss) e corrige advisory alto.
- Arquivos versionados regenerados pelos gates (`artifacts/aud26/...`,
  `artifacts/coverage-*`, `artifacts/mutation-summary.json`) foram restaurados;
  as saídas desta etapa estão em `verification/`.

## Limites e próximo passo

Fora do alcance local, e ainda necessários para liberar produção: commit limpo e
candidato congelado (AUD27-004); staging com Secret Authority, TLS, MFA, OTLP e
Alertmanager reais; provedores de mensageria e modelo autorizados; backup/restore
gerenciado com RTO/RPO medidos; carga e caos em staging; tecnologia assistiva
real; revisão independente; decisão humana de release. Observações sem correção
nesta etapa: o evento `ai.turn` registra `ALLOWED` também para resultado
desconhecido; o runtime de plugins não é sandbox (e não está ligado em produção);
dois perfis de agente não são alcançados pelo seletor padrão.
