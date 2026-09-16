# 08 — Correção do financeiro

Baseline da auditoria: **50/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `domainIntegrity, reliability`. Todas precisam da própria evidência.

Resultado executivo: Saldo, pagamentos, estornos e apresentação concordam com o ledger.

Papel líder: **Financeiro**. Achados de origem: A02.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | FIN-01 | Definir saldo e mapear semântica financeira existente |
| M1 | FIN-02 | Corrigir resumo e completar cobrança |
| M4 | FIN-03 | Provar invariantes financeiras e reconciliação |
| M2 | FIN-04 | Resolver e implementar regras ambíguas de estorno |

## Backlog executável

### FIN-01 — Definir saldo e mapear semântica financeira existente

**P1 · S · M0 · R2**. Dependências: CON-01, FUN-01.

Especificar saldo pendente e interpretação de estorno sem deduzir política contábil de um badge.

Entradas e superfície permitida: `docs/adr/`; `packages/contracts/src/`.

Reservas exclusivas: `financial-contract`, `contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Tabela de exemplos em centavos cobre OPEN, parcial, PAID e casos de estorno já especificados
- Semântica não especificada fica registrada para FIN-04; não bloqueia correção de PAID
- API e UI compartilham contrato e regra de arredondamento; nenhum float monetário

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- Confrontar exemplos com ledger e contratos existentes; encaminhar ambiguidades para FIN-04

Artefato esperado: Entrega revisável de FIN-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### FIN-02 — Corrigir resumo e completar cobrança

**P1 · M · M1 · R2**. Dependências: FIN-01.

Mostrar saldo devido correto e oferecer criação autorizada de cobrança com recibo.

Entradas e superfície permitida: `apps/web/src/features/finance/`; `apps/api/src/application/read-services.ts`; `apps/api/src/app.ts`; `packages/domain/src/`; `tests/e2e/`.

Reservas exclusivas: `finance`, `api-root`, `domain-core`, `e2e-shared`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cobrança PAID de R$100 resulta em zero aberto no caso A02
- Parcial usa restante; REFUNDED é identificado sem fingir saldo conhecido quando faltar regra de FIN-04
- Criação/double-click/retry não duplica cobrança; UI mostra erro ou confirmação real

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- npm run test:database
- E2E financeiro com API e dados reais de teste: pago, parcial, estorno, retry

Artefato esperado: Entrega revisável de FIN-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### FIN-03 — Provar invariantes financeiras e reconciliação

**P1 · M · M4 · R3**. Dependências: FIN-02, FIN-04, DAT-02, WRK-03.

Validar ledger e saldo sob sequência aleatória, pagamento duplicado, estorno e crash.

Entradas e superfície permitida: `tests/unit/domain.test.ts`; `tests/integration/`; `docs/usage-settlement-proof.md`.

Reservas exclusivas: `financial-tests`, `staging-db`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Sequências reproduzíveis preservam equações financeiras e limites em centavos
- Dois processos e callback repetido não duplicam liquidação
- API, resumo, ledger e export concordam após restart

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:postgres:concurrency
- Teste de propriedades financeiras com seed e falha mínima preservados
- Drill com receipt externo e reconciliação

Artefato esperado: Entrega revisável de FIN-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F7, F26.

Pré-requisitos externos/decisões:

- Provider de teste e cenários financeiros externos autorizados

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### FIN-04 — Resolver e implementar regras ambíguas de estorno

**P1 · M · M2 · R3**. Dependências: FIN-01, FIN-02.

Fechar decisão de dívida reaberta/cancelada, parcialidade e alçadas antes do aceite financeiro integral.

Entradas e superfície permitida: `docs/adr/`; `packages/contracts/src/`; `packages/domain/src/`; `apps/web/src/features/finance/`.

Reservas exclusivas: `financial-contract`, `contracts`, `domain-core`, `finance`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Responsável financeiro resolve casos abertos com exemplos e decisão rastreável
- Implementação e UI respeitam a decisão; migration somente se necessária e forward
- Todas as combinações de pagamento e estorno conciliam saldo e ledger

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- npm run test:database
- Revisão dos exemplos pelo responsável e E2E das regras decididas

Artefato esperado: Entrega revisável de FIN-04: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Pré-requisitos externos/decisões:

- Decisão do responsável financeiro apenas para regras não definidas no produto; A02 pode ser corrigido antes desta tarefa

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

