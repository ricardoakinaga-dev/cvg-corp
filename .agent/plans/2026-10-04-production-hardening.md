# CVG-Corp — preparação local para produção

<!-- engineering-framework: active_action_id: AUD27-001:SEMANTIC-RECONCILIATION -->

## Purpose / Big Picture

Atender ao pedido de corrigir falhas, revisar rotas, integrações, migrations e
bancos, remover legados/órfãos comprovados e preparar o programa para produção.
Esta etapa valida o código local; implantação e qualificação de serviços reais
continuam dependentes do ambiente de destino. Não há autorização de publicação,
mensagens reais, alteração de credenciais nem manipulação de dados reais.

## Context and constraints

Continuação em 2026-10-04. O trabalho anterior de MFA, detector heurístico e
quarentena deve ser preservado, assim como todo o histórico de evidências.
Nenhum AGENTS.md aplicável foi encontrado na cadeia de diretórios ou no projeto.
O plano AUD27 anterior permanece como histórico e referência dos gates externos.
O estado congelado de setembro diverge do código atualmente modificado.

API Fastify, frontend React/Vite, worker separado, PostgreSQL e runtime de IA
configurável. Compatibilidade snapshot/normalizado e adaptador externo têm usos
ativos; não são lixo apenas por serem antigos. Migrations aplicadas não serão
reescritas. Bancos e containers de validação devem ser novos e descartáveis,
com limpeza restrita ao proprietário. Não apagar artefatos de auditoria.

## Quality Bar v1 — frozen before implementation

| ID | Origem | Alvo obrigatório e evidência | Limite |
| --- | --- | --- | --- |
| PROD-01 | USER/REPO | Controle de evidências coerente; teste de conhecidos inválidos e CLI aprovados, histórico preservado | Coerência não equivale a liberação |
| PROD-02 | USER/REPO | Rotas e schemas/PDP verificados; bugs encontrados reproduzidos e cobertos por regressão HTTP | Fixtures não provam tráfego real |
| PROD-03 | USER/REPO | PostgreSQL descartável: migrations, persistência, isolamento e restauração executados | Não comprova cutover de dados reais |
| PROD-04 | USER/REPO | Adaptadores de integração exercitados em sandbox, falhas visíveis e efeitos protegidos | Provedores reais não chamados |
| PROD-05 | USER/REPO | Build web e runtime, configuração de produção e smoke local verificados | Imagem/registro/TLS externos requerem prova própria |
| PROD-06 | USER/DERIVED | Remoções somente após busca de referências estáticas, dinâmicas, scripts e deploy | Preservar compatibilidade e histórico |
| PROD-07 | REPO | Suíte completa, typecheck, lint, arquitetura, diff e scanner local executados no código final | Declarar skips e falhas, não ocultá-los |
| PROD-08 | DERIVED | Revisão final com contexto novo, sem mutações, sobre código e provas atuais | Não substitui autoridade de produção |

## Ownership and execution

Líder: controlador, empacotamento/configuração, inventário de órfãos, integração
e verificação final. Leibniz: API e adaptadores de integração, com regressões
novas delimitadas. Rawls: persistência e provas PostgreSQL descartáveis.
Sem subdelegação. Máximo de duas frentes implementadoras simultâneas e um
revisor final; sem repetir falhas determinísticas sem nova hipótese/evidência.
Cada implementador entrega diffs e provas, nunca sua própria aprovação final.

## Milestones

1. Recuperar o controle sem reescrever recibos; marcar qualificações históricas
   como históricas e manter promoção bloqueada durante alterações.
2. Reproduzir e corrigir defeitos de API, integrações, persistência e execução;
   documentar os candidatos a remoção e manter o que ainda possui consumidores.
3. Integrar, executar checks finais sequencialmente quando disputam recursos,
   obter revisão independente e registrar limites operacionais reais.

## Next Action — AUD27-001

- action_id: AUD27-001:SEMANTIC-RECONCILIATION
- status: PARTIAL
- completion_signal: estado, plano, backlog e recibos novos concordam; verificador
  rejeita conhecidos inválidos; nenhuma evidência antiga vira sucesso atual.

## Concrete Steps

1. [AUD27-001:SEMANTIC-RECONCILIATION] Consolidar os recibos atuais e a revisão
   independente, preservando o histórico e a condição de candidato não congelado.
2. Inspecionar os diffs das frentes API/banco e validar regressões reproduzíveis.
3. Revisar referências de código/arquivos, build e inicialização do runtime.
4. Executar regressão final, scanner e revisão independente no código integrado.
5. Registrar resultado, limitações e a próxima ação concreta de implantação.

## Progress and evidence

- 2026-10-04: recuperação e inspeção iniciadas; baseline do controle em
  `artifacts/production-hardening-2026-10-04/control/`.
- Resultados de API e banco pertencem às subpastas `api/` e `database/` do
  mesmo diretório. Resultado final deve ligar logs, exits e hashes do código.
- Correções integradas: erros HTTP 400/413/415 com envelopes redigidos;
  cancelamento das integrações antes/depois do envio e recibos de entrega;
  recuperação que inclui o histórico de auditoria durável posterior ao snapshot;
  manifesto de código que trata exclusões Git ainda não preparadas no índice.
