# 06 — Worker e resiliência

Baseline da auditoria: **80/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `workers, reliability, providerIntegration`. Todas precisam da própria evidência.

Resultado executivo: Efeitos reconciliáveis, fila limitada e retomada segura com processos reais.

Papel líder: **Worker e integrações**. Achados de origem: A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M2 | WRK-01 | Exercitar handlers reais e admissão |
| M2 | WRK-02 | Provar lease, retry, fencing e shutdown |
| M3 | WRK-03 | Concluir provider externo, receipt e reconciliação |

## Backlog executável

### WRK-01 — Exercitar handlers reais e admissão

**P1 · M · M2 · R2**. Dependências: DAT-02, AIG-01.

Executar jobs tipados com policy, auditoria, heartbeat e limites reais de fila.

Entradas e superfície permitida: `apps/worker/src/`; `tests/integration/worker-jobs.test.ts`.

Reservas exclusivas: `worker`, `jobs`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cinco handlers existentes percorrem efeitos reais locais esperados
- Job inválido/sem policy/sem auditoria não recebe acknowledge
- Backlog cheio bloqueia admissão antes do claim ou dispatch

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:worker-runtime
- npm run test:database
- Executar API e worker separados com banco efêmero

Artefato esperado: Entrega revisável de WRK-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F9, F10.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### WRK-02 — Provar lease, retry, fencing e shutdown

**P1 · M · M2 · R2**. Dependências: WRK-01.

Sobreviver a dois consumidores, perda de lease, poison message e encerramento em andamento.

Entradas e superfície permitida: `apps/worker/src/`; `packages/persistence/src/`; `tests/unit/worker.test.ts`.

Reservas exclusivas: `worker`, `persistence-core`, `jobs`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Lease vencido/fence antigo não conclui job
- Retry limitado com quarentena; redrive exige ação explícita
- Shutdown e restart não duplicam efeito nem perdem trabalho confirmado

Validação planejada, ainda não executada para esta melhoria:

- npm run test:fault
- npm run verify:postgres:concurrency
- Drill multiprocesso de kill/restart, saturation e redrive

Artefato esperado: Entrega revisável de WRK-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F9, F10, F31.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### WRK-03 — Concluir provider externo, receipt e reconciliação

**P1 · L · M3 · R3**. Dependências: WRK-02, SEC-03, DEV-02.

Provar vertical externa outbox → provider → receipt/callback → reconciliação.

Entradas e superfície permitida: `packages/integrations/`; `apps/api/src/application/integration-service.ts`; `scripts/verify-provider-real.ts`.

Reservas exclusivas: `integrations`, `external-provider`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Aceite seguido de perda de resposta permanece OUTCOME_UNKNOWN até consulta real
- Callback inválido/repetido/fora de ordem não duplica efeito
- Recibo externo e idempotency key ligam provider, organização e comando

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:provider-sandbox
- npm run verify:provider-real
- Executar matriz real de falhas e consulta externa por idempotência

Artefato esperado: Entrega revisável de WRK-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F5, F6.

Pré-requisitos externos/decisões:

- Tenant/provider sandbox externo autorizado, destinatários sintéticos e referência de segredo
- Fault injection e eventual custo autorizados

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

