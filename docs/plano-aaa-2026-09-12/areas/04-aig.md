# 04 — Governança de IA

Baseline da auditoria: **86/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `aiGovernance, toolGateway, deepseek`. Todas precisam da própria evidência.

Resultado executivo: Motor real governado, sem promoção de rascunho ou efeito sem autoridade.

Papel líder: **IA**. Achados de origem: A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M1 | AIG-01 | Fechar PDP, tools, budgets e efeitos locais |
| M3 | AIG-02 | Executar vertical DeepSeek real |
| M4 | AIG-03 | Provar falhas do motor e settlement de uso |

## Backlog executável

### AIG-01 — Fechar PDP, tools, budgets e efeitos locais

**P1 · M · M1 · R2**. Dependências: CON-01.

Provar negação por padrão, reserva de budget e separação entre resposta/draft/efeito.

Entradas e superfície permitida: `packages/agent-policy/`; `packages/agent-tools/`; `packages/harness/`; `tests/unit/vnext.test.ts`.

Reservas exclusivas: `pdp`, `tools`, `harness`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Prompt injection, retry e nested calls não ampliam autoridade
- Aprovação vencida/revogada e budget esgotado impedem dispatch
- Nenhum texto do modelo é fonte transacional ou assinatura clínica

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:pdp-universal
- npm run test:security
- Testes de orçamento, replay, cancelamento e aprovação com casos bons e ruins

Artefato esperado: Entrega revisável de AIG-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F1.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### AIG-02 — Executar vertical DeepSeek real

**P1 · L · M3 · R3**. Dependências: AIG-01, SEC-03, DEV-02.

Conectar engine identificado ao bridge, runtime e tools CVG sem fallback silencioso.

Entradas e superfície permitida: `packages/deepseek-bridge/`; `packages/harness-adapters/`; `packages/agent-runtime/`; `apps/deepseek-bridge/`.

Reservas exclusivas: `deepseek`, `external-ai`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Engine commit, manifest, toolset, modelo e configuração ligados ao candidato
- Turno real atravessa sessão, tool governada, aprovação e replay
- Sem credencial/endpoints: BLOCKED, nunca fixture promovida como real

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:deepseek-acp
- npm run verify:deepseek-real
- Executar vertical com dados sintéticos e recibos reais

Artefato esperado: Entrega revisável de AIG-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F3.

Pré-requisitos externos/decisões:

- Endpoint DeepSeek e runtime reais autorizados
- Teto de custo, modelo/versão e referências de segredo definidos

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### AIG-03 — Provar falhas do motor e settlement de uso

**P1 · L · M4 · R3**. Dependências: AIG-02, WRK-03.

Tratar queda, timeout, cancellation, restart e usage tardio sem efeito ou cobrança duplicada.

Entradas e superfície permitida: `packages/deepseek-bridge/`; `packages/agent-runtime/`; `packages/harness-adapters/`; `tests/unit/deepseek-acp.test.ts`.

Reservas exclusivas: `deepseek`, `external-ai`, `usage-ledger`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Matriz de falhas real cobre antes/depois de dispatch e retorno perdido
- Reserva, usage e settlement conciliam eventos duplicados/fora de ordem
- Usage ausente não se transforma em custo zero ou sucesso fictício

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:deepseek-real
- Exercitar falhas e reconciliar ledger de uso com recibos do provider

Artefato esperado: Entrega revisável de AIG-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F4, F26.

Pré-requisitos externos/decisões:

- Motor/provider e teto de custo autorizados; fault injection no ambiente de teste

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

