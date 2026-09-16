# 13 — Observabilidade e recuperação

Baseline da auditoria: **72/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `observability, recovery`. Todas precisam da própria evidência.

Resultado executivo: Incidentes detectados, alertas recebidos e restauração medida sem perda de autoridade.

Papel líder: **SRE e recuperação**. Achados de origem: A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M3 | OPS-01 | Provar traces, métricas e entrega de alertas |
| M3 | OPS-02 | Operar backup criptografado e retenção |
| M4 | OPS-03 | Medir RTO/RPO e executar runbooks |

## Backlog executável

### OPS-01 — Provar traces, métricas e entrega de alertas

**P1 · M · M3 · R3**. Dependências: DEV-02, WRK-01.

Detectar falhas reais do processo até o destinatário de teste com correlação e redaction.

Entradas e superfície permitida: `packages/ops/`; `docker/observability/`; `docs/observability-production.md`.

Reservas exclusivas: `observability`, `staging-observability`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- HTTP→job→provider compartilha correlação consultável sem payload sensível
- Indisponibilidade do collector e fila de export não quebram domínio
- Alerta dispara, chega ao canal de teste autorizado, resolve e aponta runbook

Validação planejada, ainda não executada para esta melhoria:

- node --import tsx --test tests/unit/ops.test.ts
- Drill de falha com collector, dashboard e receptor de alerta reais

Artefato esperado: Entrega revisável de OPS-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F13, F14.

Pré-requisitos externos/decisões:

- Collector/staging e canal de alerta de teste autorizados; não enviar mensagens a pessoas sem autorização

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### OPS-02 — Operar backup criptografado e retenção

**P1 · M · M3 · R3**. Dependências: DAT-02, DEV-02, SEC-03.

Executar agendamento real de backup, retenção e restauração de objetos com autoridade de chave.

Entradas e superfície permitida: `apps/worker/src/operational-backup.ts`; `scripts/verify-backup-retention.ts`; `docs/runbooks/backup.md`.

Reservas exclusivas: `backup`, `recovery-storage`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Backup automático atômico inclui manifest, watermark e digests
- Chave errada/tamper recusados; rotação/retention preservam cópias elegíveis
- Destino governado e acesso mínimo; nenhuma chave ou dump real no Git

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:backup-retention
- Drill de backup agendado, retenção e recuperação de chave em destino de teste

Artefato esperado: Entrega revisável de OPS-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F20.

Pré-requisitos externos/decisões:

- Storage de backup e chave gerenciada de teste autorizados; política de retenção e custos definidos

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### OPS-03 — Medir RTO/RPO e executar runbooks

**P1 · L · M4 · R3**. Dependências: OPS-01, OPS-02, DAT-04, DEV-03.

Provar recuperação por operador que não escreveu o procedimento e medir o tempo real.

Entradas e superfície permitida: `docs/runbooks/`; `scripts/verify-runbook-execution.ts`; `docs/recovery-proof-final.md`.

Reservas exclusivas: `runbooks`, `recovery-db`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- RTO e RPO medidos por relógio/eventos com dataset completo e limites decididos
- Cenários F35 exigidos executados, inclusive rollback/quarentena/credencial/outage
- Erro de procedimento gera correção e repetição; dry-run não substitui o efeito requerido

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:runbook-execution
- npm run verify:postgres:restore
- Drill cronometrado com operador independente e eventos pós-backup

Artefato esperado: Entrega revisável de OPS-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F18, F19, F35.

Pré-requisitos externos/decisões:

- Operador independente, ambiente de recuperação e intervenções autorizados; janelas e metas operacionais definidas

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

