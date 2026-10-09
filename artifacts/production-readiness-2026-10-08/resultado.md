# Resultado — fechamento dos achados abertos e prontidão local (08/10/2026)

**Veredito local:** os dez achados corrigíveis da auditoria de 03/10 foram
corrigidos, e a revisão crítica da primeira entrega apontou mais cinco
pendências reais, todas reproduzidas e corrigidas. Levar o CI do PR até o
fim revelou ainda oito falhas que só existiam fora desta máquina, também
corrigidas. O commit de código `3f5a736` foi requalificado do zero: cada
recibo registra o commit, o fingerprint do sujeito e o estado da árvore antes
e depois do comando.
**Veredito de release:** continua `PROMOTION_BLOCKED`. Faltam o candidato
congelado (AUD27-004/005), staging com autoridades reais, provedores, DR medido,
revisão independente do diff final e a decisão humana. Restam também duas
observações de código sem correção (ver *Limites*).

## Evidência do commit final

| Item | Valor |
| --- | --- |
| Commit de código qualificado | `3f5a736d4c7bd27be76554bb91e1e0048b3656da` |
| Commit de controle no HEAD durante a execução | `3e7308a` (só `.agent/`, fora do sujeito) |
| Fingerprint do sujeito | `sha256:184e1f7dbb767479f74fa0ed37a139d14b0692d42e960ced8ab0fde4dd3611aa` |
| Árvore do sujeito | limpa antes e depois de cada um dos 49 comandos (`subject_after: UNCHANGED`) |
| Recibos | `requalification-3f5a736/verification/<gate>.json` (comando, exit, duração, commit, fingerprint, SHA-256 do log) |

Resultados nesse commit:

- `npm test`: **1006 casos, 1005 aprovados, 0 falhas, 1 skip** (ACP real,
  opcional). Recortes do CI: contrato 12/12, segurança 32/32, banco 83/83,
  falhas/worker 34/34.
- typecheck, lint (308 arquivos + oxlint), build com budgets, arquitetura
  (18 orçamentos, 0 ciclos), static, PDP, PDP universal, schema manifest,
  integridade documental, claims, licenças, tokens, contraste, IA desligada,
  segurança do agente, sandbox de provedores, escritas autoritativas, worker,
  runtime/harness/plugins/skills/evals do agente, audit chain, runtime
  compilado, estrutura de produção e `git diff --check`: exit 0.
- Cobertura: **89,54% linhas**, 77,42% branches, 89,01% funções. Por área
  crítica, em linhas: segurança 95,05%, contratos 92,98%, persistence 86,52%,
  domínio 96,15%. Ratchet aprovado e fixture conhecido-ruim recusado.
- Mutação: **30/30 KILLED, 0 INVALID**, com o classificador por eventos
  estruturados (ver FQ-04 abaixo).
- PostgreSQL 16 descartável: 49 migrations, comportamento e restore, oráculo
  RLS sem resíduo, migração de dados e escritas normalizadas, 24/24 fatias com
  paridade, CLI de migração 7/7, rota de resposta (callback de provider não
  vinculado → 403, produtos → 200, chave de lote recusado → 409, nova intenção
  → 201). Containers removidos; inventário externo inalterado.
- Navegador: matriz local de **552 casos**, com todos os projetos exceto
  firefox-stress (ver *Execução local travada*). Resultado: 517 aprovados,
  35 skips, 0 falhas, 0 flaky, em 28,6 min. O watchdog não disparou e nenhum
  processo sobreviveu ao passo. Somando o firefox-stress do CI (4 aprovados,
  2 skips), dá exatamente a matriz de 558 casos do CI: 521 aprovados e 37
  skips.
- Imagens: construídas a partir do `git archive` do HEAD `3e7308a`, que tem
  código idêntico a `3f5a736` e o mesmo fingerprint. Os recibos
  `image-api.json` e `image-web.json` registram esse HEAD como `source_sha`.
  - API: `sha256:4346663e98cc…`, usuário 65532.
  - Web: `sha256:a94b19c3620f…`, usuário 101.
  - Smoke dos contêineres endurecidos: aprovado.
  - Smoke durável: migração, API e worker compilados contra um PostgreSQL
    sintético próprio, com os dados preservados após o restart. Aprovado.
  - O Trivy das duas imagens roda no CI (ver abaixo).
