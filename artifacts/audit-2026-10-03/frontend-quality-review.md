# Auditoria frontend, jornadas e testes — 2026-10-03

**Estado: relatório final desta trilha.** Repositório: `/home/ricardo/Área de trabalho/cvg-corp`. HEAD inspecionado: `9aab406b164497978b05dd3aa431db49ad11677a`. Escopo: interface alcançável, jornadas centrais, integração com API e qualidade da evidência automatizada. As referências `arquivo:linha` abaixo são relativas à raiz do repositório e a esse candidato.

O frontend apresenta jornadas locais executáveis, validação de contratos e tratamento explícito de diversas falhas. A matriz de navegador atual está aprovada, com ressalvas de cobertura. Permanecem defeitos de recuperação do estoque, preenchimento financeiro e comunicação de erro, além de fragilidades do harness de mutação e do isolamento de resultados. Há também uma corrida de logout identificada estaticamente, ainda sem reprodução dirigida. Este parecer não constitui aprovação de produção nem substitui as revisões centrais de segurança, persistência e operação.

## 1. Notas e critério

As notas são julgamento técnico sobre o escopo inspecionado, não percentuais de requisitos entregues ou probabilidades de segurança. Âncoras: **90–100**, robusto e comprovado; **70–89**, base sólida com lacunas; **50–69**, risco material; **abaixo de 50**, bloqueio relevante. Não foi calculada uma nota global para todo o sistema.

| Área | Nota / 100 | Fundamentação e principal limite |
| --- | ---: | --- |
| Prontidão funcional | **74** | Cadastro, agenda, prontuário, exames, estoque e financeiro têm chamadas reais e fluxos exercitados na API sintética. Recuperação de entrada parcial, corrida de sessão e capacidades deliberadamente bloqueadas impedem classificação robusta. Ver FQ-01, FQ-06 e seção 4. |
| Experiência de uso | **73** | Estados vazios/erro/carregamento, recibos, foco e confirmação de ações estão presentes. Valor inicial incorreto no pagamento parcial, recuperação incompleta do estoque e mensagem indevida do boundary prejudicam confiança e continuidade. Ver FQ-01 a FQ-03. |
| Acessibilidade | **76** | Axe em rotas principais, foco, teclado, drawer com isolamento de fundo, contraste e stress automatizado têm evidência. Estados internos dos diálogos, zoom nativo e leitor de tela manual não têm comprovação abrangente. Ver seção 5. |
| Qualidade dos testes | **77** | Evidência multiengine atual, cenários negativos, cobertura com ratchet e mutações reais seletivas. Pesam a classificação permissiva de kills, outputs compartilhados, oito skips da jornada hospitalar e ausência de cobertura medida dos componentes React. Ver FQ-04, FQ-05 e seção 5. |
| Manutenibilidade frontend | **72** | Rotas lazy, cliente central, registro de contratos e estado de runtime separado. Persistem diálogos duplicados e variação no controle de requisições, cancelamento e submissão entre features; os defeitos encontrados mostram consequências dessa assimetria. |

## 2. Evidência de execução vigente

Os artefatos abaixo foram lidos; nenhuma execução de testes, build, browser, servidor ou DB foi iniciada nesta retomada. Links são relativos ao diretório deste relatório.

