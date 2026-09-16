# 12 — Desempenho e escalabilidade

Baseline da auditoria: **58/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `performance, reliability`. Todas precisam da própria evidência.

Resultado executivo: Caudas, contenção e capacidade medidas com workload e ambiente definidos.

Papel líder: **Performance**. Achados de origem: A07, A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M1 | PER-01 | Congelar workload, capacidade e targets medidos |
| M3 | PER-02 | Reduzir gargalos demonstrados |
| M4 | PER-03 | Provar carga, pressão e chaos em staging |

## Backlog executável

### PER-01 — Congelar workload, capacidade e targets medidos

**P1 · M · M1 · R2**. Dependências: SUP-01, DAT-01.

Transformar hipóteses PERF/REL existentes em protocolo reproduzível com hardware, dados e concorrência.

Entradas e superfície permitida: `tests/load/`; `docs/load-and-chaos.md`; `docs/06-operacao-qualidade-e-recuperacao.md`.

Reservas exclusivas: `load-suite`, `slo-contract`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- W-A…W-H têm dataset/seed, cold/warm, ramp, steady-state e métrica p50/p95/p99
- Baseline mede login/hash, commit, RLS, fila, memória e event-loop lag
- Targets propostos continuam rotulados até decisão fundamentada; nenhum relaxamento para caber resultado

Validação planejada, ainda não executada para esta melhoria:

- npm run benchmark:local
- Executar carga local em PostgreSQL isolado e registrar baseline por operação

Artefato esperado: Contrato de benchmark e proposta fundamentada de SLO/capacidade com hardware e custo estimado; decisão necessária antes do teste final.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### PER-02 — Reduzir gargalos demonstrados

**P2 · L · M3 · R2**. Dependências: PER-01, ARC-02, ARC-03.

Otimizar hashing, queries, snapshots ou locks somente onde perfil atribuir causa.

Entradas e superfície permitida: `packages/domain/src/`; `packages/persistence/src/`; `apps/api/src/`; `tests/load/`.

Reservas exclusivas: `domain-core`, `persistence-core`, `api-root`, `load-suite`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Antes/depois com mesma carga e equipamento identifica ganho e cauda
- Hash mantém segurança/formato de credencial; filas têm limite
- Nenhum ganho degrada isolamento, atomicidade, audit ou correção

Validação planejada, ainda não executada para esta melhoria:

- npm run test:security
- npm run verify:postgres:concurrency
- Comparar perfis CPU/heap/event-loop e p95/p99 por operação

Artefato esperado: Entrega revisável de PER-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### PER-03 — Provar carga, pressão e chaos em staging

**P1 · L · M4 · R3**. Dependências: PER-02, DEV-03, WRK-03, OPS-01.

Medir capacidade sustentada, backlog, indisponibilidade e recuperação sob recursos limitados.

Entradas e superfície permitida: `tests/load/`; `scripts/verify-load.ts`; `scripts/verify-resource-pressure.ts`; `docs/load-proof.md`; `docs/chaos-proof.md`.

Reservas exclusivas: `load-suite`, `staging-load`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Targets congelados antes da execução final; relatório inclui todas as amostras/falhas
- Limites de CPU/memória/pool/queue não causam confirmação falsa ou perda de integridade
- Chaos isolado prova degradação e retorno; disponibilidade mensal não é deduzida de benchmark curto

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:load
- npm run verify:resource-pressure
- Executar tests/load/cvg-staging.k6.js conforme contrato de carga e cenários de caos

Artefato esperado: Entrega revisável de PER-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F10, F15, F16, F17, F31.

Pré-requisitos externos/decisões:

- Staging isolado, workload/capacidade/custo e fault injection autorizados; alvo não produtivo confirmado

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

