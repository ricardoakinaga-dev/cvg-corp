# 01 — Arquitetura e manutenção

Baseline da auditoria: **72/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `architecture`. Todas precisam da própria evidência.

Resultado executivo: Fronteiras pequenas e testáveis, sem regressão de comportamento nem reescrita geral.

Papel líder: **Arquitetura**. Achados de origem: A07, A09.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | ARC-01 | Mapear fronteiras e reservar arquivos compartilhados |
| M2 | ARC-02 | Extrair composição da API e serviços por domínio |
| M2 | ARC-03 | Separar persistência por responsabilidade |

## Backlog executável

### ARC-01 — Mapear fronteiras e reservar arquivos compartilhados

**P2 · S · M0 · R2**. Dependências: AAA-000.

Definir recortes por domínio e uma matriz de donos para API, store, persistência, contratos e lockfile.

Entradas e superfície permitida: `docs/adr/`; `docs/architecture-audit-vNext.md`.

Reservas exclusivas: `architecture-docs`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Inventário cita callers, rotas e testes reais
- Cada extração tem comportamento observável preservado e estratégia de compatibilidade
- Nenhuma extração obrigatória motivada apenas por número de linhas

Validação planejada, ainda não executada para esta melhoria:

- Revisão de imports e consumidores com rg
- Revisão independente do mapa e de um exemplo de fluxo transacional

Artefato esperado: Entrega revisável de ARC-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### ARC-02 — Extrair composição da API e serviços por domínio

**P2 · L · M2 · R2**. Dependências: ARC-01, SEC-01, FIN-02, FUN-02, FUN-03.

Reduzir concentração preservando endpoints, autorização, idempotência e transações.

Entradas e superfície permitida: `apps/api/src/`; `packages/domain/src/`; `tests/integration/api.test.ts`.

Reservas exclusivas: `api-root`, `domain-core`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Inventário HTTP e envelopes antes/depois equivalentes para contratos preservados
- Nenhuma mutação contorna application service
- Testes negativos e jornadas continuam aprovados

Validação planejada, ainda não executada para esta melhoria:

- npm run typecheck
- npm run verify:pdp-universal
- npm test
- npm run test:e2e

Artefato esperado: Entrega revisável de ARC-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### ARC-03 — Separar persistência por responsabilidade

**P2 · L · M2 · R2**. Dependências: ARC-01, DAT-03, WRK-02.

Extrair módulos de transação, repositories, fila e recuperação sem mudar atomicidade.

Entradas e superfície permitida: `packages/persistence/src/`; `tests/integration/persistence.test.ts`.

Reservas exclusivas: `persistence-core`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Interface pública compatível ou migração explícita dos consumidores
- Rollback e CAS continuam atravessando a mesma transação
- Código extraído é alcançado em prova real de PostgreSQL

Validação planejada, ainda não executada para esta melhoria:

- npm run test:database
- npm run verify:authoritative-writes
- npm run verify:postgres
- npm run verify:postgres:concurrency

Artefato esperado: Entrega revisável de ARC-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

