# ADR 031 - Inventario de jornadas, CTAs e decisoes abertas

- Status: Accepted for execution planning
- Date: 2026-09-13
- Scope: AUD13-11
- Base artifact: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc` (worktree modificado da onda AUD13)
- Exclusive resource: `product-contracts`
- Fontes: `docs/01-prd-cvg.md`, `docs/03-dominio-dados-contratos.md`, `packages/contracts/src/api-catalog.ts`, `apps/web/src/routes/AppRoutes.tsx` e features reais.

## Context

A auditoria de 13/09/2026 (H05) registrou jornadas documentadas terminando em avisos ou sem
superficie na UI, e a tarefa AUD13-11 precisa congelar o mapa UI -> API -> policy -> commit/receipt
antes de implementar os modulos M2. Este inventario foi levantado por inspecao conectada das rotas
web, dos handlers e do catalogo de API executavel; ele separa o que existe, o que e bloqueio legitimo
e o que esta ausente. Inventariar nao conclui a jornada: cada lacuna permanece com a tarefa AUD13
dona do aceite.

Regras de leitura:

- `IMPLEMENTADO` significa jornada executavel pelo boundary apropriado **na onda AUD13 atual**;
  nao significa promocao, staging ou prova externa.
- `PARCIAL` significa que leitura/escrita existe em algum boundary, mas a jornada completa
  (formulario -> policy -> commit -> recibo -> estados) nao esta fechada na UI.
- `AUSENTE` significa que nao ha superficie operacional na arvore de rotas web.
- `BLOQUEIO` significa restricao deliberada com razao, dono e condicao de saida registrados.

## Decision 1 - Matriz FR01-FR22

| FR | Jornada/UC | Superficie UI atual | API (operation) | Policy | Commit/recibo | Estado | Tarefa |
|---|---|---|---|---|---|---|---|
| FR-01 | Autenticacao e contexto (UC-07/UC-01) | `Login`, `use-session`, troca de contexto | `/auth/login`, `/auth/mfa/verify`, `/auth/logout`, `/me`, `/contexts`, `/context` | `auth.login`, `auth.logout`, `identity.read`, `contexts.read`, `context.select` | Receipt em comandos; logout com `serverRevocation` observado | IMPLEMENTADO (onda 1) | AUD13-04/05/06/10 |
| FR-02 | Tutores e pacientes (UC-01) | `Patients` lista/busca/cadastro/ficha/desativacao/merge | `/guardians`, `/patients`, `/patients/:id`, `/patients/:id/disable`, `/patients/merge` | `guardians.read/create`, `patients.read/create/disable/merge` | `commandExecutor` + receipt nas escritas | IMPLEMENTADO (onda 2) | AUD13-12 (DONE) |
| FR-03 | Reservas (UC-01) | `Agenda` lista/cria/confirma/reagenda/cancela/check-in | `/appointments`, `/appointments/:id/{confirm,cancel,reschedule,check-in}`, `/queue`, `/scheduling/options` | `appointments.*`, `queue.check-in`, `scheduling.read` | Comando idempotente + receipt; versao otimista | IMPLEMENTADO (onda 3) | AUD13-13 (DONE) |
| FR-04 | Check-in, triagem, handoff (UC-01/02) | `Agenda` fila com triagem/handoff | `/appointments/:id/check-in`, `/queue/:id/{triage,handoff}`, `/queue`, `/encounters` | `queue.check-in`, `queue.triage`, `queue.handoff`, `encounters.create` | Fila com estado/prioridade; encounter unico por reserva | IMPLEMENTADO (onda 3) | AUD13-13 (DONE) |
| FR-05 | Prontuario, anexos, assinatura, adendo (UC-02) | `Clinical` lista, edita, revisa, assina e adenda | `/clinical/documents` (+`:id`, `:id/update`, `:id/review`, `:id/sign`, `:id/addenda`) | `clinical.read/write/draft/sign/addendum` | Comando + receipt + versao; assinado imutavel | PARCIAL (anexos bloqueados por D-03; restante implementado na onda 4) | AUD13-14 (PARTIAL) / AUD13-14A |
| FR-06 | Rascunho, revisao, assinatura, publicacao (UC-02) | Timeline com DRAFT->REVIEW->SIGNED e adendo | `/clinical/documents/:id/{update,review,sign,addenda}` | `clinical.write`, `clinical.draft`, `clinical.sign`, `clinical.addendum` | Assinatura exige REVIEW no servidor; imutavel | IMPLEMENTADO (onda 4) | AUD13-14 (DONE) |
| FR-07 | Pedidos, amostras, resultados (UC-03) | Aba Exames no Atendimento: pedido->amostra->resultado->revisao | `/diagnostics/requests` (+`:id/review`), `/specimens`, `/results` | `diagnostics.read/create/specimen/result` + `diagnostics.review` | Escrita autoritativa + quarentena de duplicado/parent errado; origem/versao preservadas | IMPLEMENTADO (onda 5) | AUD13-15 (DONE) |
| FR-08 | Internacao, medicacao, alta (UC-04) | Aba Internacao no Atendimento: leito/episodio/prescricao/dispensacao/administracao/handoff/alta | `/hospitalization/episodes` (+`:id/status`,`:id/discharge`), `/medications/orders` (+`:id/status`,`:id/dispense`,`:id/administer`), `/medications/{dispensations,administrations}` | `hospitalization.*`, `medication.*` | Fatos distintos com autoria/lote/horario; alta exige documento assinado e sem pendencia | PARCIAL (nucleo implementado; checklist/consentimento dependem de D-02/contrato) | AUD13-16 (PARTIAL) / AUD13-16A |
| FR-09 | Estoque, lotes, inventario (UC-05) | `Stock` entrada/movimentos/inventario/trilha | `/stock` (+`/movements`,`/locations`,`/products`,`/lots`,`/inventory`) | `stock.read/write/inventory` | Movimento imutavel + saldo + ajuste compensatorio auditado | PARCIAL (nucleo implementado; fornecedor/custo dependem de contrato) | AUD13-17 (PARTIAL) / AUD13-17A |
| FR-10 | Orcamento, cobranca, pagamento, conciliacao (UC-06) | `Finance` cobra/paga/estorna com trilha e politica explicita | `/finance/charges`, `/payments`, `/refunds`, `/ledger` | `finance.read/charge/payment/refund/ledger.read` | Ledger append-only + receipt; estorno compensatorio com REQUIRES_POLICY | PARCIAL (nucleo implementado; orcamento/aprovacao e conciliacao dependem de contrato/D-01) | AUD13-18 (PARTIAL) / AUD13-18A |
| FR-11 | Auditoria abrangente | `Admin` trilha | `/audit` | `audit.read` | Ledger + hash chain | IMPLEMENTADO local | AUD13-23 |
| FR-12 | Autorizacao no servidor | Todas as superficies | PDP em HTTP/application/tools/worker | catalogo runtime | Recusas auditadas | IMPLEMENTADO local | AUD13-23/28/36 |
| FR-13 | Sessoes IA reconstruiveis | `Copilot` sessao reutilizada, vinculo paciente/atendimento, historico/replay e aprovacao | `/ai/sessions`, `/ai/turns`, `/ai/sessions/:id/replay`, `/ai/approvals/:id` | `ai.*` | Turnos persistidos com provenance; replay reconstroi; chaves nao duplicam turno | IMPLEMENTADO local (onda 10) | AUD13-19 (DONE) / AUD13-27 (runtime real) |
| FR-14 | Catalogo de modelos/tools/skills/MCP/policies | Registry estatico + lifecycle de conhecimento na UI | `/capabilities`, `/knowledge`, registry do harness | `capabilities.read`, `knowledge.*` | Manifesto/registry server-side; admissao de artefatos depende de contrato | PARCIAL (registry GovernedArtifact com revogacao/rollback em AUD13-20A) | AUD13-20 (PARTIAL) / AUD13-20A |
| FR-15 | Budget pre/pos-turno por modalidade | Reserva atomica pre-dispatch no harness | `/ai/turns` + ledger de reservas no dominio | `ai.turn.*`, `ai:session` | Reserva por escopo/categoria; settle/expiry; overage explicito | IMPLEMENTADO local (onda 12) | AUD13-21 (DONE) / AUD13-27 (modalidades reais) |
| FR-16 | Confirmacao contextual | `Copilot` approval (permitir/negar) | `/ai/approvals/:id`, `/retry` | `ai.approval` | Digest/TTL/consumo unico | IMPLEMENTADO local | AUD13-19/28 |
| FR-17 | Negacao na ausencia de pre-requisitos | Erros de policy na UI | Boundaries locais | PDP/orcamento/aprovacao | Negativa auditada | IMPLEMENTADO local | AUD13-27/28/36 |
| FR-18 | Conhecimento com origem/versao/classificacao | Aba Conhecimento no Copiloto: ingestao/aprovacao/indexacao/busca/quarentena | `/knowledge` (+`/search`, `:id/index`, `:id/approve`, `:id/index`, `:id/quarantine`) | `knowledge.read/write/approve/index/quarantine/search` | Documento versionado com chunks/checksum derivados e ACL | IMPLEMENTADO (onda 11) | AUD13-20 (DONE parcial) |
| FR-19 | Automacoes programadas e recuperaveis | Nenhuma superficie | Worker/scheduler + outbox | policies de worker | Leases/receipts no backend | PARCIAL | AUD13-25 |
| FR-20 | Integracoes com credenciais minimas | Nenhuma superficie | `/integrations/:provider/events`, outbox/provider | secret provider + HMAC | Inbox/efeito/reconciliacao | PARCIAL (verticais reais ausentes) | AUD13-28 |
| FR-21 | Relatorios de operacao/custo/auditoria/incidentes | `Overview` graficos fixos | `/operations/summary`, `/metrics`, `/audit` | `operations.summary`, `metrics.read` | Auditoria de leitura | PARCIAL (graficos fixos e sem filtros) | AUD13-29 (PARTIAL) |
| FR-22 | Operacao manual sem IA | Formularios manuais parciais | Rotas manuais separadas do adapter | policies de negocio | Comandos manuais auditados | PARCIAL (registro clinico manual incompleto) | AUD13-14/30 |

## Decision 2 - Inventario de CTAs reais

`notify` e feedback, nunca operacao. CTAs que so chamam `notify` permanecem lacunas ate a jornada
completa; CTAs que executam `client.request` estao marcados como reais.

| CTA (arquivo) | Comportamento atual | Classe | Tarefa dona |
|---|---|---|---|
| `Admin` conceder acesso | POST `/role-assignments` + auditoria + recarga | REAL | - |
| `Admin` revogar vinculo | DELETE `/role-assignments/:id` + auditoria + recarga | REAL | - |
| `Copilot` processar turno | POST `/ai/turns` com policy/approval | REAL | - |
| `Copilot` permitir/negar | POST `/ai/approvals/:id` | REAL | - |
| `Agenda` Novo horario | formulario completo (paciente/servico/profissional/janela) + POST idempotente | REAL | - |
| `Agenda` Acoes de linha | confirmar/reagendar/cancelar/check-in reais com receipt | REAL | - |
| `Clinical` Abrir atendimento | seleciona o episodio e abre o prontuario | REAL | - |
| `Clinical` Novo documento/editor/assinar/adendo | comandos reais com receipt | REAL | - |
| `Clinical` Ver protocolo | conteudo informativo estatico | INFORMATIVO | - |
| `Finance` Nova cobranca | apenas `notify` | PLACEHOLDER | AUD13-18 |
| `Finance` Exportar | `notify` de bloqueio por retencao/autoridade | BLOQUEIO explicito | AUD13-24/18 |
| `Patients` Novo paciente | formulario completo (responsavel existente/novo) + POST idempotente + receipt | REAL | - |
| `Patients` Abrir ficha | GET `/patients/:id` + desativar/mesclar com confirmacao e receipt | REAL | - |
| `Patients` Exportar | `notify` de bloqueio de ambiente | BLOQUEIO explicito | AUD13-24 |
| `Overview` Ver sinais | apenas `notify` | PLACEHOLDER | AUD13-29 |
| `Stock` Registrar entrada | formulario produto/lote/validade/quantidade/local + RECEIPT idempotente | REAL | - |
| `Stock` Inventario/movimento | contagem fisica com ajuste compensatorio e movimentos auditaveis | REAL | - |

## Decision 3 - Exemplos congelados por jornada

Cada UC tem um caso bom, um caso negado e um caminho de recuperacao. Estes exemplos sao os
primeiros cenarios que as tarefas M2 devem transformar em teste executavel.

| UC | Sucesso | Negacao | Recuperacao |
|---|---|---|---|
| UC-01 Agendar/receber | reserva unica com tutor/paciente/servico/janela/status e fila de check-in | horario ocupado, recepcao fora da unidade ou paciente sem vinculo nao cria reserva parcial | conflito/timeout mantem `NOT_CONFIRMED`/`PENDING_EXTERNAL` com a mesma chave; consulta/corrige/repetе |
| UC-02 Triagem/clinica | atendimento com timeline, autoria, versao, assinatura e referencias | IA sem origem/contexto nao escreve no prontuario; falha do agente nao impede registro manual | rascunho/aberto com pendencias; nova tentativa reusa chave ou cria adendo |
| UC-03 Exame/resultado | pedido, amostra, resultado e revisao ligados por versao e origem | resultado sem amostra/paciente, unidade incompativel ou duplicata vai para quarentena | `QUARANTINED` com motivo; worker reconcilia ou mantem `OUTCOME_UNKNOWN` para decisao humana |
| UC-04 Internacao/alta | episodio fechado com pendencias, medicacoes e plano de retorno decididos | leito/checklist/ordem/lote invalidos impedem transicao; provider nao fecha alta | episodio aberto com handoff preservado; transferencia cria nova versao sem apagar tarefas |
| UC-05 Estoque | movimento com item/lote/local/quantidade/ator/motivo/chave/saldo | saldo negativo, lote vencido ou dispensacao sem autorizacao negam atomicamente | reserva interrompida em estado conhecido; ajuste compensatorio com motivo e alcada |
| UC-06 Financeiro | valor com origem/moeda/ator/timestamp/estado de liquidacao/reconciliacao | valor sem item aprovado, versao vencida, webhook duplicado ou estorno fora de alcada nao altera o ledger | consulta por idempotency key, reconciliacao ou `OUTCOME_UNKNOWN`; correcao compensatoria sem apagar |
| UC-07 Copiloto/automacao | turno governado com policy/modelo/budget/tools/referencias e receipt | tool de impacto sem policy/approval valida nao executa; timeout nao vira sucesso | falha encerra turno com motivo e mantem caminho manual; `OUTCOME_UNKNOWN` bloqueia retry cego |

## Decision 4 - Decisoes abertas com dono

Nenhuma destas decisoes autoriza inventar regra clinica, financeira ou de dados. Cada uma tem dono
humano e escopo bloqueado identificado; o trabalho independente segue nas demais fatias.

| ID | Decisao pendente | Dono | Bloqueia | Trabalho ja entregavel sem ela |
|---|---|---|---|---|
| D-01 | Semantica de estorno/credito/reabertura e alcadas (BR-07 permanece UNKNOWN) | Responsavel financeiro | AUD13-18 completo (conciliacao/estorno) | cobranca/pagamento idempotentes e contrato de saldo (onda 1, DONE) |
| D-02 | Regras de alta com pendencia, retificacao de assinatura e campos clinicos obrigatorios | Direcao clinica | AUD13-16 completo e adendo de AUD13-14 | editor/timeline/assinatura manual e adendo generico |
| D-03 | Retencao/residencia, autoridade de reconciliacao de restore, exportacao e storage de anexos clinicos | Autoridade de dados + operacao | etapa externa de AUD13-24 e AUD13-14A (anexos) | prontuario textual, restore/quarentena sinteticos e export cifrado |
| D-04 | Tetos multidimensionais de budget e unidade final de cobranca (BR-09) | Produto + financeiro | fechamento de AUD13-21 | reserva atomica local com limites explicitos |
| D-05 | Staging/TLS/DB gerenciado, secret authority, provider/modelo real, sink de alertas e teto de custo | Infraestrutura | 26/27/28/31/34 externos | contratos, renderizacao e provas sinteticas locais |
| D-06 | Operador assistivo, dispositivos e usuarios representativos | UX/qualidade | AUD13-35 e parte de 36 | matriz automatizada e correcoes de acessibilidade |

## Consequences

- As tarefas AUD13-12 a AUD13-20 herdam esta matriz como escopo, sem criar segunda fonte de status:
  o aceite continua em `docs/plano-melhorias-2026-09-13/backlog.json` e o estado em `.agent/backlog.json`.
- CTA placeholder nao pode ser encerrado por renomeacao ou aviso; exige formulario -> policy ->
  commit -> recibo -> estados, conforme o aceite da tarefa dona.
- Bloqueios legitimamente dependentes de autoridade humana permanecem `BLOQUEIO` com razao visivel,
  nunca suprimidos por disabled/toast silencioso.
- Este inventario deve ser revisado por AUD13-37 quando todas as integracoes mudarem o candidato.

## Verification

- Consulta de cobertura executada sobre este documento: 22/22 FRs e 7/7 UCs presentes exatamente
  uma vez; 13 chamadas `notify` encontradas por grep nas features e 13 linhas correspondentes na
  tabela de CTAs (mais os 4 CTAs reais de Admin/Copilot); 6 decisoes abertas com dono.
- Evidencia registrada em `.agent/verification.jsonl#VER-CVG-AUD13-11-001`.
