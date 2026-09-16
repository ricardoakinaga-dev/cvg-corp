# 02 — Contratos e validação de entrada

Baseline da auditoria: **88/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `domainIntegrity, authorization`. Todas precisam da própria evidência.

Resultado executivo: Contratos executáveis e compatíveis, validados em cada fronteira de confiança.

Papel líder: **Contratos**. Achados de origem: evolução derivada dos contratos e da meta AAA.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | CON-01 | Congelar contratos necessários às primeiras jornadas |
| M1 | CON-02 | Validar payloads também no cliente |
| M2 | CON-03 | Provar compatibilidade e catálogo após integração |

## Backlog executável

### CON-01 — Congelar contratos necessários às primeiras jornadas

**P1 · S · M0 · R2**. Dependências: AAA-000.

Definir compatibilidade, erros, recibos e ciclo de sessão/saldo antes dos consumidores paralelos.

Entradas e superfície permitida: `docs/adr/`; `packages/contracts/src/`.

Reservas exclusivas: `contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Versão e exemplos de sucesso/erro/estado parcial registrados
- Logout não promete revogação sem servidor
- Saldo pendente e estados financeiros têm contrato sem regra de estorno inventada

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- Revisão de schemas, consumidores e decisões pendentes com donos SEC e FIN

Artefato esperado: Entrega revisável de CON-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### CON-02 — Validar payloads também no cliente

**P2 · M · M1 · R2**. Dependências: CON-01, SEC-01, FIN-01.

Rejeitar payload semanticamente inválido mesmo dentro de envelope válido.

Entradas e superfície permitida: `apps/web/src/api/`; `packages/contracts/src/`; `tests/unit/contracts.test.ts`.

Reservas exclusivas: `web-client`, `contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Respostas incorretas de sessão, contexto e financeiro não chegam ao estado da UI
- Erros preservam correlationId e feedback sem expor payload sensível
- Fluxos válidos compatíveis continuam funcionando

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- npm run typecheck
- E2E com interceptações malformadas por recurso e versão

Artefato esperado: Entrega revisável de CON-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### CON-03 — Provar compatibilidade e catálogo após integração

**P2 · M · M2 · R2**. Dependências: CON-02, ARC-02, ARC-03.

Versionar contratos e impedir divergência entre schemas, rotas e clientes.

Entradas e superfície permitida: `packages/contracts/src/`; `tests/integration/route-catalog.test.ts`; `docs/api-compatibility-proof.md`.

Reservas exclusivas: `contracts`, `route-catalog`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Catálogo runtime completo e sem rota sensível sem policy
- Consumidor versão anterior suportada tem prova real de compatibilidade
- Versões não suportadas falham explicitamente

Validação planejada, ainda não executada para esta melhoria:

- npm run test:contract
- npm run verify:pdp:runtime
- npm run verify:pdp-universal

Artefato esperado: Entrega revisável de CON-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