| Evidência | Resultado conferido | Fonte |
| --- | --- | --- |
| E2E completo | **540 casos: 503 PASS, 37 SKIP, 0 FAIL; exit 0**. Capturado em `2026-10-03T05:37:11.692Z`. Chromium, Firefox, WebKit e projetos stress presentes. | [browser-e2e.json](generated/artifacts/aud26/production-gates/browser-e2e.json) |
| Reprodução isolada do timeout anterior | **3/3 PASS**, `unexpected=0`, `skipped=0`, `flaky=0`; sem retries. `app.spec.ts:33`, chromium-wide-1440. Início `2026-10-03T05:46:06.916Z`. | [e2e-isolated.json](e2e-isolated.json) |
| Unit/integration | **765 casos: 763 PASS, 1 FAIL, 1 SKIP; exit 1**. O erro é `COMPOSITE_EXIT_DIVERGENT`, na expectativa de baseline válido de `tests/unit/control-plane-aud23.test.ts:141`. | [unit-integration-tests.json](generated/artifacts/aud26/production-gates/unit-integration-tests.json) |
| Cobertura | Linhas **88,45%**, branches **76,69%**, funções **88,20%**; ratchet numérico PASS, execução exit 1. | [coverage-summary.json](generated/artifacts/coverage-summary.json), [coverage-output.txt](generated/artifacts/coverage-output.txt) |
| Mutação | **30 KILLED, 0 SURVIVED, 0 INVALID**, política PASS, sourceSha igual ao HEAD. Todos os resultados registram exit 1 e signal null. Alcance seletivo e ressalva do classificador em FQ-04. | [mutation-summary.json](generated/artifacts/mutation-summary.json) |
| Build, lint, contraste, tokens | Exit 0 nos quatro artefatos atuais. | [build](generated/artifacts/aud26/production-gates/web-build.json), [lint](generated/artifacts/aud26/production-gates/repository-lint.json), [contraste](generated/artifacts/aud26/production-gates/contrast-audit.json), [tokens](generated/artifacts/aud26/production-gates/design-token-audit.json) |

SHA-256 do E2E completo: `9b850fdf03ad8334d883405e305287b552cb22b90d34d011561804026cdb7d66`. SHA-256 da reprodução isolada: `e256c67bd60a214e7a938e8a8cae3668a777bbb716304d44982804f2136589e4`.

A matriz selecionada anterior, de 180 casos, teve um timeout no título inicial de login. O lead relatou concorrência entre runners e perda de screenshot/error-context por compartilhamento de outputs. A matriz completa posterior e a reprodução isolada prevalecem: **o timeout não é classificado como defeito confirmado do produto**. Três repetições aprovadas também não demonstram ausência universal de flakiness.

O gate completo de produção terminou exit 1, segundo a consolidação do lead, por unit/control-plane, dependências e whitespace produzido pela cobertura da própria auditoria. O componente unit foi conferido diretamente acima. Dependências permanecem na trilha responsável; o whitespace gerado não é imputado a código preexistente. O resultado de navegador aprovado não transforma o gate composto em PASS.

## 3. Achados com evidência e cenário de reprodução

**Classificação:** P1 indica prioridade alta pelo impacto potencial; P2 indica defeito localizado de operação, confiança ou verificação. Confiança na leitura estática é separada de confirmação em execução. Os cenários abaixo são procedimentos derivados do código, **não novas reproduções executadas nesta trilha**.

### FQ-01 — Produto criado antes de um lote recusado pode ficar inacessível à recuperação pela interface

**P2; defeito funcional confirmado no encadeamento estático; confiança alta.** `apps/web/src/features/stock/Stock.tsx:166` cria o produto e depois o lote em duas requisições. O ID do produto fica em variável local (`:178`); a lista de produtos selecionáveis deriva somente de itens com lote (`:124`). Fechar o diálogo elimina a chave da tentativa (`:147`). As duas operações são comandos separados em `apps/api/src/app.ts:1719` e `:1736`.

**Cenário:** entrar como admin/estoque, cadastrar um SKU novo com demais dados válidos e validade passada. A data do formulário é apenas obrigatória (`Stock.tsx:267`). O produto é gravado antes da recusa do lote: `packages/domain/src/index.ts:1741` e `:1752`. Fechar ou recarregar e tentar a entrada novamente. O produto sem lote não aparece em “Produto existente”, porque a consulta lista lotes (`packages/domain/src/index.ts:1606`). Recriá-lo com o mesmo SKU recebe conflito (`:1739`).

