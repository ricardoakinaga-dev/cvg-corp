# ExecPlan: Embedded Agent Runtime — CI closure e retomada

<!-- status: ACTIVE; active_action_id: CI-CLOSURE-01:BROWSER-E2E-AGENDA -->

## Outcome

Fechar o programa "Embedded Agent Runtime + Triple AAA local" com:
CI remoto same-SHA verde (incluindo a matriz completa de browsers e os três
gates PostgreSQL), evidência local revalidada no SHA do checkpoint, e veredito
honesto `AAA_NOT_PROVEN` até existirem provas externas e aprovação humana.

## Context

- Base do checkpoint: commit `277f10f189750586ae32c7ae1974488c9c1b97ce`
  (remote CI run `35176228659`). O SHA exato deste checkpoint está em
  `.agent/state.json` (`current_checkpoint.sourceSha`).
- Plano normativo: `docs/prompt-embedded-agent-runtime-2026-09-16.md`.
- Auditoria/decisão: `docs/embedded-harness-audit.md`,
  `docs/adr/ADR-agent-runtime-embedding-decision.md` (HYBRID, zero código upstream).
- Gates locais: `npm run verify:state-of-art` (30 gates) e
  `docs/embedded-harness-verification.md`.
- Evidência canônica: `artifacts/quality/current-state.json`,
  `artifacts/operational-proof/state-of-art-local.json`,
  `artifacts/operational-proof/state-of-art-external.json` (`BLOCKED_EXTERNAL`).

## Current State

Concluído e verificado antes deste checkpoint:

- Runtime embarcado CVG-owned atrás do `AgentRuntime` (kernel, contexto, sessão,
  plugins, skills, model runtime/adapters), execução de leituras de aplicação
  vinculada, pricing opcional, métricas de anomalia, support bundle, UX de IA.
- Evals 7/7 + paridade diferencial, 10 ataques adversariais, chaos 7 falhas,
  baseline de carga 1–50 sessões, `verify:state-of-art` 30/30 verde.
- PostgreSQL 16.15 real **local** (portátil em `/tmp/opencode/pg`,
  porta 54329, banco `cvg_local`): migrations 001–039, RLS de catálogo, fence no
  banco (039), append-only por tenant, `verify:postgres` +
  `verify:postgres:concurrency` + `verify:postgres:restore` verdes.
- CI remoto: passos 1–36 verdes na run `35170108792` (lint, testes, static,
  PDP, agent gates, Browser E2E, migrations, três gates PostgreSQL).
- Correções recentes já publicadas: snapshot de evidência não conta o próprio
  arquivo nem churn de `artifacts/` como drift; parser de porcelain corrigido;
  teste time-bomb do provider-real tornado relativo; ações de diagnóstico
  descongestionadas (botões fora de `<small>`); jornada de agenda com janelas
  13:00+ por projeto, retry no dia seguinte e asserções em recibo/linha
  persistidos.

Em voo (único item aberto do CI):

- A run `35176228659` falhou **apenas** no passo 30 (Browser E2E), jornada de
  agenda, em janelas `0...` (chromium-wide) e `32...` (webkit-mobile, tentativa
  e retry): a linha criada não apareceu na lista em 5 s, embora o recibo de
  criação exista. Localmente a matriz completa (386 testes) e o smoke serial
  passam; a emulação `TZ=UTC` reproduz apenas o artefato de emulação (WebKit
  local ignora `TZ` e cria em dia diferente do servidor), não o caso do CI.
- Hipóteses abertas: recarga assíncrona da lista mais lenta que 5 s no runner,
  ou filtro de dia/lista divergente por relógio do runner na virada de dia UTC.
- Já aplicado localmente (não publicado no commit base): timeout da asserção de
  linha para 15 s e diagnóstico de anexos E2E ampliado para 6 000 caracteres
  (recibo, contagem de janelas e primeiras linhas da página).

## Next Actions (ordem exata)

1. Publicar o checkpoint (este commit) e observar a nova run.
2. Ler o diagnóstico da run: anotações do job via API pública (sem `gh`/logs):

   ```bash
   run=$(curl -s "https://api.github.com/repos/ricardoakinaga-dev/cvg-corp/actions/runs?head_sha=$(git rev-parse HEAD)&per_page=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
   job=$(curl -s "https://api.github.com/repos/ricardoakinaga-dev/cvg-corp/actions/runs/$run/jobs" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobs'][0]['id'])")
   curl -s "https://api.github.com/repos/ricardoakinaga-dev/cvg-corp/check-runs/$job/annotations" | python3 -c "import json,sys;[print(a['message'][:6000]) for a in json.load(sys.stdin) if a['annotation_level']=='failure']"
   ```

