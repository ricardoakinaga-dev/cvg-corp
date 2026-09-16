# 03 — Autenticação, autorização e sessão

Baseline da auditoria: **76/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `security, authentication, authorization, pdp`. Todas precisam da própria evidência.

Resultado executivo: Identidade, escopo e revogação corretos sob falha; nenhuma autorização implícita.

Papel líder: **Segurança**. Achados de origem: A01, A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M1 | SEC-01 | Corrigir logout sob falha e reconexão |
| M2 | SEC-02 | Provar matriz de autorização e revogação |
| M3 | SEC-03 | Integrar autoridade de segredo e WebAuthn reais |
| M4 | SEC-04 | Executar red-team da aplicação e do banco |

## Backlog executável

### SEC-01 — Corrigir logout sob falha e reconexão

**P1 · M · M1 · R2**. Dependências: CON-01.

Informar saída local e revogação pendente com honestidade, sem recuperar conteúdo como se logout confirmado tivesse ocorrido.

Entradas e superfície permitida: `apps/web/src/hooks/use-session.ts`; `apps/web/src/app-shell/App.tsx`; `apps/web/src/state/`; `apps/web/src/components/SessionBlockedState.tsx`; `tests/e2e/`.

Reservas exclusivas: `web-session`, `e2e-shared`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Reprodução A01 falha no candidato antigo e regressão correta passa no novo
- Sucesso revoga cookie/sessão; erro, offline, recarga e reconexão têm comportamento explícito
- Sem unhandled rejection, persistência de rascunho sensível ou remoção de CSRF

Validação planejada, ainda não executada para esta melhoria:

- npm run test:security
- npm run typecheck
- E2E dedicado de logout: sucesso, abort, 5xx, offline, recarga e reconexão

Artefato esperado: Entrega revisável de SEC-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### SEC-02 — Provar matriz de autorização e revogação

**P1 · M · M2 · R2**. Dependências: SEC-01, DAT-01.

Cobrir actor/action/resource/context, MFA, revogação e tentativas entre organizações/unidades.

Entradas e superfície permitida: `packages/auth/`; `packages/agent-policy/`; `apps/api/src/application/break-glass-service.ts`; `tests/unit/auth.test.ts`; `tests/integration/faults.test.ts`.

Reservas exclusivas: `auth-core`, `pdp`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Todos os negativos registrados negam sem efeito nem vazamento de existência
- Revogação vale no próximo boundary online antes de leitura/escrita
- Rotas, tools, services e repositories respeitam admissão

Validação planejada, ainda não executada para esta melhoria:

- npm run test:security
- npm run verify:pdp-universal
- npm run verify:postgres

Artefato esperado: Entrega revisável de SEC-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F1.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### SEC-03 — Integrar autoridade de segredo e WebAuthn reais

**P1 · L · M3 · R3**. Dependências: SEC-02, DEV-02.

Exercitar referências de segredo, rotação/revogação e break-glass com identidade real autorizada.

Entradas e superfície permitida: `packages/auth/`; `packages/integrations/`; `packages/config/`; `apps/api/src/application/break-glass-service.ts`.

Reservas exclusivas: `auth-core`, `integrations`, `config`, `external-identity`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Chave nunca entra no frontend, prompt ou logs
- WebAuthn prova registro/assertion, challenge, origem, rpId, replay e revogação
- Break-glass tem escopo, expiração, justificativa, decisão independente e trilha durável

Validação planejada, ainda não executada para esta melhoria:

- npm run test:security
- Drill em staging de indisponibilidade/rotação do secret provider e replay de assertion

Artefato esperado: Entrega revisável de SEC-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F11, F12.

Pré-requisitos externos/decisões:

- Ambiente e tenant de teste autorizados
- Secret provider e identidade WebAuthn com responsáveis; referências injetadas fora dos documentos

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### SEC-04 — Executar red-team da aplicação e do banco

**P1 · L · M4 · R3**. Dependências: SEC-03, DAT-04, AIG-03, DEV-03.

Produzir provas separadas F23/F24 e fechar falhas exploráveis no candidato integrado.

Entradas e superfície permitida: `tests/integration/`; `tests/unit/edge-security.test.ts`; `docs/security-red-team-final.md`.

Reservas exclusivas: `red-team-suite`, `staging-db`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- F23-01 a F23-16 e F24-01 a F24-08 possuem execução e achados rastreados
- Sem CRITICAL/HIGH aberto; correções reexecutam ataques originais
- Review assinado independente e artefatos separados não são substituídos por fixtures locais

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:security-red-team
- Executar matriz hostil em staging isolado e PostgreSQL com role não privilegiada

Artefato esperado: Entrega revisável de SEC-04: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F23, F24.

Pré-requisitos externos/decisões:

- Escopo de ataque e ambientes autorizados; revisor independente disponível

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