**Impacto:** a interface não oferece recuperação direta para esse SKU já criado, embora o erro final aparente uma entrada simplesmente não concluída. Isso não demonstra saldo incorreto nem falta de atomicidade dentro de cada endpoint. Uma repetição no mesmo diálogo pode reutilizar o receipt do produto; o problema descrito inclui fechar/recarregar e perder esse estado. O E2E em `tests/e2e/app.spec.ts:1445` cobre entrada válida, saída, falta de saldo, devolução e inventário, mas não a falha entre produto e lote.

### FQ-02 — Pagamento parcial abre com o valor total, apesar de mostrar saldo menor

**P2; defeito de preenchimento confirmado estaticamente; confiança alta.** `apps/web/src/features/finance/Finance.tsx:118` inicializa o valor pelo total da cobrança. A ação continua disponível para `PARTIALLY_PAID` (`:231`), enquanto o texto do diálogo calcula corretamente o saldo descontando pagamentos liquidados (`:256`).

**Cenário:** criar cobrança de R$ 100,00, liquidar R$ 40,00 e reabrir “Pagamento”. O saldo apresentado é R$ 60,00, mas o campo inicia em 100. Enviar sem alterar o valor leva à recusa por excesso, sustentada por `packages/domain/src/index.ts:1815`.

**Impacto:** preenchimento contraditório e erro evitável no caixa. A proteção de backend limita o impacto; não foi demonstrada cobrança excedente aceita. `tests/e2e/app.spec.ts:1527` e `:1535` sobrescrevem o campo com 70 e 60, respectivamente, sem verificar o valor inicialmente sugerido.

### FQ-03 — Boundary de renderização afirma ausência de alterações sem conhecer o resultado das operações

**P2; defeito de comunicação confirmado estaticamente; confiança alta.** `apps/web/src/app-shell/ErrorBoundary.tsx:53` declara “Nenhum dado foi alterado” para qualquer erro capturado. `componentDidCatch` (`:28`) registra telemetria redigida, mas não consulta transações, receipts ou operações em voo.

**Cenário de validação:** provocar erro de renderização após uma escrita aceita ou durante uma operação cujo retorno se perdeu. O fallback é o mesmo e faz a mesma afirmação, independentemente do resultado da escrita.

**Impacto:** o operador pode interpretar uma operação concluída ou indeterminada como não realizada. Não foram observadas duplicação ou perda de dados. O teste atual injeta erro na abertura da aplicação e exige essa frase (`tests/e2e/root-boundary.spec.ts:24` e `:29`); não exercita erro após commit. A recuperação por teclado e a redação da telemetria continuam sendo pontos positivos, independentes dessa mensagem.

### FQ-04 — Harness de mutação contabiliza falhas de execução como mutantes eliminados

**P2; defeito do classificador confirmado estaticamente; confiança alta.** `scripts/verify-mutation.ts:326` executa testes no sandbox. Em `:337`, qualquer resultado diferente de exit 0 é `KILLED`, incluindo timeout, sinal, erro de carregamento ou de inicialização. `INVALID` só é produzido quando a âncora de substituição não é única (`:318`). `:357` percorre os mutantes sem executar primeiro uma baseline sem mutação dos mesmos testes naquele sandbox.

**Cenário de validação:** um teste selecionado não consegue importar uma dependência, o processo termina por sinal ou excede o timeout. A condição atual atribui KILLED mesmo sem uma assertion que detecte o comportamento alterado. `tests/unit/mutation-verifier.test.ts:13`, `:19` e `:28` verificam âncora, contagem e presença de trilhas; não verificam essa distinção do subprocesso.

**Impacto:** o harness pode superestimar a força dos testes. A execução observada continua registrada como 30/30 PASS, todos exit 1 e signal null; não há demonstração de timeout contaminando essa rodada. Não se presume que os 30 kills sejam falsos. A interpretação correta é um resultado seletivo com limitação do instrumento, e não um score de mutação de todo o frontend ou repositório.

### FQ-05 — Isolamento de portas não isola os artefatos e o cache de execuções concorrentes

