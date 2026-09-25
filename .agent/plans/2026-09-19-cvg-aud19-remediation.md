# ExecPlan: Remediação da auditoria de código CVG-AUD19 (001–030)

<!-- status: ACTIVE; active_action_id: CVG-AUD19-002:KNOWN-BAD-HARNESS -->

## Outcome

Executar integralmente o programa de remediação definido por:

- `docs/auditoria-codigo-2026-09-19.md` (contrato/relatório, imutável);
- `docs/roadmap-remediacao-auditoria-2026-09-19.md` (sequência e gates);
- `docs/backlog-remediacao-auditoria-2026-09-19.md` (catálogo de itens).

Status canônico de execução: `.agent/backlog.json` (itens `CVG-AUD19-*`). Os
documentos em `docs/` permanecem PROPOSTO/histórico e não são reescritos.

Resultado final local: todos os itens localmente executáveis `DONE` com
evidência `CURRENT` no mesmo sujeito; nenhum achado HIGH/CRITICAL local aberto;
`CVG-AUD19-030` bloqueado por autoridade humana; verticais externas
(`CVG-AUD19-028`) e itens dependentes de ambiente autorizado permanecem
`BLOCKED_EXTERNAL` com evidência honesta.

## Context

- Perfil BROWNFIELD, tier T4, risco CRITICAL.
- Modo primário BUILD/REMEDIATION; overlays SECURITY, AUTHORIZATION, MIGRATION,
  DATA, CONCURRENCY, RECOVERY, INTEGRATION, OPERATIONS, AUDIT.
- Quality bar congelado: `.gauntlet/bar-v4.json` + tabela dos 22 critérios da
  auditoria (média 75/100, veredito FAIL/REJECT, confiança alta).
- SHA auditado: `c990914148a8f375082cd12bbdb2ad20cfe1900f`.
- Estado de partida do control plane: `.agent/state.json` revisão 353, plano
  CI-CLOSURE (programa distinto, preservado como histórico).
- Plano anterior: `.agent/plans/2026-09-17-embedded-runtime-ci-closure.md`
  (NÃO é este programa; não reutilizar evidência).

## Restrições de autoridade

Autorizado: editar código/testes/migrations/config/scripts/docs do repositório;
criar ambientes locais descartáveis; executar PostgreSQL local, browsers,
Docker local, verificadores; atualizar ExecPlan/backlog/evidência de forma
reconciliada; subagentes em frentes independentes.

Proibido: deploy, dados reais, credenciais/providers externos sem autorização,
break-glass, aceitar risco alto/crítico por humano, marcar aprovação humana,
commit/push/merge/PR sem pedido explícito, apagar/reverter trabalho preexistente.

## Milestones e itens

| Marco | Itens | Gate de saída |
|---|---|---|
| M0 Contenção e harness | 001–003 | G0: conhecido-ruim falha antes, passa depois; zero metadados estrangeiros no provider-capture |
| M1 Autorização e sessões | 004–008 | G1: matriz de escopo same/cross em API+persistence; TTL/lease/exclusão mútua |
| M2 Banco, persistência e recovery | 009–014 | G2: readiness exige 038/039; bundle/restore integral; grants mínimos; store isolado por request |
| M3 Workers e efeitos | 015–017 | G3: sucesso só após ack; cancelamento cooperativo; matriz adversarial multi-instância |
| M4 Frontend e operação | 018–023 | G4: contratos fail-closed; error boundary; alerta entregue; logs duráveis; budgets/lint/flaky |
| M5 Evidência e promoção | 024–030 | G5: proveniência exact-SHA; exit não zero para bloqueio; matriz browsers; reauditoria; decisão humana (030 BLOCKED) |

Dependências: ver tabela do backlog em `docs/backlog-remediacao-auditoria-2026-09-19.md`.

## Known-bad congelados (antes do BUILD)

1. `AUD-2026-001`: usuário do workspace A informa `resourceId` de encounter do
   workspace B na mesma organização com `encounterId` autenticado ausente;
   o executor retorna `COMPLETED` com dados do encounter estrangeiro.
   Prova alvo: HTTP `/api/v1/ai/turns` com provider-capture; zero bytes
   estrangeiros no input do provider e zero dispatch da tool.