- Limpeza: removido `docker/runtime-entrypoint.sh`, sem consumidor comprovado;
  o entrypoint `.mjs` e sua compatibilidade ativa foram preservados. Os cinco
  testes de observabilidade foram movidos para a suíte normal, com referência
  do runbook corrigida. Nenhuma migration SQL aplicada foi apagada ou reescrita.
- A revisão intermediária identificou que RLS podia esconder resíduos do próprio
  verificador. O escopo completo é agora restaurado por fixture; os três controles
  presentes são rejeitados e os três controles após rollback são aceitos no banco real.
- O novo teste do CLI reproduziu concorrência entre dois migradores. A execução
  inteira passa a possuir um lock de sessão PostgreSQL, com espera limitada a 30 s;
  sete testes reais cobrem instalação, replay, corrida, rollback, checksum,
  interrupção do dono do lock e recuperação após timeout.
- Código final observado: `sha256:15ece6ef83fb9e9918dddcde7757e337fb81b42b07b6b04474c68580fcb794b2`.
  Os recibos em `artifacts/production-hardening-2026-10-04/verification/after-review/`
  registram comando, exit, SHA-256 do log e fingerprint antes/depois de cada execução.
- Regressão atual: suíte principal 990 casos, 989 aprovados, zero falhas, um skip
  opcional do provedor ACP real. Navegador: 34 casos selecionados em Chromium e
  Firefox wide-1440, 33 aprovados e um skip de internação no Firefox por fixture
  compartilhada. Isto não equivale à matriz completa de browsers/viewports.
- PostgreSQL final: 49 migrations; dez relações idênticas no restore; 18 entradas
  inválidas rejeitadas antes de conectar; 24/24 grupos com paridade, replay sem
  duplicações e rollback. Os verificadores confirmaram remoção dos bancos próprios
  e inventário externo inalterado. Os 24 grupos continuam `SNAPSHOT_PRIMARY`.
- Imagens recompiladas e identificadas em `runtime/verified-builds.json`: API/web
  sem root, filesystem somente leitura, saúde, autenticação, erros, assets/deep links
  e SIGTERM aprovados. Prova adicional executou o CLI compilado, API autenticada,
  sessão após reinício e worker com heartbeat durável em PostgreSQL sintético;
  containers e rede internos foram removidos por propriedade. `NODE_ENV=test`:
  isto não atesta TLS, MFA operacional, OTLP ou provedores do ambiente de produção.
- Typecheck, lint, build, arquitetura, schemas, documentação, PDP/26 testes de rotas,
  38 testes focais do worker, sandbox de integrações e Compose estrutural aprovados.
  O driver tentou um nome inexistente `verify:routes` e parou sem executar esse
  comando; a cobertura real de rotas é `verify:pdp`, e os checks restantes foram
  executados separadamente. Nenhum exit agregado desse driver foi declarado PASS.
- Scanner local de segredos: execução simultânea ao navegador flagrou um trace
  transitório. Após o encerramento normal, o arquivo não existia mais; a varredura
  de histórico e árvore atual passou, sem novas exceções. Não executar scanner
  em paralelo a testes que criam traces de autenticação. Falhas anteriores foram
  preservadas e não reclassificadas como sucessos.

## Decisions and risks

Usar o modo não congelado já previsto pelo controlador durante desenvolvimento,
em vez de atribuir fingerprints atuais a execuções antigas. Não afrouxar o
verificador, ignorar testes ou apagar recibos para obter verde. Uma falha de
restore será diagnosticada contra o estado persistido, sem reduzir seu oráculo.

As comparações de sessão após reinício excluem somente o `context.correlationId`
renovado por requisição; identidade, sessão e autorização devem permanecer iguais.
A rede interna do teste de imagens usa HTTP no loopback do próprio container.
Falhas de harness foram corrigidas no harness sem afrouxar as proteções do produto.

## Recovery and idempotence

Antes de retomar, ler estado, este plano, backlog e caudas dos ledgers; comparar
com o Git e as provas. Preservar os snapshots anteriores do controle. Conferir
recursos locais de testes antes de qualquer repetição. Atualizações de recibos
usam IDs novos. Resultados são locais; candidate freeze e promoção permanecem
separados, e código novo invalida provas de código anteriores.

## Outcomes and retrospective

Verificação local integrada concluída; revisão final sem parecer após tentativas de retomada.
Veredito: PARTIAL; PROD-08 não concluído e produção permanece não qualificada.
Nenhum commit, push, deploy, transação com provedor real ou alteração de banco de
produção foi executado. A liberação depende de candidato congelado e identificável,
ambiente de staging com configuração/segredos/TLS/MFA/OTLP reais, integração com
provedores autorizados, recuperação operacional/RTO/RPO e aceite de release.

Evidências consolidadas: `artifacts/production-hardening-2026-10-04/verification/check-index.json`.
Revisão: `artifacts/production-hardening-2026-10-04/review/final-review.md`.

O controle final identificou incompatibilidade entre recibo PARTIAL e tarefa IN_PROGRESS.
A tarefa, o plano e o estado foram reconciliados para PARTIAL, com evento novo;
o recibo e o evento anteriores, inclusive a falha do verificador, foram preservados.
