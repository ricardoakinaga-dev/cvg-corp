# 16 — Documentação e rastreabilidade

Baseline da auditoria: **60/100**. Meta de planejamento da área: **≥ 95/100**, sem substituir os limiares individuais das dimensões `productionReadiness`. Todas precisam da própria evidência.

Resultado executivo: Uma fonte canônica de estado; decisões, tarefas e evidências recuperáveis por outro agente.

Papel líder: **Documentação e coordenação**. Achados de origem: A04.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | AAA-000 | Ativar o plano e reconciliar o estado existente |
| M0 | DOC-01 | Conciliar catálogo novo com histórico e fontes |
| M2 | DOC-02 | Manter decisões e manual de operação por tarefa |
| M5 | DOC-03 | Auditar evidência final e eliminar contradições |

## Backlog executável

### AAA-000 — Ativar o plano e reconciliar o estado existente

**P1 · S · M0 · R2**. Dependências: nenhuma; tarefa inicial.

Preparar execução retomável sem apagar os dois itens históricos ou registrar melhoria inexistente.

Entradas e superfície permitida: `.agent/state.json`; `.agent/backlog.json`; `.agent/plans/`; `.agent/execution-log.jsonl`; `.agent/verification.jsonl`.

Reservas exclusivas: `control-plane`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- SHA e dirty tree reais registrados; snapshot histórico marcado como antecedente
- IDs deste catálogo incorporados uma única vez no backlog canônico sob CVG-FULL-STATE-OF-THE-ART
- Plano ativo, next_action, dependências e log concordam; nenhum item de implementação vira DONE por planejamento

Validação planejada, ainda não executada para esta melhoria:

- Inspecionar git status --short e git rev-parse HEAD
- Validar invariantes do control plane com a versão da skill disponível e registrar comando/resultado

Artefato esperado: Plano de execução ativo em .agent/plans e importação idempotente de IDs, com decisões de reconciliação.

Fases vinculadas: F0.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DOC-01 — Conciliar catálogo novo com histórico e fontes

**P1 · S · M0 · R2**. Dependências: AAA-000.

Impedir que notas locais substituam scorecard de promoção ou que histórico seja tratado como prova atual.

Entradas e superfície permitida: `docs/README.md`; `docs/12-estado-da-implementacao.md`; `docs/08-rastreabilidade-e-decisoes.md`.

Reservas exclusivas: `docs-index`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Índice aponta auditoria, plano, dono do status e barra ativa
- F0–F38 usam numeração do prompt final, sem misturar versão anterior
- Histórico preservado com vínculo ao SHA observado e limitações

Validação planejada, ainda não executada para esta melhoria:

- Verificar links locais, IDs e referências normativas
- Comparar catálogo com .agent/backlog.json sem duplicar status mutáveis

Artefato esperado: Entrega revisável de DOC-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F0.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DOC-02 — Manter decisões e manual de operação por tarefa

**P2 · M · M2 · R2**. Dependências: DOC-01, FUN-01, CON-01.

Atualizar instruções a partir dos contratos integrados e deixar handoff recuperável.

Entradas e superfície permitida: `docs/adr/`; `docs/README.md`; `docs/08-rastreabilidade-e-decisoes.md`.

Reservas exclusivas: `docs-index`, `product-contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cada mudança pública possui exemplo, erro, compatibilidade e procedimento de recuperação
- Decisões pendentes têm dono, alternativa e condição de resolução
- Outro agente retoma um item pelo pacote sem histórico de conversa

Validação planejada, ainda não executada para esta melhoria:

- Exercício de handoff com agente de contexto novo
- Verificação de links, comandos disponíveis e rastreabilidade por IDs

Artefato esperado: Entrega revisável de DOC-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DOC-03 — Auditar evidência final e eliminar contradições

**P1 · M · M5 · R2**. Dependências: DOC-02, QUA-03, DEV-03.

Produzir dossiê do candidato com conclusões reproduzíveis e limitações explícitas.

Entradas e superfície permitida: `docs/README.md`; `docs/12-estado-da-implementacao.md`; `docs/final-operational-proof-audit.md`.

Reservas exclusivas: `docs-index`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Nenhuma afirmação de execução sem receipt válido do sujeito
- Todas as 16 áreas ligadas às 22 dimensões e todos A01–A09 têm resolução ou risco explícito
- Notas da auditoria histórica não são sobrescritas ou usadas como nota AAA atual

Validação planejada, ainda não executada para esta melhoria:

- Auditar matriz tarefa→fase→gate→artefato→digest→SHA
- Conferir comandos e outputs por amostragem orientada a risco

Artefato esperado: Entrega revisável de DOC-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

