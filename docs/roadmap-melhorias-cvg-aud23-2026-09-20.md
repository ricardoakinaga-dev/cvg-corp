# Roadmap de melhorias — CVG-AUD23

> **SUPERSEDED em 2026-09-20:** a auditoria de AUD23-004 encontrou bypass runtime na API de commit, oracle de rollback inválido e fingerprint não recalculado. O plano corrente é o [roadmap CVG-AUD24](roadmap-melhorias-cvg-aud24-2026-09-20.md); este arquivo permanece histórico.

**Data-base:** 2026-09-20
**Origem:** [auditoria da entrega AUD22-002](auditoria-entrega-cvg-aud22-002-2026-09-20.md)
**Backlog:** [catálogo CVG-AUD23](backlog-melhorias-cvg-aud23-2026-09-20.md)
**Estado inicial:** `PARTIAL / REJECT / AAA_NOT_PROVEN`

## Objetivo

Transformar o progresso parcial de recovery em prova comportamental reproduzível, eliminar o false-green do control plane, selar a fronteira de restore e somente então congelar um candidato para qualificação local, externa e humana. Nenhuma evidência AUD22 é descartada; ela entra como `IMPLEMENTED_UNVERIFIED` até ser reemitida contra o subject exato.

## Caminho crítico

```text
W0 verdade operacional
  ├─ W1a PostgreSQL descartável → guard real → restore selado
  ├─ W1b exact-subject → receipts/exits → controle completo
  └─ W1c web/browser + alertas + logs
                         ↓
W3 schema final e gates não mutantes
                         ↓
W4 qualificação local 2× no mesmo fingerprint
  ├─ W5a staging/providers/observabilidade
  ├─ W5b AT/acessibilidade especialista
  ├─ W5c carga/chaos/DR
  └─ W5d CI/supply chain
                         ↓
W6 gauntlet técnico F0–F37
                         ↓
W7 decisão humana F38
```

Depois de W0, as lanes de dados, evidência e qualidade podem avançar em paralelo. O schema final só é requalificado após qualquer mudança em restore, privilégios ou logs. Autoridades externas só entram após o candidato local congelado; até lá, seus itens estão bloqueados por dependências, não pelo ambiente externo.

## W0 — verdade operacional

**Tarefa:** 001
**Saída:** o snapshot corrente conhecido-ruim reprova e o estado reconciliado possui uma única ação ativa.

- Validar dependências satisfeitas, transições, ação única, task exata, ordem física do plano, tails, timestamps, freshness e resultado.
- Preservar JSONL e receipts antigos; corrigir por eventos superseding append-only.
- Representar exits por comando e impedir que exit composto `0` encubra subprocesso `1` ou `2`.

**Gate:** todos os known-bads de controle falham; estado bom passa; promoção continua bloqueada.

## W1a — PostgreSQL e recovery

**Tarefas:** 002–006
**Saída:** o guard de usage e o restore são comportamentais, atômicos e least-privilege.

- Criar launcher PostgreSQL 16 descartável, isolado, com credenciais sintéticas, roles distintas e cleanup verificável.
- Provar known-good, dangling usage e cross-tenant no banco, com ausência de DML no erro.
- Expor um único entrypoint que recebe bundle completo, fingerprint e autoridade; remover arrays crus da fronteira pública.
- Comparar contagens e digests de todas as tabelas/ledgers antes e após falha tardia.
- Remover `GRANT ... ON ALL` dos harnesses e provar negativas para objetos atuais e futuros.

**Gate:** duas execuções limpas em PostgreSQL 16, sem reutilizar containers preexistentes e sem privilégios auxiliares.

## W1b — sujeito exato e evidência

**Tarefas:** 007–009
**Saída:** todo claim identifica exatamente os bytes e preserva o resultado real de cada comando.

- Manifestar HEAD, index, diff, untracked relevante, modos, lockfile e configurações.
- Manter evidence root fora do source; saída dos gates não muda o candidate root.
- Validar receipt, tail, fingerprint, freshness, DAG e plano no verificador e na CI.

**Gate:** mutar qualquer componente relevante invalida o receipt; exit `2` nunca é agregado como `PASS`.

## W1c — qualidade web e operação local

**Tarefas:** 010–013
**Saída:** qualidade, browsers, alertas e logs têm provas locais executáveis.