**P2; deficiência de configuração confirmada, colisão comunicada pelo lead; confiança alta sobre isolamento, causa do timeout não estabelecida.** `playwright.config.ts:40` aloca portas distintas, mas `:83` fixa o relatório HTML em `artifacts/playwright-report`; não há `outputDir` por execução. `apps/web/vite.config.ts:37` também não atribui cache específico ao runner.

**Cenário já relatado pelo lead:** duas invocações com servidores efêmeros separados usam a mesma árvore de trabalho e compartilham `test-results`/cache. A limpeza do outro runner remove screenshot/error-context necessários à investigação. Esse relato é consistente com a configuração, sem provar que a colisão causou o timeout do login.

**Impacto:** perda ou mistura de evidência e dificuldade de reproduzir falhas; não é prova de defeito visual ou de ausência de WebKit. A reprodução isolada com saída própria está preservada e aprovada. A intenção de isolamento completo já constava nos planos históricos QUA/multiagentes, conforme os resumos das leituras documentais registradas.

### FQ-06 — Revalidação em voo pode reinstalar a sessão depois de “Sair”

**P1 pelo impacto potencial; risco estático prioritário, sem reprodução dirigida; confiança alta na lacuna de invalidação e média na manifestação temporal.** `apps/web/src/hooks/use-session.ts:44` numera validações e `:55` descarta as antigas. `signIn` (`:106`) e `reset` (`:120`) avançam esse contador; `signOut` (`:134`) não o faz. Durante `REVALIDATING`, `canAttempt` é falso (`:136`) e o logout local retorna sem revogar no servidor (`:140`).

**Cenário derivado:** iniciar troca de contexto, reter a resposta válida de `/contexts`, clicar “Sair” e então liberar a resposta da validação antiga. O botão continua alcançável no Sidebar (`apps/web/src/app-shell/ShellPrimitives.tsx:51`; apenas o conteúdo principal é bloqueado em `Shell.tsx:57`). A resposta ainda passa pelo contador, restaura usuário/contexto (`use-session.ts:60`) e despacha `SESSION_VALIDATED`; esse evento põe o runtime em ONLINE (`apps/web/src/state/runtime-state.ts:54`). `App.tsx:104` decide entre login e shell pela presença do usuário, sem consultar o registro de revogação nesse caminho.

**Impacto potencial:** reaparecimento da sessão local após intenção explícita de saída, mesmo com revogação pendente registrada. Isso não é apresentado como acesso entre tenants, exploração comprovada ou falha reproduzida no navegador. Os testes de logout localizados em `tests/e2e/app.spec.ts:352`, `:366` e `:389` cobrem outros estados; não há evidência apresentada de cobertura dessa intercalação específica.

## 4. Jornadas e correspondência funcional

O confronto usa as intenções de jornadas dos planos/rastreabilidades já lidos e a implementação atual. Documentos históricos descrevem metas e decisões; não são comprovação de entrega. Esta tabela não declara conformidade integral, requisito a requisito, com todo o PRD canônico: a consolidação documental final pertence ao lead.