3. Se a linha ainda faltar, decidir pela evidência da página anexada:
   - **Recibo presente + lista sem a janela** → divergência de dia/filtro;
     considerar fixar `page.clock` da jornada (ex.: `2026-09-16T12:00:00Z`) e
     derivar `agendaDate` dessa mesma data em vez de `new Date()`.
   - **Alerta "A janela escolhida já está ocupada."** → conflito; escolher
     profissional/serviço dedicados (`#agenda-provider` por janela) ou mover as
     janelas para um intervalo comprovadamente livre.
   - **Diálogo ainda aberto sem alerta** → POST lento; o timeout de 15 s cobre.
4. Repetir 1–3 até a run completa ficar verde (passos 30–41).
5. Reexecutar a evidência local no SHA final: `npm run verify:state-of-art`
   (30 gates) e regenerar `artifacts/operational-proof/evidence-snapshot.json`.
6. Rebinary `artifacts/quality/current-state.json` (`CURRENT`, subjectSha do
   checkpoint) e `last-verification.json`; confirmar
   `verify:docs-provenance` e `verify:claims`.
7. Registrar no relatório final o resultado same-SHA do CI e encerrar como
   `LOCAL_STATE_OF_THE_ART_CANDIDATE` / `AAA_NOT_PROVEN` (provas externas e
   aprovação humana continuam ausentes).

## Gates obrigatórios antes de declarar o CI fechado

```bash
npm run verify:state-of-art        # 30 gates locais
npm run verify:agent-runtime
npm run verify:embedded-harness
npm run verify:agent-security
npm run verify:agent-evals
npm run verify:ai-disabled
npm run test:e2e:smoke:serial      # subset suportado, sem WebKit-dependente
```

## Kit de retomada — PostgreSQL local portátil

```bash
export PGBIN=/tmp/opencode/pg/usr/lib/postgresql/16/bin
export PGLIB=/tmp/opencode/pg/usr/lib/x86_64-linux-gnu
export LD_LIBRARY_PATH=$PGLIB
$PGBIN/pg_ctl -D /tmp/opencode/pgdata -l /tmp/opencode/pg.log \
  -o "-p 54329 -k /tmp/opencode/pgsock -c listen_addresses=127.0.0.1" start

# migrations + gates
DATABASE_URL='postgresql://postgres@127.0.0.1:54329/cvg_local' \
  CVG_RUNTIME_DB_USER=cvg_runtime CVG_RUNTIME_DB_PASSWORD='local-runtime-password' \
  npm run db:migrate
DATABASE_URL='postgresql://cvg_runtime:local-runtime-password@127.0.0.1:54329/cvg_local' \
  CVG_STORAGE=postgres CVG_BOOTSTRAP_PASSWORD='cvg-local-bootstrap-password' \
  npm run verify:postgres
DATABASE_URL='postgresql://cvg_runtime:local-runtime-password@127.0.0.1:54329/cvg_local' \
  MIGRATION_DATABASE_URL='postgresql://postgres@127.0.0.1:54329/cvg_local' \
  ADMIN_DATABASE_URL='postgresql://postgres@127.0.0.1:54329/postgres' \
  CVG_RUNTIME_DB_USER=cvg_runtime CVG_RUNTIME_DB_PASSWORD='local-runtime-password' \
  CVG_BOOTSTRAP_PASSWORD='cvg-local-bootstrap-password' \
  npm run verify:postgres:restore

# parar
$PGBIN/pg_ctl -D /tmp/opencode/pgdata stop
```

Se `/tmp` for limpo, recriar extraindo os debs (sem root):
`postgresql-16`, `postgresql-client-16`, `libpq5` via
`apt-get download <pkg> && dpkg -x <deb> /tmp/opencode/pg`, depois `initdb`.

## Kit de retomada — WebKit local

O bundle do Playwright sobrescreve `LD_LIBRARY_PATH`; as libs ausentes
(`libgstcodecparsers`, `libavif`, `libgav1`, `libyuv`) foram extraídas de debs e
linkadas em
`~/.cache/ms-playwright/webkit-2359/minibrowser-wpe/sys/lib/`.
Se o cache for limpo, repetir: `apt-get download gstreamer1.0-plugins-bad
libgstreamer-plugins-bad1.0-0 libavif16 libgav1-1 libyuv0` + `dpkg -x` +
`ln -s` para o diretório `sys/lib` do bundle.

## Blockers

- `BLOCKED_EXTERNAL`: DeepSeek real, provider real, staging autorizado,
  observability/SLO, load/chaos/recovery production-like, RTO/RPO, CI same-SHA
  de release, critics independentes e aprovação humana.
- `BLOCKED_ENVIRONMENT` (apenas fora do CI): matriz completa de browsers depende
  das libs linkadas acima; em CI o runner é UTC e instalado via `--with-deps`.

## Definição de pronto deste plano

- Run de CI verde no SHA do checkpoint (passos 1–41, incluindo produção
  estrutural, baseline sintético e SBOM).
- `verify:state-of-art` 30/30 no mesmo SHA, com snapshot regenerado.
- `current-state.json` `CURRENT` apontando para o SHA final e bloqueadores
  externos explícitos; relatório final atualizado.