- Substituir o lint customizado como autoridade por ESLint TypeScript/React Hooks/jsx-a11y.
- Aplicar splitting e budgets; medir CWV com cenário e viewport declarados.
- Executar Chromium, Firefox e WebKit sem retries, com axe, teclado, foco, reduced motion e zoom automatizável.
- Fazer drill Prometheus→Alertmanager→receiver e implementar logs duráveis com restart, retenção, correlação, acesso auditado e redaction por valor.

**Gate:** um known-bad por propriedade e evidência fora do candidate root.

## W3 — convergência local

**Tarefa:** 014
**Saída:** schema final e todos os gates são não mutantes.

- Reexecutar clean install, upgrade, N-2/N-1/N, readiness, restore e matriz de privilégios.
- Executar build/browser/PostgreSQL em ambientes temporários com sentinela antes/depois.
- Falhar se houver processo, porta, banco, container ou arquivo temporário não limpo.

**Gate:** known-bads de versão, privilégio e mutação reprovam; subject permanece idêntico.

## W4 — candidato local congelado

**Tarefa:** 015
**Saída:** duas matrizes completas e independentes no mesmo fingerprint.

- Congelar o manifesto somente após convergência local.
- Executar sem retry e sem skip relevante: tipos, ESLint, testes, build/budgets, browsers, PDP, segurança, PostgreSQL, worker, recovery, alertas, logs, diff, proveniência e control plane.
- Reemitir evidências preservadas de AUD21/AUD22 contra o subject atual.

**Gate:** 2× `PASS`, zero P0/P1 local, zero warning de budget e zero drift.

## W5 — quatro autoridades externas

**Tarefas:** 016–019
**Saída:** quatro lanes independentes produzem evidência do mesmo candidato.

- 016: staging, providers, secrets, collector e SLO.
- 017: leitor de tela/AT e zoom manual por especialista.
- 018: carga production-like, chaos, backup/restore gerenciado e RTO/RPO.
- 019: CI same-digest, imagens, SBOM, scans, assinatura, provenance e container smoke.

**Gate:** cada lane emite receipt verificável do fingerprint de W4; quando a dependência local estiver satisfeita, a ausência de autoridade é `BLOCKED_EXTERNAL`.

## W6 — encerramento técnico

**Tarefa:** 020
**Saída:** F0–F37 em `PASS`.

- Críticos frescos, somente leitura, com mutation sentinel.
- Red teams de segurança e banco independentes.
- Repair loop invalida receipts afetados e reexecuta a matriz correspondente.

**Gate:** zero achado alto/crítico e 38/38 fases técnicas atuais.

## W7 — decisão humana

**Tarefa:** 021
**Saída:** F38 recebe decisão `APPROVE`, `REJECT` ou `DEFER` de autoridade nomeada, ligada ao fingerprint, riscos e rollback.

**Gate final:** somente `APPROVE` humano verificável permite promoção; o agente não executa nem infere esse aceite.

## Marcos

| Marco | Tarefas | Critério de saída |
|---|---|---|
| M0 controle confiável | 001 | Snapshot ruim falha; histórico corrigido passa. |
| M1 recovery real | 002–006 | PostgreSQL real, restore selado, rollback e least privilege. |
| M2 evidência exata | 007–009 | Subject, exits e receipts fail-closed. |
| M3 qualidade/operação local | 010–013 | Web, browsers, alertas e logs com known-bads. |
| M4 convergência | 014 | Schema final e gates não mutantes. |
| M5 candidato congelado | 015 | Duas rodadas completas no mesmo fingerprint. |
| M6 evidência externa | 016–019 | Quatro autoridades independentes no mesmo candidato. |
| M7 encerramento técnico | 020 | F0–F37 e zero alto/crítico. |
| M8 decisão | 021 | F38 humano verificável. |

## Regras de parada

- Qualquer dependência local insatisfeita impede tornar a tarefa externa ativa.
- Qualquer mutação do subject torna receipts anteriores `STALE`.
- `NOT_RUN`, `BLOCKED_BY_DEPENDENCIES`, `BLOCKED_EXTERNAL` e `BLOCKED_HUMAN` nunca contam como `PASS`.
- Um novo alto/crítico reabre a tarefa dona e tudo que dependa de sua evidência.
- Nenhuma promoção ocorre enquanto `AAA_NOT_PROVEN` estiver vigente.

## Próxima ação única

`CVG-AUD23-001:CONTROL-PLANE-SEMANTICS` — fazer o verificador reprovar o snapshot atual por dependência insatisfeita, ação duplicada, transições/tails/receipts incompatíveis e exit composto enganoso; em seguida reconciliar o estado somente por registros append-only.