| Jornada | Maturidade / 100 | Implementação e prova local | Lacuna que limita a conclusão |
| --- | ---: | --- | --- |
| Recepção, cadastro e agenda | **80** | `Patients.tsx:66` cancela buscas antigas; `:161`, `:212`, `:234` ligam cadastro, desativação e merge à API. `Agenda.tsx:179`, `:250`, `:263`, `:279` ligam reserva, check-in, triagem e handoff. O E2E `app.spec.ts:833` atravessa cadastro, reserva, remarcação, fila e conflito de horário. | Recuperação de sessão tem FQ-06. Dados e relógio dos testes são sintéticos; não houve validação com recepcionista em operação real. |
| Prontuário clínico manual | **78** | `Clinical.tsx:166`, `:182`, `:198`, `:214`, `:230`: rascunho, edição versionada, revisão, assinatura e adendo. E2E `app.spec.ts:1163` exercita esses estados; `:1244` verifica restrição de assinatura do administrador. | Anexos estão explicitamente bloqueados em `Clinical.tsx:321` por D-03. O teste usa fixture e primeiro atendimento disponível (`app.spec.ts:1188`), não comprova toda associação paciente/episódio em cenário representativo. |
| Exames | **76** | `Exams.tsx:142`, `:158`, `:174`, `:190`: pedido, amostra, resultado e revisão; `app.spec.ts:1289` verifica resultado válido, negativa de duplicata e estado revisado. | Prova de registro local; não certifica comunicação com equipamento/laboratório externo, anexos binários ou entrega clínica real. |
| Internação | **72** | `Internacao.tsx:178`, `:193`, `:210`, `:226`, `:242`: admissão, prescrição, dispensação, administração e alta têm API. `app.spec.ts:1357` cobre admissão, administração duplicada recusada e alta condicionada a documento assinado. | A jornada completa é executada somente em chromium-wide-1440 (`:1358`), com oito skips; a função de dispensação não é atravessada por esse teste. Não comprova turno clínico real nem todas as regras assistenciais. |
| Estoque/farmácia | **64** | `Stock.tsx:166`, `:190`, `:206`; E2E `app.spec.ts:1445` prova entrada válida, saldo insuficiente recusado, devolução e ajuste. | FQ-01 interrompe recuperação de cadastro sem lote; cenário intermediário não está no E2E. Estoque durável pós-reinício não é comprovado pela matriz em memória. |
| Financeiro | **67** | `Finance.tsx:145`, `:162`, `:180`; E2E `app.spec.ts:1502` cobre cobrança, pagamentos parciais, excesso recusado, estorno e ledger local. | FQ-02; D-01 mantém semântica de saldo após estorno pendente. Integração de cobrança externa e conciliação real não são comprovadas por selecionar PIX/cartão no formulário. |

Nessa tabela, `Patients.tsx`, `Agenda.tsx`, `Clinical.tsx`, `Exams.tsx`, `Internacao.tsx`, `Stock.tsx` e `Finance.tsx` correspondem às respectivas pastas em `apps/web/src/features/`; `app.spec.ts` corresponde a `tests/e2e/app.spec.ts`.

Comunicações recebeu inspeção complementar, sem nota de completude: preparar e decidir chamam a API (`apps/web/src/features/communications/Communications.tsx:110` e `:125`). O E2E `tests/e2e/app.spec.ts:1642` comprova recusa e falha fechada da aprovação sem outbox durável. Ele não comprova entrega de WhatsApp/e-mail. Conhecimento, relatórios, copiloto e administração tiveram alcance de rotas/contratos e referências de testes, sem auditoria funcional aprofundada nesta conclusão.

## 5. Qualidade da interface e da prova

### Estados, API e pontos fortes

O cliente central valida envelope e payload antes de entregar dados à interface (`apps/web/src/api/client.ts:75`, `:132`). O registro falha fechado para endpoints não cadastrados (`apps/web/src/api/validation.ts:570`); a exceção explícita é `GET /ready` (`:31`). Headers de contexto e CSRF são centralizados (`client.ts:103`). Escritas dependem de runtime ONLINE (`:99`; `apps/web/src/state/runtime-state.ts:83`). Isso reduz caminhos improvisados entre tela e API; não substitui autorização no servidor.

`Patients.tsx:66` associa cancelamento e identidade da requisição à busca; `Clinical.tsx:82` e `Exams.tsx:81` descartam resultados antigos por sequência. A aplicação elimina o composer na perda de autorização/contexto e em logout (`apps/web/src/app-shell/App.tsx:65`, `:79`, `:107`). Esses controles coexistem com a lacuna específica FQ-06; não justificam classificá-la como já resolvida.

Há estados explícitos de carregamento, erro, vazio, revalidação e indisponibilidade. `apps/web/src/components/ui.tsx:8` fornece status/alerta; `apps/web/src/app-shell/Shell.tsx:57` oculta dados contextuais fora de ONLINE. O modo chamado OFFLINE_READ_ONLY não demonstra cache clínico autorizado ou edição/sincronização offline: o comportamento inspecionado apresenta bloqueio/revalidação, com evidência de proteção do composer. Os diálogos preservam formulário após falhas locais em vários fluxos, mas não há prova de recuperação universal após refresh ou perda de contexto.

