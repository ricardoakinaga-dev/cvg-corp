# Auditoria — DeepSeek Harness como runtime embarcado

**Status:** CONCLUÍDA (Macrofase A)
**Data:** 2026-09-16
**Fonte auditada:** `/home/ricardo/deepseek-harness` @ `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (`dsh 0.1.5-alpha.1`)
**Licença da fonte:** MIT (`LICENSE`, "Copyright (c) 2026 DeepSeek")
**Autoridade de implementação:** nenhuma cópia de código foi feita nesta fase. A decisão consta em
[`docs/adr/ADR-agent-runtime-embedding-decision.md`](adr/ADR-agent-runtime-embedding-decision.md).

---

## 1. Método

1. Localizar o source real disponível para o projeto (`/home/ricardo/deepseek-harness`, clone com
   remotes `deepseek-official` e `origin`).
2. Verificar licença e proveniência (LICENSE, `THIRD_PARTY_NOTICES.md`, `vendor/README.md`,
   `license` por pacote).
3. Mapear a árvore de pacotes (`pnpm-workspace.yaml`, 267 manifests em `packages/*/*`).
4. Ler a documentação canônica do upstream (`docs/architecture.md`, `agent-lifecycle.md`,
   `tool-execution-pipeline.md`, `capability-seams.md`, `persistence-catalog.md`, `module-graph.md`).
5. Identificar o loop de agente, o boundary de modelo, o pipeline de tools, o modelo de
   autorização/aprovação, a persistência, o plugin/skill runtime e o modelo de processo.
6. Comparar com as camadas já existentes do CVG (`AgentRuntime`, PDP, Tool Gateway, approval,
   budget, session, worker, persistence, observability).
7. Classificar cada grupo de componentes em `EMBED`, `ADAPT`, `REIMPLEMENT`, `KEEP_EXTERNAL`,
   `REJECT` e decidir a arquitetura.

**Limitações desta auditoria** (registradas para não superdeclarar):

- a worktree do upstream está *dirty* (`git status --porcelain` com alterações locais não
  commitadas em docs e em `packages/shell/tool-*-persistent`); a referência de proveniência é o
  commit `5dda764ed3`, não a worktree;
- não foi executado scanner de CVE (Trivy/`pnpm audit`) sobre o upstream nesta fase;
- a contagem de LOC por grupo exclui `node_modules`, testes e artefatos gerados;
- o upstream não foi executado nesta máquina; todas as afirmações comportamentais vêm do código e
  da documentação do próprio upstream.

---

## 2. O que é o DeepSeek Harness

O DeepSeek Harness (`dsh`) é um **produto de agente de código completo**, não uma biblioteca de
runtime: um monorepo TypeScript com 267 manifests de pacote, ~222 mil linhas TS em `packages/`,
construído sobre o framework de plugins **Cordis** (vendorizado em `vendor/`), no qual "every part
of the product is a plugin, including the model adapter, the tool registry, the session log, and
the agent loop itself" (`docs/architecture.md`).

Superfícies de aplicação (`apps/`): CLI (`dsh web|headless|sdk|acp`), frontend web React (51
pacotes `packages/client/*`, ~128k LOC), Electron desktop + desktop-host, SDK TypeScript/Python e
servidor ACP (JSON-RPC stdio). O núcleo é um **loop de agente com sessão event-sourced**
(JSONL + zstd, `SESSION_FORMAT_VERSION = 3`), compaction por pressão de tokens, tool registry com
guards/approval/sandbox, skill loader por filesystem, jobs/terminal/subprocess/LSP/MCP, e um
adapter de modelo `deepseek-official` (chat-completions OpenAI-compatible).

---

## 3. Respostas às perguntas de auditoria (item 600 do prompt)

1. **O que exatamente é o DeepSeek Harness?** Um produto de agente com CLI, web UI, desktop e
   SDKs; um runtime cognitivo completo, com sua própria sessão, tools, aprovação, sandbox e
   composição de plugins. Não é um kernel pequeno nem uma biblioteca pronta para embed.
2. **Quais diretórios formam o runtime real?** `packages/core/*` (`agent`, `agent-loop`,
   `session`, `system-prompt`, `tools`, `scope`), `packages/llm/*`, `packages/context/*`,
   `packages/compaction/*`, `packages/session/*`, `packages/interaction/*`, `packages/tools` de
   domínio (`fs`, `shell`, `web`, `todo`, `skill`, `subagent`, `workflow`, `mcp`), `packages/boot`
   + `vendor/cordis` (loader) e `apps/cli` (boot de profile).
3. **Quais partes são genéricas?** Agent loop/step/turn, inbox de mensagens, montagem de
   system prompt, registry/pipeline de tools, seam de LLM com adapters plugáveis, sessão
   event-sourced com migração/checkpoint, compaction, skill registry por filesystem, hooks
   pre/post-execute, jobs/subprocess/terminal (úteis apenas para agentes de código), telemetria.
4. **Quais partes são DeepSeek-específicas?** `dsh-llm-deepseek` (wire `deepseek-official`),
   `dsh-session-log-deepseek`, `dsh-web-search-deepseek`,
   `dsh-plugin-package-inventory-deepseek`, model IDs `deepseek-v4-*`, `docs/deepseek-llm-api-wire-extensions.md`.
5. **Quais partes são plugins?** Tudo é plugin no Cordis; do ponto de vista do CVG, os
   equivalentes a "plugins" são pacotes que injetam `ctx.*` (`ctx.fs`, `ctx.llm`, `ctx.tools`,
   `ctx.web`, `ctx.storage`, `ctx.sandbox`) e o caminho de plugins dinâmicos
   (`extensions/cordis-host-runner` + `tool-cordis`, em `node:vm`, explicitamente documentado
   como *não* sendo boundary de segurança).
6. **Quais partes são necessárias ao Agent Loop?** `core/agent-loop` (ReactLoopAgent, turn/step,
   inbox), `core/session` + `session-persistence` (log), `core/system-prompt`, `core/tools`,
   `llm/llm` (seam) + um adapter, `context/*` para contexto, `compaction-basic` para pressão.
7. **Quais partes se sobrepõem ao CVG-Corp?** Sessão/persistência, aprovação, autorização
   (sandbox/permission presets), tool dispatch, budget/token meter, telemetria, storage (SQLite),
   secret/credentials, e a própria camada `AgentRuntime`/`ToolGateway`/PDP existentes.
8. **Quais partes duplicariam governança do CVG?** `ctx.approval`/`user-approval`,
   `permission-presets`/`sandbox-policy`, `ctx.credentials`/`credentials-local` (`$DSH_HOME/.env`),
   `session-persistence-jsonl`, `storage-sqlite`, contadores de uso/token meter. Nenhuma delas
   pode virar autoridade paralela.
9. **Quais partes podem legalmente ser embarcadas?** Todo `packages/*/*` declara MIT e o root é
   MIT com copyright DeepSeek; embarcar exigiria preservar copyright/NOTICE. Há dependências
   heterogêneas no runtime completo (Apache-2.0 `@agentclientprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`
   com licença própria, `@openai/codex`, binários ripgrep, `node-pty`, `koffi`, `sharp`) que
   tornam o *embedding do produto inteiro* um exercício de licenças e de supply chain, não apenas
   de código.
10. **Quais partes devem permanecer externas?** O produto `dsh` (CLI/web/desktop/SDK/ACP) e seu
    adapter de modelo permanecem um processo externo acionado pelo adapter CVG existente. O CVG
    reimplementa os mecanismos genéricos que precisa sob contratos próprios.

---

## 4. Classificação de componentes

| Componente upstream | Localização | Classificação | Justificativa |
| --- | --- | --- | --- |
| Agent loop (turn/step/inbox) | `packages/core/agent-loop` | **REIMPLEMENT (ideias)** | ~2.4k LOC acoplados a Cordis/`ctx.*`, sessão própria e eventos de domínio `dsh`. Reimplementar o ciclo sob contrato CVG. |
| System prompt / context builder | `packages/core/system-prompt` + `packages/context/*` | **REIMPLEMENT (ideias)** | O conceito (compor o que chega ao modelo por prioridade) é útil; a implementação depende de eventos/sessão do dsh. |
| Session engine / event log | `packages/core/session`, `packages/session/*` | **REIMPLEMENT (ideias)** | Formato v0→v3, JSONL/zstd e migrações próprias; CVG já tem PostgreSQL/RLS/ledgers como autoridade. |
| Compaction | `packages/compaction/*` | **ADAPT (ideias)** | Pressão por token meter + resumo + prune de tool results; implementar com provenance e sem substituir registros clínicos. |
| Tool registry / pipeline | `packages/core/tools` | **REJECT (substituído)** | CVG Tool Gateway + PDP já são soberanos; nenhum dispatcher paralelo. |
| Approval | `packages/interaction/user-approval` | **REJECT (substituído)** | CVG Approval Engine one-shot com digest, policy revision e aprovador independente. |
| Permissões/sandbox | `packages/sandbox/*`, `permission-presets` | **REJECT (substituído)** | CVG PDP é a autoridade; sandbox bwrap/landlock/ACL é específico do ambiente de código do dsh. |
| LLM seam + adapter DeepSeek | `packages/llm/*` | **ADAPT (contrato/ideias)** | O CVG cria `ModelProvider` próprio; o adapter DeepSeek do CVG fala chat-completions. O cliente `dsh` permanece atrás do adapter externo. |
| Credentials/secrets | `packages/credentials/*` | **REJECT** | Autoridade é o `SecretProvider` CVG; nenhum `.env` próprio do harness. |
| Persistência/storage | `packages/storage/*`, `session-query-sqlite` | **REJECT** | PostgreSQL CVG com RLS é a única autoridade; não criar banco paralelo. |
| Skill loader | `packages/skill/*` | **REIMPLEMENT (ideias)** | Manifesto + frontmatter + scan de roots é útil; CVG adiciona digest, approval e gate. |
| Plugin framework | `vendor/cordis` + `packages/extensions/*` | **KEEP_EXTERNAL** | O framework Cordis e o runner dinâmico (`node:vm`, sem boundary de segurança) não entram no CVG. O CVG cria contrato de plugin mínimo. |
| Subagents / ACP / Codex / Claude Code | `packages/subagent/*`, `packages/acp` | **KEEP_EXTERNAL** | Integrações de agente de código; não são capacidade do produto veterinário. |
| UI client / web / desktop | `packages/client/*`, `apps/desktop*` | **REJECT** | UI própria do produto upstream. |
| Shell/subprocess/terminal/jobs/LSP | `packages/shell`, `subprocess`, `terminal`, `jobs`, `lsp` | **REJECT** | Dependem de native modules (`node-pty`, `koffi`) e existem para agentes de código; o CVG não executa shell de agente. |
| Web search/fetch | `packages/web/*` | **KEEP_EXTERNAL** | Egress de rede não aprovado; retrieval CVG é governado por knowledge aprovado. |
| Telemetria | `packages/session/*telemetry*` | **ADAPT (ideias)** | OpenTelemetry já existe no CVG (`packages/ops`); nomes de span/métricas do kernel seguem o padrão CVG. |
| MCP client | `packages/mcp` | **KEEP_EXTERNAL** | Protocolo de integração; não substitui PDP/Tool Gateway/validação de domínio. |
| DeepSeek-specific client | `packages/llm/llm-deepseek` | **KEEP_EXTERNAL** | Permanece atrás do provider/model boundary; nenhuma regra de negócio nele. |

---

## 5. Mapa de dependências e itens de risco

Dependências notáveis do produto upstream (agregado de dezenas de `package.json`): `zod` (37 pacotes),
`react`/`zustand`/`lexical` (client), `ws`, `chokidar`, `commander`, `undici`, OpenTelemetry JS,
`@agentclientprotocol/sdk` (Apache-2.0), `@modelcontextprotocol/sdk`.

**Itens que desaconselham embedding do produto inteiro:**

| Item | Risco |
| --- | --- |
| `node-pty` (patchado), `koffi` (FFI), `@deepseek-ai/node-addon-system-*` (Landlock/flock) | Módulos nativos por plataforma; build/release e supply chain pesados. |
| `sharp`, `@vscode/ripgrep` | Binários nativos; tamanho e CVEs próprios. |
| `@anthropic-ai/claude-agent-sdk`, `@openai/codex`, Electron | Payloads grandes, licenças heterogêneas, superfície de ataque irrelevante ao CVG. |
| `e2b` (sandbox remoto na nuvem) | Egress externo não governado pelo CVG. |
| Toolchain: `pnpm@11.7.0`, Node `^22.19 || >=24`, TS 6 RC, patches de lockfile | Divergente do CVG (npm workspaces, Node >=24.20); coexistência exigiria segundo gerenciador. |
| `vendor/` Cordis com 19 modificações locais | Fork vendorizado com histórico próprio: atualização e auditoria de segurança passam a ser responsabilidade do CVG se embarcado. |
| `docs/persistence-catalog.md` (1119 linhas) e `module-graph.md` (1437 linhas) gerados | Acoplamento interno alto entre ~267 pacotes; o "mínimo necessário" não é extraível sem poda profunda. |

**Tamanho:** ~222k LOC TS só em `packages/` (sem client `apps`/`native`/`python`). O client web
sozinho tem ~128k LOC. O núcleo de loop + sessão + llm + context + tools tem dezenas de milhares
de LOC entrelaçados por Cordis.

---

## 6. Mapa de sobreposição com o CVG

| Necessidade | Já existe no CVG | Decisão |
| --- | --- | --- |
| Porta de runtime | `AgentRuntime` (`packages/agent-runtime`) com health/createSession/executeTurn/approve/promoteDraft/replay/shutdown | **KEEP CVG**; novo runtime implementa essa porta. |
| Autorização | PDP `StaticPolicyDecisionPoint` + registries (`packages/agent-policy`) | **KEEP CVG**; runtime consulta, nunca substitui. |
| Execução de tool | `ToolGateway` + ledger (`packages/agent-tools`) | **KEEP CVG**; kernel emite tool request, gateway executa. |
| Aprovação | `AiApproval` one-shot + approval contextual no `GovernedHarness` | **KEEP CVG**; kernel pausa em `WAITING_HUMAN_APPROVAL`. |
| Budget | `BudgetReservation` + settlement no store/ledger | **KEEP CVG**; kernel reserva/settla via porta. |
| Persistência de IA | `ai_sessions`, `ai_turns`, `ai_drafts`, `ai_approvals`, `ai_usage_ledger` (migrations 001/004/029) | **KEEP CVG**; novas tabelas `agent_*` apenas para estado interno do kernel (checkpoint/lease/turn ledger), com RLS. |
| Auditoria | cadeia append-only `previous_hash`/`record_hash` | **KEEP CVG**. |
| Efeitos externos | effect ledger + outbox + reconciliação | **KEEP CVG**. |
| Worker | `apps/worker` com jobs/outbox/fencing | **KEEP CVG**. |
| Observabilidade | `packages/ops` (OTel + métricas + redaction) | **ADAPT**: adicionar spans/métricas do kernel. |
| Runtime externo | `DeepSeekHarnessAdapter` + `apps/deepseek-bridge` | **KEEP EXTERNAL** como rollback/ponte. |

---

## 7. Decisão de arquitetura

**Resultado: `HYBRID`** — ver
[`docs/adr/ADR-agent-runtime-embedding-decision.md`](adr/ADR-agent-runtime-embedding-decision.md).

- **Runtime embarcado CVG:** kernel cognitivo provider-neutral, Context Builder governado,
  sessão durável com lease/fencing, plugin/skill runtime mínimos e `ModelProvider` com adapters
  (Mock/DeepSeek/Local) — reimplementando os *mecanismos* úteis identificados acima, sob
  contratos CVG, sem importar arquivos do upstream.
- **Runtime externo preservado:** o adapter do harness DeepSeek permanece como caminho
  `external` selecionável e rollback.

Nenhum arquivo upstream foi incorporado. A proveniência registra essa escolha em
[`docs/third-party/deepseek-harness-provenance.md`](third-party/deepseek-harness-provenance.md) e
o acompanhamento em
[`docs/third-party/deepseek-harness-upstream.md`](third-party/deepseek-harness-upstream.md).

---

## 8. O que foi extraído como conceito (sem código)

| Conceito extraído | Implementação CVG |
| --- | --- |
| Loop explícito com fases e limites | `packages/agent-kernel` |
| Contexto composto por prioridade, não retrieval direto | `packages/agent-context` |
| Sessão event-sourced com checkpoint/resume | `packages/agent-session` |
| Seam de modelo plugável com capabilities | `packages/model-runtime` + `packages/model-adapters` |
| Plugins por capability, sem autoridade ambiente | `packages/agent-plugins` |
| Skills como conhecimento/procedimento, não capacidade | `packages/agent-skills` |
| Compaction sob pressão de token | `packages/agent-context` (compaction governada) |
| Tool results como dados não confiáveis | Trust levels no Context Builder |
| Loop/degradação controlada | Stop conditions + supervisor + kill switches |