2. `AUD-2026-004`: sessão com TTL de 10 ms ainda carrega/recebe lease após
   11 ms; reaquisição pelo mesmo owner incrementa fence com execução ativa;
   chaves idempotentes diferentes permitem sobreposição na mesma sessão.
   Prova alvo: relógio determinístico nos stores memory e PostgreSQL.
3. `AUD-2026-003`: `assertSchema` aceita schema 037; `/ready` verde sem 038/039.
4. `AUD-2026-002`: bundle de recovery omite `agent_sessions`, `agent_turns`,
   `agent_checkpoints`, `agent_leases`.
5. `AUD-2026-007`: auditoria/métrica de sucesso emitidas antes de
   `complete/acknowledge`; timeout por `Promise.race` sem cooperação.
6. `AUD-2026-005`: rotas remotas de IA hidratam/mutam store singleton antes do
   commit, com snapshot após reaquisição da trava.
7. `AUD-2026-006`: papel `cvg_runtime` provavelmente retém DML de 022 sobre
   038/039 sem REVOKE explícito.
8. `AUD-2026-009`: contratos frontend com `passthrough` e conversão cega;
   `Overview` desreferencia `.items`; raiz sem error boundary.
9. `AUD-2026-010`: Prometheus sem `alerting.alertmanagers`; logs só em buffer.
10. `AUD-2026-011`: evidência em SHA divergente do HEAD; gate de proveniência
    aceita `WORKTREE` com qualquer sujeira.
11. `verify:state-of-art-external` retorna exit zero com requisito obrigatório
    `BLOCKED_EXTERNAL`.

## Protocolo por item

1. Reproduzir/observar o defeito (known-bad) e registrar comando+resultado.
2. Implementar a menor fatia vertical coerente.
3. Rodar teste focal; rodar regressão afetada.
4. Inspecionar resposta/persistência/efeitos/telemetria.
5. Self-review + crítico independente de contexto fresco para P0/gates.
6. Atualizar artefato/tarefa → backlog → evidência append-only → state por último.

## Comandos de prova (descobertos do package.json)

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run verify:architecture && npm run verify:pdp-universal
npm run verify:authoritative-writes && npm run verify:security-red-team
npm run verify:agent-security && npm run verify:audit-chain
npm run verify:agent-runtime && npm run verify:embedded-harness
npm run verify:worker-runtime && npm run verify:static
npm run verify:production && npm run verify:triplo-aaa
npm audit --audit-level=high && npm audit --omit=dev
```

PostgreSQL local descartável (kit em
`.agent/plans/2026-09-17-embedded-runtime-ci-closure.md`, seção "Kit de
retomada"):
`db:migrate`, `verify:postgres`, `verify:postgres:concurrency`,
`verify:postgres:restore`.

## Estado atual

- [x] M0 — DONE local: known-bad cross-workspace e TTL reproduzidos; contencao
  autoritativa e harness permanente; `VER-CVG-AUD19-M0-001`.
- [x] M1 — DONE local (com ressalvas): PDP/tool gateway com facts resolvidos,
  actor scope, TTL/lease/mutex em memoria e PostgreSQL real descartavel;
  `VER-CVG-AUD19-M1-001/002/003`; criticas frescas em 2 rodadas.
- [x] M2 — DONE local: readiness 038/039, recovery bundle/restore, grants mínimos,
  isolamento de store por request (ADR 034); `VER-CVG-AUD19-M2-001..004`.
- [x] M3 — DONE local: sucesso após ack durável, cancelamento cooperativo e
  matriz adversarial em PostgreSQL descartável; `VER-CVG-AUD19-M3-001/002`.
- [~] M4 — PARCIAL: 018/019/020 DONE; 021/023 PARTIAL (estrutura sem prova
  operacional); 022 BLOCKED (logs duráveis não implementados).
- [ ] M5 — BLOCKED: 024–030 dependem de proveniência exact-SHA, exit semântico
  externo, matriz de browsers, provas operacionais, staging autorizado,
  reauditoria independente e decisão humana. Nada foi convertido em PASS.

## Blockers

- `CVG-AUD19-030` BLOCKED por autoridade humana (não executável por automação).
- `CVG-AUD19-028` BLOCKED_EXTERNAL (staging/providers reais sem autorização).
- Itens de M5 dependentes de ambiente autorizado permanecem BLOCKED_ENVIRONMENT
  quando não houver prova local válida; nunca convertidos em PASS.