As rotas usam lazy/Suspense (`apps/web/src/routes/AppRoutes.tsx`), e a navegação move foco ao conteúdo (`Shell.tsx:47`). O build possui budgets bloqueantes de JS de entrada, JS total e CSS (`apps/web/vite.config.ts:4`, `:27`). Esses budgets aprovados não são medição de responsividade, Core Web Vitals ou desempenho em hardware hospitalar. O E2E usa servidor de desenvolvimento (`playwright.config.ts:101`), enquanto o build é validado separadamente; não foi demonstrado aqui um browser smoke sobre o pacote final de produção.

### Acessibilidade: prova presente e prova ausente

`tests/e2e/accessibility.spec.ts:68` executa axe em login e rotas principais, com amostras de contraste renderizado no dashboard (`:79`). `:113` verifica isolamento e retorno do foco do drawer; `:131` verifica associação dos erros aos campos de login. O hook móvel aplica `inert`, `aria-hidden`, Escape e contenção de foco (`apps/web/src/hooks/use-mobile-menu.ts:32`, `:43`, `:51`). O boundary também tem teste de foco, teclado e conteúdo redigido (`tests/e2e/root-boundary.spec.ts:14`).

Os scans de rota não abrem todos os diálogos de criação, revisão, erro e submissão. Existem implementações separadas de Dialog em `Clinical.tsx:30`, `Finance.tsx:38` e `Stock.tsx:47`, além do componente comum `components/ui.tsx:13`; isso amplia a superfície que exige verificação e favorece comportamentos divergentes. Não foi inferida falha de tecnologia assistiva apenas por essa duplicação.

O stress verifica DPR, preferência por movimento reduzido e CSS zoom 2 (`tests/e2e/accessibility-stress.spec.ts:14`, `:49`). **Leitor de tela manual: NÃO EXECUTADO. Zoom nativo/tecnologia assistiva real: não comprovados por essa automação.** Axe sem violações, viewport estreito, DPR e CSS zoom não equivalem a aprovação integral de acessibilidade.

### Cobertura, assertions, mutação e skips

A saída de cobertura mede cinco módulos frontend: cliente, correlation, validação, assistant-state e runtime-state. Não apresenta cobertura dos componentes TSX nem do hook useSession. O cliente tem **85,06% de linhas e 34,69% de branches**; runtime-state tem **100% de linhas e 94,74% de branches**. Portanto **88,45% não é a cobertura do frontend completo**. O harness coleta unit/integration Node (`scripts/verify-coverage.ts:247`), sem inventário que imponha inclusão de cada fonte não importada. Sua política crítica é de auth/policy, contratos, persistência e domínio (`:59`).

O campo statements é explicitamente equivalente a linhas (`scripts/verify-coverage.ts:7`, `:125`), e o known-bad de cobertura é um fixture numérico (`:231`, `:271`), não execução de mutação. O script mantém a falha de testes no gate (`:288`), mesmo quando o ratchet passa. A mutação real está no harness separado: tem âncoras únicas, cópia temporária e restauração do alvo (`scripts/verify-mutation.ts:287`, `:343`, `:352`), mas é um plano manual seletivo sem mutantes de componentes/hooks React e com FQ-04.

Os E2Es centrais verificam recibos e estados posteriores, não apenas títulos. Há negativas úteis de excesso financeiro, saldo insuficiente, duplicata diagnóstica, administração repetida e assinatura restrita. Entretanto, a preparação clínica aceita “handoff concluído OU alerta” e depois abre o primeiro atendimento (`tests/e2e/app.spec.ts:1182`, `:1188`); isso reduz a prova de encadeamento daquele paciente específico. Vários cenários de falha/MFA usam respostas interceptadas, adequadas para exercitar estados de interface, mas insuficientes para afirmar integração externa ou autenticação real ponta a ponta.