- Scanner de segredos (gitleaks fixado, histórico e árvore): aprovado.
  `npm audit`: 0 vulnerabilidades.
- Bloqueados por desenho, com exit ≠ 0 registrado:
  - `verify:alertmanager` — `CVG_ALERTMANAGER_WEBHOOK_URL is required`;
    depende do webhook real do ambiente.
  - `verify:aud26-evidence --capture` — o envelope está vinculado ao candidato
    `c990914`.
  - `verify:evidence-snapshot` — janela de 7 dias sobre evidências datadas de
    setembro do candidato congelado.

  Os dois últimos só passam quando o pacote de evidências for capturado para o
  SHA congelado (AUD27-004/005).

CI remoto: [run 37876416723](https://github.com/ricardoakinaga-dev/cvg-corp/actions/runs/37876416723),
evento `pull_request` sobre o merge de `3e7308a` com `main` (merge `9f9857b`; o
código do PR é idêntico a `3f5a736`).

- **Verificação** (68 min) aprovada: secret scan, lint, typecheck, recortes de
  teste, cobertura, matriz de navegador, migrations e gates PostgreSQL de
  integração/RLS, restore e concorrência, `verify:production` e
  `git diff --check`.
- **Imagens** aprovadas: build OCI das duas imagens, Trivy sem HIGH/CRITICAL
  com correção disponível em nenhuma delas, proveniência do mesmo SHA gerada e
  verificada.
- O workflow fica vermelho só pelo job `evidence-binding`, com os dois
  bloqueios por desenho descritos acima. Os logs desse job mostram as mesmas
  mensagens da execução local.

## Execução local travada na matriz de navegador (09/10)

A segunda revisão crítica encontrou a matriz local completa
(`e2e-full-matrix`) parada havia cerca de 7 h, logo após o caso 546. O
acompanhamento passivo ("serei avisado quando terminar") não detectou o
problema. A evidência está em `requalification-3f5a736/e2e-hang-diagnostics/`.

O que os dados mostram:

- O primeiro caso do projeto firefox-stress (`accessibility-stress.spec.ts:14`)
  estourou o timeout no primeiro `page.goto("/")`: a navegação nunca chegou a
  `load` (`stuck-test-output/error-context.md`).
- O processo de conteúdo do Firefox de teste (Playwright `firefox-1543`)
  entrou em laço dentro do kernel:
  - cerca de 24.900 s de CPU de sistema contra 0,3 s de usuário;
  - cerca de 1.550 syscalls em toda a vida do processo e uma única thread;
  - órfão (ppid 1), com SIGKILL pendente desde que o Playwright encerrou o
    grupo, de modo que não pode ser morto a partir do espaço do usuário
    (`process-snapshot.txt`).
- Ele herdou o stdout e o stderr do Firefox principal (sockets `102670111` e
  `102670113`), e o worker segura os pares (`102670110` e `102670112`). Por
  isso o worker esperava sem fim o encerramento desses streams.
- O log do kernel não registra nada no intervalo, e não havia pressão de
  memória. A máquina roda o kernel 7.0.0-34; o 7.0.0-38 está instalado desde
  14/09 sem reboot. Obter a pilha de kernel exige root.
- Encerrado o worker, o runner seguiu, e um Firefox novo travou da mesma forma
  no caso seguinte de firefox-stress (2 de 2).
- O primeiro processo preso saiu logo depois que o worker travado foi
  encerrado. O segundo continua girando, mesmo com as pontas do stdio já
  fechadas, e ocupa um núcleo até o reboot. Sem a pilha de kernel não dá para
  dizer o que encerrou o primeiro.
- Nessa tentativa, os nove projetos navegador × viewport (Firefox incluído) e
  o chromium-stress terminaram: 547 casos reportados, 513 aprovados, 33 skips
  e 1 falha, que é o caso travado. O recibo `e2e-full-matrix-attempt1.json`
  registra exit 143, após o encerramento pelo operador aos 26.717 s. Os logs
  dos dois momentos de travamento foram preservados.

Não é defeito do app. O travamento acontece antes de o app executar (0,3 s de
CPU de usuário), e o mesmo código passou no firefox-stress do CI (run
37876416723: 4 aprovados, 2 skips).

Correções:

- **Watchdog no orquestrador.** A requalificação usava `subprocess.run` sem
  limite. Agora cada passo tem dois limites, um de inatividade (log sem
  crescer) e um de tempo total, e o recibo registra os dois.
  - O encerramento sinaliza a sessão do passo e cada descendente rastreado por
    PID e horário de início, inclusive os servidores que o Playwright cria em
    outra sessão e os órfãos reparentados ao init.
  - Descendentes que sobrevivem ficam listados no recibo.
  - O autoteste cobre três casos: travamento com um filho em outra sessão e um
    órfão, estouro do tempo total e saída normal
    (`runtime/watchdog-selftest-output.txt`).
  - As duas versões do orquestrador ficam em `runtime/`: a v1 rodou os gates e
    a tentativa 1, a v2 rodou a matriz refeita.
- **Matriz refeita.** Rodou num recibo único com todos os projetos exceto
  firefox-stress (`e2e-matrix-host-bounded`): 552 casos, 517 aprovados,
  35 skips, 0 falhas, watchdog sem disparo.
- **Pendência local.** O firefox-stress fica `BLOCKED_HOST` até o dono da
  máquina decidir reiniciá-la, o que também derruba os outros serviços que
  rodam nela. Depois do reboot, basta
  `npx playwright test --project=firefox-stress`.

## Revisão crítica da primeira entrega

A revisão auditou afirmações, código, recibos e o CI. Cada ponto foi reproduzido
antes de corrigir:

| Pendência | Reprodução | Correção | Commit |
| --- | --- | --- | --- |
| P2 — mutação contava falha de execução como KILLED | Erro de sintaxe, `process.exit(1)` e throw no topo de um arquivo de teste imprimem `fail 1`; o classificador do HEAD os marcava KILLED | Reporter estruturado do `node:test`; falha de arquivo/processo invalida a execução; kill exige falha lançada dentro de um teste em execução. A regressão dirige o runner real em cada caso | `60ae0c0` |
| P2 — `ai.turn` registrava `ALLOWED` para resultado desconhecido | Ledger de sessão indisponível via API: turno `OUTCOME_UNKNOWN`, auditoria `ALLOWED` | Mapa exaustivo por status: `UNKNOWN` com `turnStatus` e motivo; o recibo continua vinculado ao registro honesto | `daef871` |
| P2 — isolamento E2E dependia de variável manual | Sem `PLAYWRIGHT_OUTPUT_DIR`, execuções compartilhavam `test-results`, relatório, cache e screenshots em `artifacts/runs/` | Cada execução local usa `test-results/runs/<run>/`; screenshots via `testInfo.outputPath`. Prova: duas execuções simultâneas sem variável, diretórios distintos, relatório compartilhado intocado (`e2e-concurrent-isolation.json`) | `db04017` |
| P2 — envelopes de evidência bloqueavam as imagens; upload pulado em falha | Workflow: `container-build` dependia do job que continha os envelopes | Job `evidence-binding` independente (continua reprovando o workflow); uploads com `!cancelled()` | `779cda2` |
| P2 — relatório atribuía provas à versão errada | Imagens construídas de árvore não commitada (`47858deb…`); "todos aprovados" com dois recibos pós-commit reprovados; 997 × 999 casos | Requalificação de um único commit com recibos vinculados; imagens a partir de `git archive`; docs do sujeito sem números da própria qualificação | `8cd545f`, este relatório |

Levar o CI do PR até o fim revelou falhas que só existiam fora desta máquina.
Nenhum gate foi relaxado. Cada uma foi reproduzida localmente nas condições do CI
antes de corrigir:

| Falha no CI | Causa | Correção | Commit |
| --- | --- | --- | --- |
| Envelope AUD26 | Comparava mtime, que o Git não preserva | Digest continua verificado; mtime removido | `0c9a429` |
| Semântica AUD27 e teste do estado vivo | Manifesto apontava para um prompt em `~/.codex/attachments` | Cópia idêntica versionada em `docs/`; digest canônico refixado com aprovação do dono do repositório | `e5464ea` |
| Integridade documental | 55 links de relatórios históricos para arquivos ignorados pelo Git (`*.log`, `artifacts/runs/*.png`) | O gate recusa esse tipo de link em qualquer ambiente (`LOCAL_ONLY_LINK`); referências viraram caminhos marcados como evidência local | `e658c00` |
| PostgreSQL integração/RLS | `verify:postgres` exige `MIGRATION_DATABASE_URL` desde `fc8a5d1`; o passo do CI só recebia a URL de runtime | URL do dono do schema no passo | `8e1aa10` |
| PostgreSQL restore (descoberta na simulação com a imagem `postgres:18.0` fixada) | O gate de concorrência grava um recibo-sonda fora da autoridade de snapshot; o oráculo exato do restore via 7 linhas na origem e 6 no destino, mesma classe do achado de 26/09 | Restore logo após o gate de comportamento, como no runner local; concorrência depois. Os quatro passos passam nessa ordem | `8e1aa10` |
| Timeout do job | A matriz de navegador leva ~28 min no runner, e `verify:production` a repete por desenho | Timeout de 60 para 110 min | `8e1aa10` |
| Trivy do job de imagens (descoberto com o mesmo critério do CI) | Base distroless com `libssl3t64` deb13u2 (CVE-2026-75804, CVE-2026-84782); base alpine com `pcre2` 10.48 (CVE-2026-103111) e `tiff` 4.7.1 (CVE-2026-4775), todas HIGH com correção | Digest distroless atualizado (Node continua v24.21.0); upgrade pontual de `pcre2` e `tiff` na web, como já era feito com `libexpat`. As duas imagens reconstruídas passam no Trivy, e a proveniência é gerada e verificada numa cópia limpa | `33f0fee` |
| Whitespace do diff (`verify:production` e `verify:diff`) | O passo de cobertura regrava `artifacts/coverage-output.txt`, que é versionado, e o Node completa a tabela com espaços no fim da linha. Toda linha de cobertura alterada, como a dos módulos novos `ai-turn-audit.ts` e `integration-callback.ts`, reprovava `git diff --check`. Já tinha acontecido na auditoria de 03/10. O runner local restaura as saídas versionadas depois de cada gate e por isso não via o problema | O artefato é gravado sem espaço no fim da linha, e o parser continua lendo a saída bruta. A simulação regravou o arquivo com a cobertura real, rodou o baseline e o SBOM, e `git diff --check` passou | `3f5a736` |

## Achados da auditoria de 03/10 fechados

| Achado | Prioridade | O que mudou | Prova de regressão |
| --- | --- | --- | --- |
| FQ-06 logout durante revalidação | P1 | A revalidação em voo é invalidada no logout; a revogação no servidor é tentada fora do modo offline e não é bloqueada pelo gate de runtime | E2E falha no código original (sessão reaberta, nenhum `POST /auth/logout`) |
| SEC-AI-03 chave de callback × provider | P1 | `CVG_INTEGRATION_CALLBACK_KEYS` com pares `provider=keyRef`; par ausente recusado antes de resolver segredo ou escrever | Unit com a sonda da auditoria; PostgreSQL: mesma chave para outro provider → 403 |
| SEC-AI-04 produção sem IA | P1 | `CVG_AGENT_RUNTIME=disabled` dispensa pré-requisitos DeepSeek; demais modos recusam o mock | `vnext.test.ts`, `production-config.test.ts` |
| FQ-01 produto órfão no estoque | P2 | `GET /stock/products` (catálogo com RLS); formulário mantém o produto e usa nova intenção após recusa definitiva | E2E com reload; PostgreSQL: listado, 409, 201 |
| FQ-02 pagamento parcial | P2 | Valor sugerido é o saldo em aberto | E2E falha no original |
| FQ-03 mensagem do error boundary | P2 | Não afirma que nada foi alterado | E2E falha no original |
| FQ-04 classificador de mutação | P2 | Eventos estruturados (ver acima); baseline sem mutação obrigatória | Unit com o runner real; 30/30 KILLED |
| FQ-05 saídas E2E compartilhadas | P2 | Isolamento por execução por padrão (ver acima) | Duas execuções concorrentes |
| Dependências | moderado/alto | fastify 5.12.5, fast-uri 4.2.1/3.1.8, source-map-js 1.2.2 | `npm audit`: 0 |
| Ponte DeepSeek sem limite | — | Leitura incremental com teto (2 MiB padrão) | Unit com stream de 1 MB contra teto de 4 KiB |

## Provas anteriores (históricas, outras versões)

As provas em `verification/` (06:00–10:45 UTC) e `verification/after-commit/`
continuam preservadas, mas **não qualificam o commit final**:

- **`verification/`**: rodou sobre árvores não commitadas. As imagens e os dois
  smokes foram construídos da árvore de fingerprint `47858deb…`. A matriz de
  navegador de 558 casos (521 aprovados, 37 skips, 0 falhas) e as provas
  PostgreSQL também são anteriores à consolidação. `npm test` registrou 997
  casos nessa árvore.
- **`verification/after-commit/`**: rodou no commit `cc02bd6`, com 999 casos
  na suíte. Dois recibos reprovaram ali (`evidence-aud26-capture` exit 1 e
  `evidence-snapshot` exit 2), pelos mesmos bloqueios de evidência vinculada
  a SHA descritos acima. A versão anterior deste relatório dizia "todos
  aprovados"; estava errada.
- **Requalificações intermediárias** (`8cd545f`, `e658c00`, `8e1aa10`,
  `33f0fee`): foram superadas pelos commits de correção do CI e descartadas sem
  uso. A de `33f0fee` foi interrompida durante a matriz de navegador quando o
  CI revelou a falha de whitespace; até ali, 42 gates tinham saído com exit 0
  e os três bloqueios esperados se repetiram. A de
  `e658c00` chegou ao fim com o mesmo resultado da final: tudo aprovado, exceto
  os três bloqueios esperados, e matriz de navegador 521/37/0.
  - Na de `8cd545f`, o scanner de segredos acusou um `idempotencyKey` (UUID
    aleatório do servidor sintético) num trace deixado por uma execução E2E
    interrompida em `test-results/`. Era falso positivo, e o resíduo foi
    removido.
  - Nas execuções seguintes o scanner passou.

## Decisões

- Contagens fixadas em testes foram atualizadas pela rota nova (105→106 rotas,
  80→81 schemas, 45→46 GETs), não removidas.
- O orçamento de `packages/persistence/src/index.ts` não foi aumentado.
- Callbacks falham fechado: sem pares configurados, toda assinatura é recusada.
- `source-map-js@1.2.2` tem 8 dias de publicação; dependência de build com
  advisory alto corrigido.
- O job de imagens não espera mais pelos envelopes de evidência por SHA. A
  proveniência gerada no CI continua sem assinatura e não lista
  `evidence-binding` entre os estágios concluídos.
- Logs (`*.log`) seguem a convenção do repositório e não são versionados. Os
  recibos JSON trazem o SHA-256 de cada log. Para terceiros conferirem os logs,
  é preciso anexá-los ou versioná-los, o que fica para decisão do dono do
  repositório, já que ele é público.

## Limites e próximo passo

Fora do alcance local e necessários para liberar produção:

- candidato congelado e captura do pacote de evidências para o SHA exato
  (AUD27-004/005);
- staging com Secret Authority, TLS, MFA, OTLP e webhook do Alertmanager reais;
- provedores de mensageria e modelo autorizados;
- backup/restore gerenciado com RTO/RPO medidos;
- carga e caos em staging;
- tecnologia assistiva real;
- revisão independente do diff final;
- decisão humana de release.

Observações de código ainda abertas:

- o runtime de plugins não é sandbox (não está ligado em produção);
- dois dos quatro perfis de agente (Internação e Administrativo) não são
  alcançados pelo seletor padrão. Corrigir exige decidir o critério de
  roteamento (tipo de workspace ou papel), o que é decisão de produto.
