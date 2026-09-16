# CVG-Corp — documentação comparada à implementação

**Data: 13/09/2026. Nota geral: 59/100. Veredito de conformidade integral: FAIL.**

O sistema tem uma base técnica considerável: contratos executáveis, controle de contexto e autorização no servidor, persistência transacional, auditoria, idempotência e workers. Entretanto, a implementação ainda não entrega diversas jornadas previstas nos documentos. Há defeitos reproduzidos no logout, MFA, saldo financeiro e layout móvel, além de lacunas de IA e operação. **Não há evidência suficiente para classificá-lo como pronto para produção ou Triplo AAA.**

Esta é uma auditoria, não uma implementação. Nenhuma correção do produto foi realizada. As alterações locais preexistentes foram preservadas. Relatório, cópias de execução e evidências foram produzidos fora do repositório.

## 1. Escopo, referência e método

- Repositório: `/home/ricardo/Área de trabalho/cvg-corp`.
- HEAD: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`, **com alterações locais**, incluindo contratos e ADRs 029/030. O objeto avaliado é o worktree fotografado, não apenas o commit.
- Ambiente: Node 24.20.0, npm 11.19.0; dados sintéticos e serviços próprios de loopback.
- Corpus inventariado: **151 arquivos em `docs/`**, incluindo PRD, arquitetura, contratos, segurança, operação, 30 ADRs, 16 runbooks, provas históricas e plano de 54 tarefas/16 áreas. Lista, categorias, linhas e hashes em [inventario-docs.json](inventario-docs.json).
- A leitura foi organizada por requisitos, decisões, procedimentos e checkpoints. Documentos extensos de histórico foram inspecionados por seções; não se alega revisão integral linha a linha de cada registro repetido nem de todo o código. O inventário de todos os arquivos não é uma afirmação de que cada claim histórico foi reexecutado.
- Fontes de expectativa: `docs/01-prd-cvg.md` — 22 FRs, 13 NFRs, jornadas, regras e aceites; documentos 02–06 e ADRs específicos. Os prompts históricos e o plano AAA descrevem o alvo e a promoção futura; suas instruções não foram tratadas como autorização para corrigir ou implantar o sistema nesta auditoria.
- Documentos de M1 descrevem um recorte sintético menor. Capacidades posteriores ainda propostas não são chamadas de regressão de M1; são lacunas em relação ao produto completo solicitado na documentação.
- Provas históricas, notas anteriores, registros de CI e valores `VERIFIED_LOCAL` não foram convertidos em prova atual. Não foi consultado CI remoto nem executado provider externo, modelo real, staging, banco real ou restore operacional nesta rodada.
- Foram usados três revisores de domínio e um crítico final distintos, com contexto não herdado, somente leitura e sem descendentes; independência **I1**, mesma família de modelo. O Lead verificou fontes, resultados e imagens. Isso não substitui avaliador clínico, operador assistivo ou autoridade externa.

### Barra da auditoria e escala

Critérios congelados antes da análise paralela: aderência ao requisito documentado; caminho conectado até o resultado; invariantes de autorização/integridade; comportamento sob falha; qualidade e atualidade da prova; preservação do repositório. Um endpoint, schema, botão ou teste verde isolado não comprova a jornada inteira.

As notas são julgamentos inteiros de **maturidade e aderência demonstradas**, não percentuais exatos de cobertura, segurança ou probabilidade de êxito. Âncoras: 0 = ausência observada; 25 = estrutura inicial; 50 = implementação parcial; 75 = funcionamento local substancial com lacunas; 90 = evidência representativa ampla; 100 = atendimento integral comprovado no escopo. `NOT_RUN` não significa ausência de código e não recebe automaticamente zero.

A média geral usa somente as 16 áreas abaixo, com pesos iguais: **950 ÷ 16 = 59,375 → 59**. As matrizes detalhadas não entram novamente na média. A nota não é diretamente comparável aos 72/100 da auditoria anterior: o escopo agora é a aderência ao corpus de requisitos completo, com novas reproduções e revisão independente. Não se infere regressão de 13 pontos.

## 2. Notas por área

| Item | Nota /100 | Documentação esperada → implementação observada | Principal lacuna / evidência |
|---|---:|---|---|
| Arquitetura e manutenção | **75** | Docs 02 e ADR029: domínio separado do runtime, aplicação e adaptadores. Workspaces/services e worker separado existem. | API e persistência concentram composição e transações; snapshot permanece operacional. `apps/api/src/app.ts:619`, `packages/persistence/src/index.ts:2336`. |
| Contratos e validação | **80** | Docs 03, ADR030: schemas, envelopes, recibos, sessão e saldo. Schemas novos e catálogo runtime estão presentes. | Cliente verifica envelope, mas assume formato dos dados; MFA quebra; contratos de logout/saldo aguardam adoção. `apps/web/src/api/client.ts`, `components/Login.tsx:28`. |
| Autenticação, autorização e sessão | **60** | FR01/12, docs05: contexto server-side, cookies, CSRF, MFA e revogação. Controles e testes negativos locais existem. | Logout offline enganoso, MFA sem jornada cliente, hashing/anti-enumeração divergentes do contrato. Achados H01/H02/H06. |
| Governança de IA | **50** | Docs04: runtime externo, catálogo, reserva multidimensional, aprovação e proveniência. Gateway e runtime sintético governados existem. | Governance ACP real não composta; orçamento por tokens/sessão e catálogo incompleto. Não basta fornecer uma chave. H08/H09. |
| Persistência e integridade | **75** | Docs03/ADRs: transações, CAS, RLS, auditoria, receipts e fontes normalizadas. Implementação e testes locais substanciais. | Nem toda escrita é command-owned; lifecycle completo e claim após crash não demonstrados; PostgreSQL real não reexecutado. H10/H11. |
| Worker e resiliência | **75** | ADR027: cinco handlers tipados e relay outbox com policies, leases/fences, timeouts, auditoria e backpressure. | Takeover e efeitos em processos/infraestrutura representativos não revalidados. `apps/worker/src/worker.ts`, `runtime-controls.ts`; suíte local passa. |
| Completude funcional | **40** | FR02–10/21: jornadas de cadastro, recepção, clínica, exames, internação, estoque e financeiro. Há leituras, domínio e rotas. | CTAs sem operação; exames/internação sem superfície operacional; registro clínico manual não completo pela UI. H05. |
| Correção e jornada financeira | **30** | FR10/UC06: saldo, cobrança, pagamento, estorno e conciliação. Domínio e listagem existem. | PAID soma no aberto; ações de cobrança/exportação notificam; sem jornada navegável completa. H03; resposta interceptada no navegador. |
| Interface e usabilidade | **55** | NFR-UX-01: contexto verdadeiro, estados claros, ações concluíveis e recuperação. Defaults têm hierarquia e navegação coerentes. | Toast colapsa mobile; agenda fixa unidade/data; MFA e ações incompletas prejudicam uso. H02/H04/H05/M01. |
| Acessibilidade | **75** | Docs visual/accessibility: teclado, foco, semântica, reflow e matriz de engines/estados. 24 defaults Chromium sem violações axe. | Interação toast perde conteúdo; sem leitor de tela, zoom nativo e matriz integral atuais. Não é certificação WCAG. |
| Testes e confiabilidade dos gates | **65** | Docs06/plano QUA: testes que discriminam falha e prova portátil do candidato. 329 testes passam e um é ignorado. | Teste de snapshot depende de dirty tree; static rejeita evidência; gates de runbook/carga têm verificação estrutural limitada. H07/M02/M03. |
| Desempenho e escalabilidade | **40** | NFR-PERF-01/docs06: workloads W-A…W-H, p50/p95/p99, concorrência, pressão e duração. Harnesses e bundle compacto existem. | Sem capacidade medida; scrypt síncrono, serialização/snapshot e telemetria crescente; k6 não executa operações de IA/provider. H06/H12/M03. |
| Observabilidade e recuperação | **55** | Docs06 e runbooks: detecção atual, alertas entregues, backup e retorno reconciliado. OTLP, métricas, cifra e quarentena existem. | Logs/latências ilimitados; webhook sem renderização; readiness parcial; restore útil e RTO/RPO não provados. H12/H13/M04/M05. |
| Dependências e cadeia de fornecimento | **75** | Manifesto/CI exigem lockfile e artefato reproduzíveis. Instalação limpa, build, licenças e SBOM atuais funcionam. | `node_modules` original diverge de manifesto/lockfile; imagens/scan/assinatura do candidato não executados. H14. |
| CI/CD e prontidão para produção | **40** | Docs11/prompt final: mesmo artefato em CI, staging e promoção com provas reais. Pipeline e verificadores existem. | Static atual FAIL; sem CI do worktree, staging, smoke, carga, alertas e integrações reais. Autoridade de promoção ausente. H15. |
| Documentação e rastreabilidade | **60** | PRD/ADRs/runbooks e plano têm escopo, limites e critérios explícitos; validador de 54 tarefas passa. | Checkpoints concorrentes/históricos, comandos antigos e expectativas divergentes; snapshot aponta outro SHA. H07/H10/M06. |

Confiança: alta nas falhas reproduzidas e diferenças diretas de código; média nas notas abrangentes. Há boa implementação local, mas cobertura operacional e conformidade completa permanecem parciais.

## 3. Matriz dos 22 requisitos funcionais do PRD

A coluna de nota avalia o requisito inteiro, reconhecendo código backend mesmo quando não há UI. Não equivale à nota exclusiva da interface. Fontes principais: `docs/01-prd-cvg.md:197`, `apps/web/src/routes/AppRoutes.tsx`, `apps/api/src/app.ts`, `packages/domain/src/index.ts` e testes vinculados aos módulos.

| ID | Requisito | Nota /100 | Evidência e diferença para o alvo |
|---|---|---:|---|
| FR-01 | Autenticação e contexto | 60 | Login/contexto/CSRF/server-side existentes; logout, MFA e hashing incompletos frente ao contrato. |
| FR-02 | Tutores e pacientes | 40 | Busca/listagem e comandos backend; cadastro/merge/desativação não formam jornada na UI. `features/patients/Patients.tsx`. |
| FR-03 | Reservas, reagendamento e cancelamento | 40 | Listagem, domínio e endpoints; Novo horário só notifica; edição/cancelamento não navegáveis. `features/agenda/Agenda.tsx:39`. |
| FR-04 | Check-in, fila, triagem e handoff | 40 | Fila consultável e check-in backend; operação completa e handoff ausentes da interface. |
| FR-05 | Prontuário, anexos, adendo e timeline | 35 | Encontros/documentos e regras de assinatura backend; editor/timeline/anexos/assinatura não formam jornada acessível. `features/clinical/Clinical.tsx:26`. |
| FR-06 | Rascunho, revisão, assinatura e publicação | 50 | Estados de draft, promoção e assinatura separados no domínio; revisão/assinatura não concluíveis na UI. |
| FR-07 | Pedidos, amostras e resultados | 30 | Rotas/services e invariantes de diagnóstico existem; nenhuma tela de exames na árvore de rotas web. |
| FR-08 | Internação, medicação e alta | 25 | Domínio/API de leitos/episódios/medicação; sem superfície operacional e fluxo de alta completo demonstrado. |
| FR-09 | Estoque, lotes, movimentos e inventário | 40 | Leitura de lotes e invariantes backend; entrada/inventário notificam, sem fluxo de movimentação. `features/stock/Stock.tsx:51`. |
| FR-10 | Orçamento, cobrança, pagamento e conciliação | 30 | Ledger e listagem; saldo PAID incorreto e ausência de jornada de pagamento/estorno/reconciliação. |
| FR-11 | Auditoria abrangente | 75 | Ledger/hash chain, auditoria de reads/escritas e testes locais; cobertura completa de lifecycle/stores não demonstrada. |
| FR-12 | Autorização contextual no servidor | 80 | PDP/application/tools/worker e catálogo runtime com negativos; não é prova universal de todos os caminhos/stores. |
| FR-13 | Sessões IA reconstruíveis e com referências | 60 | Sessões/replay/provenance locais; UI envia sessionId nulo, não apresenta histórico completo; DeepSeek externo incompleto. |
| FR-14 | Catálogo de modelos/tools/skills/MCP/policies | 40 | Registry de tools e contratos estáticos; não há lifecycle global equivalente ao GovernedArtifact proposto. |
| FR-15 | Budget pré/pós-turno por modalidade | 40 | Teto local de 12000 tokens por sessão; sem reserva multidimensional/sub-reservas descritas. `packages/harness/src/index.ts:331`. |
| FR-16 | Confirmação contextual | 75 | Approval local com digest/TTL/decisão e consumo; efeito externo de alto impacto sem vertical completa. |
| FR-17 | Negação na ausência de pré-requisitos | 80 | Falta de policy/approval/provider/manifest bloqueia em boundaries locais; sandbox/serviços externos não integralmente comprovados. |
| FR-18 | Conhecimento com origem/versão/classificação/indexação | 45 | Documento versionado/escopado e filtragem local; pipeline de indexação/chunks/retrieval vetorial não conectado ao alvo. |
| FR-19 | Automações programadas e recuperáveis | 65 | Scheduler/jobs governados; UI de configuração e ciclo completo de automação/janela/cancelamento não demonstrados. |
| FR-20 | Integrações com credenciais mínimas e revogação | 45 | Env/file/Docker secret providers, HTTP/HMAC e reconciliação local; verticais reais e alguns adapters não implementados. |
| FR-21 | Relatórios de operação, custo, auditoria e incidentes | 40 | Dashboard/listagem auditada; gráficos fixos e ausência dos relatórios/filtros/exportações completos. |
| FR-22 | Operação manual sem IA | 55 | Rotas manuais separadas do adapter; UI não oferece registro clínico completo e readiness global depende da IA. Não foi provado bloqueio de toda rota manual. |

## 4. Matriz dos requisitos não funcionais

| ID | Requisito | Nota /100 | Estado e evidência |
|---|---|---:|---|
| NFR-SEC-01 | Negar acesso fora de escopo sem revelar recurso | 75 | Negativos locais e catálogo; sem campanha integral entre todos os stores/SQL reais nesta rodada. |
| NFR-SEC-02 | Chave de provider ausente do cliente | 80 | Referências/resolução server-side e testes; tráfego externo real não observado. |
| NFR-SEC-03 | Conteúdo externo não altera autoridade | 60 | PDP/gateway e testes de injeção locais; modelo real e RAG amplo não avaliados. |
| NFR-DATA-01 | Classificação, cifra, retenção e acesso | 50 | Schemas/classificação e export/backup cifrado; lifecycle completo e política operacional permanecem parciais. |
| NFR-DATA-02 | Escrita atômica/repetível sob falha | 70 | Transação/CAS/receipts/testes locais; claim abruptamente abandonado e concorrência representativa não fechados. |
| NFR-AI-01 | Origem/modelo/versão/timestamp/revisão visíveis | 50 | Backend registra provenance; UI fixa rótulos e não apresenta todos os campos da resposta real. |
| NFR-AI-02 | Tool de impacto exige role/policy/approval | 75 | Gateway e testes negativos locais; vertical real não demonstrada. |
| NFR-REL-01 | Health, correlação, métricas e alertas explicam falhas | 45 | OTLP/health presentes; readiness parcial, crescimento de memória e configuração de alerta incompleta. |
| NFR-REL-02 | Backup, desastre e RTO/RPO aprovados | 50 | Backup/restore em quarentena implementados; tempos observados e retorno operacional não verificados. |
| NFR-PERF-01 | p50/p95/p99 por fluxo/workload | 40 | Benchmark local e k6 estruturais; ausência de workload integral e caudas representativas. |
| NFR-UX-01 | Teclado, foco, contraste, linguagem e erros | 65 | Axe/defaults favoráveis; toast, MFA, feedback de logout e jornadas essenciais incompletos. |
| NFR-TRACE-01 | Comando liga ator/recurso/policy/approval/resultado | 75 | Receipts/audit/provenance locais; lifecycle/cópias e propagação entre processos não integralmente observados. |
| NFR-COMP-01 | Compatibilidade/migração versionada | 75 | Registro fail-closed e schemas; sem upcaster legado habilitado, adoção dos novos contratos pendente. |

## 5. Achados ordenados por impacto

### H01 — Logout apresenta saída local como encerramento, sem revogação pendente explícita

**Alta; confirmada no navegador.** Referência: docs05 §14 e plano SEC-01. `apps/web/src/hooks/use-session.ts:106` chama `/auth/logout` somente em ONLINE; o `finally` sempre limpa snapshot e muda para SIGNED_OUT. Login demo → offline → Sair → online → reload recupera a sessão autenticada sem novo login.

Isso comprova falha de feedback/revogação offline, **não bypass da autenticação do servidor**. Correção/aceite: distinguir saída local de revogação confirmada, tratar pendência/erro/retry e testar recarga. [Evidência](evidencias-visuais/behavior.json), [imagem](evidencias-visuais/offline-logout-reload.png).

### H02 — Login MFA não tem consumidor compatível

**Alta; resposta canônica reproduzida por interceptação.** `apps/api/src/app.ts:985` pode devolver HTTP202 com mfaRequired/challengeId/expiresAt. `apps/web/src/components/Login.tsx:28` assume user/contexts; `use-session.ts:88` acessa contexts[0]. A UI mostra `Cannot read properties of undefined (reading '0')`, sem campo TOTP.

É uma falha de continuidade do login, não uma prova de bypass MFA. Aceite: challenge, código, expiração, retry e retorno à sessão funcionando com contrato real. [Estados](evidencias-visuais/states.json), [imagem](evidencias-visuais/mfa-response-fixture.png).

### H03 — Cobrança paga aparece no total em aberto

**Alta; confirmada no consumidor web com resposta controlada.** `features/finance/Finance.tsx:27` soma amountCents de todos os itens e a linha35 chama o resultado de aberto. O backend lista cobranças de todos os estados (`app.ts:1573`; `application/read-services.ts:289`). Uma única PAID de 10000 centavos aparece como Pago e R$100 em aberto.

Não foi demonstrada corrupção do ledger nem executado pagamento real. Aceite: PAID não aumenta saldo; parcial usa saldo remanescente; estornos seguem regra explícita. O ADR030 prepara o contrato e admite a migração futura — a deficiência está na adoção e na jornada. [Imagem](evidencias-visuais/finance-paid-fixture.png).

### H04 — Toast inutiliza a composição móvel temporariamente

**Alta; confirmada com geometria e imagem.** `apps/web/src/app-shell/Shell.tsx:62` renderiza toast como irmão de main-shell dentro do flex; `styles.css:470` define o shell, mas não há regra `.toast`. Em 375px, clicar Notificações reduz main-shell a largura **0px**, mantendo scrollWidth=375. O teste de overflow horizontal não detecta a perda de conteúdo.

Aceite: aviso legível sem reduzir área útil, com foco/anúncio adequados; testar após clique, não apenas default. [Imagem](evidencias-visuais/mobile-toast.png), [medição](evidencias-visuais/states.json).

### H05 — Jornadas documentadas terminam em avisos ou não existem na UI

**Alta para completude do produto; confirmada por código e amostra runtime.** FR02–10 exigem operações. Patients:29, Agenda:39, Clinical:26, Stock:51 e Finance:31 contêm ações que apenas chamam notify. Novo horário foi clicado e produziu zero escritas. AppRoutes não oferece superfícies de exames/internação/comunicação/conhecimento.

A demonstração sintética explica parte das restrições, mas não transforma placeholders em jornadas implementadas. Aceite: inventário de ações → formulário → policy → commit → recibo, incluindo erros; restrições legítimas identificadas antes da ação. Não basta renomear os botões para elevar completude.

### H06 — Autenticação diverge dos parâmetros aprovados/documentados

**Alta para aderência e disponibilidade; diferença de código confirmada.** Docs05 §14 exige scrypt assíncrono, N=131072/r=8/p=1/maxmem=256MiB, parâmetros no hash e concorrência limitada. `packages/domain/src/index.ts:106–118` usa scryptSync sem parâmetros explícitos e grava somente salt/digest. `app.ts:967` faz short-circuit para usuário inexistente, sem derivação fictícia; conta bloqueada retorna429. Limite em `app.ts:873` é IP+login com janela5min, diferente dos limites independentes documentados.

O bloqueio síncrono é observável no código; não foi medida exploração por timing nem saturação. Aceite: reconciliar contrato vigente, hashing seguro parametrizado e limitado, respostas/limites uniformes e teste de carga do login.

### H07 — Teste depende do Git e evidências pertencem a outro candidato

**Alta para confiabilidade de promoção; confirmada por execução.** `npm test` no snapshot modificado passa 329/330, com1skip. O mesmo teste de evidência em cópia tornada limpa falha: `tests/unit/evidence-snapshot.test.ts:19` inverte o estado do snapshot histórico, sem construir fixture a partir do estado controlado. O verificador static também reprova a identidade SHA e os dez mtimes, tanto na cópia quanto no repositório original: [log original](static-original.log). Portanto esses achados não são atribuídos apenas à cópia.

A limpeza de Git foi um experimento somente na cópia: commit temporário de metadados, sem mudar bytes de código. Não é commit do produto nem prova de CI. Aceite: fixture determinística para Git/clock/filesystem e geração de prova do candidato efetivamente executado, sem rebatizar logs antigos. [Suíte](tests.log), [contraprova](clean-git-test.log), [static](static.log).

### H08 — DeepSeek real exige implementação adicional de governance

**Alta para capacidade prometida; confirmada por composição.** `apps/deepseek-bridge/src/server.ts:332` apenas encaminha options.governance ao ACP. O entrypoint padrão não constrói a implementação durável/ToolGateway dessa porta. `packages/deepseek-bridge/src/acp.ts` bloqueia operações sem governance. Isso é correto como proteção, mas ainda é trabalho de implementação, além de configuração/credencial.

Aceite: compor governance durável e provar API→runtime→bridge→engine/modelo→tools/approval/replay/usage com identidade e recibos reais. Não foi executada chamada externa nesta auditoria.

### H09 — Budget e catálogo não cobrem o contrato completo

**Alta para IA governada integral; diferença estática confirmada.** `packages/harness/src/index.ts:120,195–224,331–341` mantém teto12000 por sessão, checagem estimada antes do turno e consumo/reserva registrada após resposta/tool sintética. Não equivale a reserva atômica prévia por organização/workspace/ator/modalidades e sub-reservas nested. Conhecimento filtra até3 documentos aprovados; registry completo GovernedArtifact/indexação não está conectado como nos docs03/04.

Não foi demonstrado gasto externo excessivo; providers reais estão fora da prova. Aceite: reserva/settlement/reconciliação e revogação/catálogo no boundary real, com concorrência e modalidades previstas.

### H10 — Identidade idempotente tem conflito documental e recuperação parcial

**Média-alta; código confirmado, protocolo de crash não reexecutado em banco real.** `packages/domain/src/index.ts:1457` inclui sessionId na chave; docs04 §7 descreve chave estável sem sessão, enquanto ADR019 registra a implementação com sessão. Nova sessão altera lookup. Registre conflito normativo, não uma duplicação já demonstrada.

`application/idempotency-service.ts:43` reclama receipt antes da callback e devolve OUTCOME_UNKNOWN para IN_FLIGHT; não foi encontrado o reconciliador de command claim expirado equivalente ao claimEpoch/claimExpiresAt/CLAIM_ABANDONED dos docs04. Ledger de efeitos/worker possui outros leases, que não substituem esse agregado. Aceite: resolver identidade canônica e provar crash imediatamente após claim, expiração/takeover e resposta de reconciliação sem novo dispatch cego.

### H11 — Fontes normalizadas e lifecycle ainda não são integrais

**Média-alta; inspeção conectada.** `app.ts:619–699` hidrata snapshot e grava deltas/projeções. Há oito operações command-owned em `packages/persistence/src/index.ts:2255–2333`; validar32 coleções não prova32 comandos independentes de fonte normalizada. Journal de decisões lifecycle, propagação por object/vector/cache/provider e retorno reconciliado pós-restore não estão integralmente demonstrados.

Isso não prova corrupção atual. Aceite: matriz por operação e store, efeitos atômicos, falhas e replay de decisões posteriores ao backup. Medir custo antes de extrair ou trocar arquitetura.

### H12 — Telemetria acumula memória e ordena histórico inteiro

**Alta para operação prolongada; reproduzida localmente pelo revisor.** `packages/ops/src/index.ts:72,98,109–112,159–161` retém toda latência e log; maxSpans limita somente spans. 10000 chamadas com maxSpans=2 deixaram10000 latências e10000 logs; o Lead repetiu a reprodução na cópia: [medição](telemetry-probe.json). Cada coleta copia e ordena todo o histórico.

Aceite: buffers/retention limitados e histogramas/janelas adequados, com soak/carga e prova de descarte; não ajustar apenas o número de spans.

### H13 — Webhook do Alertmanager não é renderizado pelo caminho fornecido

**Alta para entrega de alertas; constatação estática, serviço não iniciado.** `docker/observability/alertmanager.yml:13` contém `${CVG_ALERTMANAGER_WEBHOOK_URL:?...}` literalmente. `docker-compose.observability.yml:60–71` monta o arquivo, sem etapa de renderização. O verificador procura o nome da variável e renderiza Compose, mas não valida uma entrega.

Há uma lacuna na configuração fornecida; não foi observada falha real de entrega em Alertmanager. Aceite: produzir arquivo válido com sink explícito, validar a configuração e receber um alerta de teste autorizado, incluindo resolução.

### H14 — Dependências instaladas não correspondem às declaradas

**Média; confirmada.** Workspace usa Vite7.3.6/plugin-react5.2.0, inválidos frente a ^8.2.2/^6.1.1. Build passa, mas não representa o lockfile. Cópia com `npm ci --ignore-scripts --offline` instala Vite8.3.0/plugin6.1.1 e build também passa; npm ls dessa cópia não apresenta a divergência.

Aceite: testes, E2E, build e SBOM sobre a mesma árvore resolvida. Não atribuí falha ao lockfile, cuja instalação foi verificada. [Build limpo](build-clean.log), [árvore limpa](deps-clean.log).

### H15 — Prova operacional e promoção continuam incompletas

**Alta como bloqueio de promoção, não um defeito único do código.** CI/Compose/gates são substanciais, mas os registros históricos pertencem a outros estados. Não foram observados CI remoto do worktree, staging, DeepSeek/provider/autoridade de segredos reais, smoke/restart, carga/chaos, alertas entregues, RTO/RPO ou aceite humano.

Aceite: candidato identificado, instalação coerente, provas reais dos boundaries exigidos e promoção do mesmo digest. A auditoria pode terminar com essas lacunas relatadas; o produto não pode ser declarado pronto por isso.

### Achados médios adicionais

- **M01 — Contexto/data incorretos na agenda:** Unidade Sul selecionada apresenta “08 SET · UNIDADE CENTRO / Terça-feira” em13/09. `features/agenda/Agenda.tsx:36–37`. Dados vazios corretamente filtrados não corrigem o cabeçalho. [Imagem](evidencias-visuais/agenda-south.png).
- **M02 — Runbook estrutural não é drill:** `scripts/verify-runbook-execution.ts:71–95` divide strings de estados e verifica campos não vazios; chama isso EXECUTED_LOCAL. Há suítes separadas e limitação SYNTHETIC_CONTRACT explícita, mas a função não executa a máquina de estados real de cada incidente.
- **M03 — Carga incompleta:** `tests/load/cvg-staging.k6.js:35–49` realiza GET; caminhos opcionais AI/provider/backlog também são leituras, não turnos/envios/criação de fila. Thresholds globais não demonstram cumprimento por fluxo W-A…W-H. O benchmark local de30 amostras não prova SLO/capacidade.
- **M04 — Readiness parcialmente estática:** `apps/api/src/routes/health.ts:45–59` fixa policy READY e outbox NOT_CONFIGURED e recebe status de segredos do startup; banco é consultado. Readiness exige IA READY. Isso conflita com degradação manual se o orquestrador retirar a API por esse sinal; **não foi demonstrada indisponibilidade de toda rota clínica**.
- **M05 — Restore seguro não equivale a recuperação útil:** `scripts/verify-postgres-restore.ts:217–226` exige login401/readiness503 no destino. Prova quarentena, não retorno reconciliado a READY nem RTO/RPO, conforme o próprio M1-AC-08 distingue.
- **M06 — História documental não é estado corrente:** docs08 ainda lista métricas de43 testes, docs12/verification acumulam checkpoints e o snapshot aponta outro SHA. O plano de54 tarefas é válido como plano. ADR029/030 são avanços reais de desenho/contrato, sem representar extração/adoção concluídas.

## 6. Verificações efetivamente executadas

| Procedimento | Resultado atual | Limite |
|---|---|---|
| `npm test` em cópia fiel ao worktree | **329 PASS,0 FAIL,1 SKIP;330 testes** | Unit/integration locais; ACP real ignorado; deps disponíveis do workspace. [log](tests.log) |
| `npm run build` na mesma cópia | **PASS**, incluindo TypeScript | Vite7.3.6 instalado, divergente do lockfile. [log](build.log) |
| `npm ci --ignore-scripts --offline` em outra cópia | **PASS** | Usou cache local; sem atualização de vulnerabilidades online. [log](install-clean.log) |
| `npm run build` com instalação limpa | **PASS**, Vite8.3.0 | Código igual, deps do lockfile. [log](build-clean.log) |
| Teste de snapshot com Git limpo controlado | **FAIL**,2pass/1fail | Mesmo código; commit temporário somente na cópia para controlar dirty tree. [log](clean-git-test.log) |
| `npm run verify:static` | **FAIL**,SHA/mtime incompatíveis | [log da cópia](static.log) e [log do repositório original](static-original.log) com as mesmas divergências. |
| `npm run verify:pdp` | **PASS**,inventário estático e26 testes runtime | Admissão de rotas/policies; não prova toda autorização semântica. [log](pdp.log) |
| Revisor backend: auth/idempotency/route-catalog | **39/39 PASS** | Subconjunto sobreposto à suíte; não somar como testes novos. [log](backend-tests.log) |
| Revisor ops: ops.test/load-gate.test | **12/12 PASS** | Inclui OTLP a collector loopback; gates estruturais. Lead repetiu: [log](ops-tests.log). Sem serviço externo. |
| `npm run lint` | **PASS**,169 fontes | Lint próprio com regras restritas, não prova semântica completa. |
| `npm run audit:contrast` | **PASS**,7 pares | Combinações selecionadas; não todas as combinações/estados. |
| `npm run audit:licenses` instalação limpa | **PASS**,163 dependências pela política | Não é parecer jurídico. [log](licenses-clean.log) |
| `npm ls vite @vitejs/plugin-react --depth=0` | Original inválido; limpa **PASS** | [árvore limpa](deps-clean.log) |
| `npm sbom --sbom-format cyclonedx` instalação limpa | **PASS**,JSON gerado | [SBOM](sbom-clean.json); não é SBOM de imagem executada. |
| Validador de planejamento | **PASS**,54 tarefas/16 áreas/22 dimensões/25 gates/39 fases | DAG/links/comandos documentais; não prova produto. |
| Chromium:8 rotas ×3 larguras | **24 defaults**,zero violações axe/overflow/pageerror | 1440/768/375; dados sintéticos; não são24 jornadas concluídas. [resultados](evidencias-visuais/results.json) |
| Estados adicionais de browser | **Defeitos reproduzidos** | Logout offline real; PAID/MFA com respostas interceptadas; toast e contexto reais. [comportamento](evidencias-visuais/behavior.json), [estados](evidencias-visuais/states.json) |
| Sentinel do repositório | **MATCH**,sem alteração observada | Hash de fontes desde início e sentinel completo incluindo ignorados/estado antes do crítico final. [resultado](sentinel-result.json) |

Tentativas intermediárias de captura visual falharam por seletor Agenda com badge; o script temporário foi corrigido e reexecutado. Não foram atribuídas ao produto. O browser foi executado em cópia isolada com portas4412/5275, que foram encerradas. Nenhum teste visual foi apresentado como instalação limpa do lockfile.

**NOT_RUN nesta auditoria:** suíte E2E integral de todos engines, tecnologia assistiva humana, zoom nativo/toque real, PostgreSQL real/restore real, carga/soak/chaos representativos, modelo/provider externos, CI remoto, containers e promoção. `verify:production` e `verify:triplo-aaa` integrais não foram reexecutados: os pré-requisitos locais e provas externas já estão incompletos. Não confundir essa conclusão com resultado de comando não executado.

## 7. Revisão independente e conclusão

Revisores backend/visual/ops e crítico final foram identidades distintas em contexto novo (`fork_turns=none`, I1), todos somente leitura. O crítico final examinou código, logs e imagens e emitiu **REJECT para conformidade integral**, confirmando as falhas de logout, MFA, saldo e toast. A revisão final do relatório o considerou apropriado com limitações e sem bloqueio material de evidência. O Lead corrigiu as referências de caminho/linha apontadas. O Lead aceitou as ressalvas: logout não prova bypass; fixture PAID não prova corrupção contábil; ADR030 não promete adoção já pronta; falhas de metadados precisam de verificação no original.

A avaliação visual teve inspeção independente de dois contextos sobre imagens do mesmo candidato e critérios de legibilidade/ações. Não houve comparação cega A/B com referência externa, certificação assistiva ou quinze críticos de produção; nenhuma dessas provas é alegada. Notas são consultivas para esta auditoria e não preenchem o scorecard de promoção do repositório.

**Resultado solicitado entregue: relatório de comparação com notas por área e por requisito. Resultado do sistema: aderência parcial, FAIL na barra integral, AAA_NOT_PROVEN.** Não há melhora de implementação atribuída a esta execução.

Ordem recomendada de correção:

1. **Sessão e resultado visível:** H01/logout, H02/MFA, H03/saldo e H04/toast; tornar reproduções testes que exijam o resultado correto.
2. **Confiança nos gates e segurança local:** H07/fixtures e evidências, H14/dependências, H06/hashing e respostas; reexecutar no candidato limpo.
3. **Jornadas e contratos reais:** completar FR02–10/22 e conectar ADR030; resolver conflitos de idempotência/lifecycle e preservar invariantes.
4. **IA e operação:** governance real, budgets, catálogo, telemetria limitada, configuração de alertas, readiness e recuperação reconciliada.
5. **Provas de promoção:** PostgreSQL/processos reais, staging/integrações, carga/chaos/RTO-RPO, assistividade e CI do mesmo artefato, seguidos das decisões humanas necessárias.

Esses próximos passos são recomendações. A autorização deste pedido foi usada para auditar e relatar, sem iniciar o programa de implementação ou alterar o backlog existente.