Os **37 skips foram conferidos no log completo**: 6 do contexto móvel, 12 de busca/foco específicos do viewport amplo, 8 da internação, 9 de isolamento do drawer e 2 de capacidade touch. Os skips de drawer são condicionados ao nome `mobile-375` (`accessibility.spec.ts:114`), deixando tablet-768 e stress-320 sem essa assertion específica, embora o breakpoint móvel seja 860px (`use-mobile-menu.ts:17`). Os dois skips de touch não significam ausência dos engines. Os 503 PASS representam casos/projetos repetidos; não 503 jornadas distintas.

`playwright.config.ts:93` usa um store em memória por execução, `workers: 1` e demo sintética (`:100`); contextos de browser não reutilizam cookies. Isso prova integração local da aplicação em condições controladas. Não prova durabilidade PostgreSQL após reinício, isolamento de todas as fixtures, operação simultânea de equipes, integrações externas ou comportamento clínico representativo. Retries são zero localmente e um por padrão em CI (`:31`); a configuração não exige explicitamente reprovação por flaky. O resultado isolado fornecido, especificamente, teve zero retries e zero flaky.

## 6. Escopo de leitura e proveniência documental

Leitura integral de implementação nesta retomada: cliente API e helper de sessão; hooks de sessão/runtime/menu móvel; estados runtime/sign-out; App, Shell, ErrorBoundary; UI comum; Patients, Agenda, Clinical, Finance e Stock; Vite e Playwright; harnesses coverage/mutation; teste unitário do verificador de mutação; E2Es accessibility, accessibility-stress, root-boundary e routed-journeys. A leitura integral anterior de AppRoutes/telemetria/correlation consta no handoff e não foi convertida em execução de browser.

Inspeção focal, sem alegar leitura integral: `api/validation.ts` (linhas 1–36 e 430–585), Sidebar (43–53), Exams (79–205), Internacao (178–287), Communications (110–145), trechos de `app.spec.ts` (833–949, 1163–1548 e 1642–1697, além de localização de casos), e os handlers/domínio estritamente necessários para conferir estoque e pagamento. Outros arquivos de produto e testes não são declarados auditados integralmente. Os artefatos grandes de execução foram consultados por metadados, resumos e trechos relevantes, sem alegação de releitura integral de todos os seus logs.

A redistribuição final transferiu ao lead a leitura restante e a atualização FINAL de [frontend-quality-read-ledger.json](frontend-quality-read-ledger.json). **Nesta retomada o ledger foi apenas consultado, não escrito, e os 56 documentos concluídos não foram relidos.** O checkpoint observado é 56/58 arquivos, 677.123/745.227 bytes confirmados, 68.104 bytes pendentes. Esses números descrevem o ACK observado, não substituem a consolidação posterior do lead.

| Documento transferido | Leitura realizada antes da redistribuição, sem ACK no ledger |
| --- | --- |
| `docs/rodada-aaa3-2026-09-13/backlog.json` | **Integral**, linhas 1–485 e 486–985, conforme histórico de retomada. |
| `docs/verification-vNext.md` | **Parcial**, linhas 114–240. Linhas 1–113 sem leitura confirmada por esta trilha. |

SHA-256 do ledger observado na retomada e novamente antes da gravação final: `d236052d6d2f32accbab667e5ef84a559af414eec121a9254f78c5ebc7efcaa9`. O encerramento deste relatório não registra os dois documentos como integralmente lidos por esta trilha.

Os planos históricos de UX/QUA, AUD13, AAA e pós-entrega foram usados como intenção/rastreabilidade, conforme resumos previamente registrados. Seus scores, comandos e prompts não foram tratados como estado atual nem autorização para execução. Não houve redelegação, críticos externos, mudanças em código/testes, remediação ou execução em produção. Somente este relatório foi alterado nesta retomada; produto, `.agent`, Git, demais artefatos e ledger permaneceram fora das escritas desta trilha.
