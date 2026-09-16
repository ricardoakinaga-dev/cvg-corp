# 11 — Testes e confiabilidade das verificações

Baseline da auditoria: **72/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `testing`. Todas precisam da própria evidência.

Resultado executivo: Gates determinísticos que rejeitam o candidato incorreto e vinculam prova ao correto.

Papel líder: **Qualidade**. Achados de origem: A03, A04.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | QUA-01 | Tornar teste de snapshot determinístico |
| M0 | QUA-02 | Produzir evidência portátil do candidato |
| M1 | QUA-03 | Isolar suites e complementar lint semântico |

## Backlog executável

### QUA-01 — Tornar teste de snapshot determinístico

**P1 · S · M0 · R2**. Dependências: AAA-000.

Desacoplar o teste negativo A03 de HEAD, dirty tree, relógio e mtimes históricos.

Entradas e superfície permitida: `tests/unit/evidence-snapshot.test.ts`; `scripts/verify-evidence-snapshot.ts`.

Reservas exclusivas: `evidence-harness`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Fixture temporária passa em checkout limpo e modificado
- Adulteração de SHA, estado, bytes, inventário e tempo é rejeitada
- Teste passa por razão correta, sem remover verificação de integridade

Validação planejada, ainda não executada para esta melhoria:

- node --import tsx --test tests/unit/evidence-snapshot.test.ts
- Executar mesma suíte em cópias clean/dirty com clock e fixture controlados

Artefato esperado: Entrega revisável de QUA-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### QUA-02 — Produzir evidência portátil do candidato

**P1 · M · M0 · R2**. Dependências: QUA-01, SUP-01.

Separar identidade de conteúdo, procedência e freshness de timestamps locais do checkout.

Entradas e superfície permitida: `scripts/verify-evidence-snapshot.ts`; `scripts/verify-static.ts`; `tests/unit/evidence-snapshot.test.ts`; `docs/release-provenance.md`.

Reservas exclusivas: `evidence-harness`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Prova rejeita artefato alterado e SHA diferente
- Checkout/cópia preservando bytes não invalida prova só por mtime recriado
- Receipts exigem execução real no candidato; não recapturam sucesso histórico sem executar

Validação planejada, ainda não executada para esta melhoria:

- node --import tsx --test tests/unit/evidence-snapshot.test.ts
- npm run verify:static
- Experimento de exportar/reimportar bundle e adulterar bytes

Artefato esperado: Entrega revisável de QUA-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F29.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### QUA-03 — Isolar suites e complementar lint semântico

**P2 · M · M1 · R2**. Dependências: QUA-02, SUP-01.

Evitar colisão de portas/dados e detectar promessas esquecidas e erros de fronteira também em testes.

Entradas e superfície permitida: `scripts/lint.ts`; `playwright.config.ts`; `tests/e2e/`; `package.json`; `package-lock.json`.

Reservas exclusivas: `e2e-shared`, `browser-config`, `dependencies`, `lint`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cada job tem portas, origem, banco, diretório de output e seed próprios
- Lint cobre testes e regras úteis com casos conhecidos bons/ruins
- Suite obrigatória distingue skip legítimo de capability não provada; nenhuma exclusão para obter verde

Validação planejada, ainda não executada para esta melhoria:

- npm run lint
- npm test
- npm run test:e2e:full
- Executar dois jobs isolados em paralelo sem estado compartilhado

Artefato esperado: Entrega revisável de QUA-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

