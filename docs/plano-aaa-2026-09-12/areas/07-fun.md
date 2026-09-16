# 07 — Completude funcional

Baseline da auditoria: **58/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `domainIntegrity, frontend`. Todas precisam da própria evidência.

Resultado executivo: Cada jornada acordada completa o ciclo interface, autorização, commit e recibo.

Papel líder: **Produto e jornadas**. Achados de origem: A06.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | FUN-01 | Fechar inventário de jornadas e ações incompletas |
| M2 | FUN-02 | Completar entrada de estoque e inventário |
| M2 | FUN-03 | Completar jornadas clínicas e operacionais essenciais |

## Backlog executável

### FUN-01 — Fechar inventário de jornadas e ações incompletas

**P1 · S · M0 · R2**. Dependências: AAA-000.

Mapear cada CTA e jornada essencial da clínica a um resultado, policy, API e prova.

Entradas e superfície permitida: `docs/01-prd-cvg.md`; `docs/adr/`.

Reservas exclusivas: `product-contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Recepção, atendimento, diagnóstico, internação, estoque, financeiro, comunicação e admin classificados
- Cada aviso sem execução tem decisão implementar/restrição legítima com razão
- Dúvidas de clínica/estorno/alçada têm dono e condição de decisão; ausência não vira escopo eliminado

Validação planejada, ainda não executada para esta melhoria:

- Inventário de controles e rotas com rg e inspeção navegável
- Revisão do inventário contra PRD e auditoria A06

Artefato esperado: Entrega revisável de FUN-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### FUN-02 — Completar entrada de estoque e inventário

**P1 · L · M2 · R2**. Dependências: FUN-01, CON-02, DAT-01.

Trocar avisos por fluxo autorizado de lote, validade, motivo e lançamento durável.

Entradas e superfície permitida: `apps/web/src/features/stock/`; `apps/api/src/application/`; `packages/contracts/src/`; `packages/domain/src/`; `tests/e2e/`.

Reservas exclusivas: `stock`, `domain-core`, `contracts`, `e2e-shared`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Entrada válida altera saldo uma vez e produz audit/receipt
- Saldo negativo, lote inválido, sem alçada e replay conflitante negados
- UI cobre salvar, erro, conflito, cancelamento e reconexão sem confirmação falsa

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- npm run test:database
- E2E da entrada e inventário através de API real; teste concorrente de estoque

Artefato esperado: Entrega revisável de FUN-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### FUN-03 — Completar jornadas clínicas e operacionais essenciais

**P1 · L · M2 · R3**. Dependências: FUN-01, CON-02, FIN-02, DAT-01.

Entregar as jornadas acordadas no inventário, sem CTAs habilitados que terminem em aviso genérico.

Entradas e superfície permitida: `apps/web/src/features/clinical/`; `apps/web/src/features/agenda/`; `apps/web/src/features/patients/`; `apps/api/src/application/`; `packages/domain/src/`; `tests/e2e/`.

Reservas exclusivas: `clinical`, `domain-core`, `e2e-shared`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cada jornada essencial registrada em FUN-01 possui teste UI→API→commit→receipt
- Rascunho, assinatura, addendum, diagnóstico/internação e comunicações preservam alçadas
- Capacidade indisponível por provider tem estado explícito; fallback manual continua útil

Validação planejada, ainda não executada para esta melhoria:

- npm run test:security
- npm run test:database
- E2E por jornada com erros, conflito, aprovação e replay

Artefato esperado: Entrega revisável de FUN-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Pré-requisitos externos/decisões:

- Responsável clínico valida regras ambíguas antes de novos atos de alto impacto; parte técnica já especificada pode avançar

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

