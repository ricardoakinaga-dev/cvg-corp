# 15 — CI/CD e prontidão para produção

Baseline da auditoria: **45/100**. Meta de planejamento da área: **≥ 96/100**, sem substituir os limiares individuais das dimensões `devOps, productionReadiness`. Todas precisam da própria evidência.

Resultado executivo: Mesmo candidato atravessa CI, staging, smoke, promoção e decisão humana.

Papel líder: **Plataforma e release**. Achados de origem: A04, A05, A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M1 | DEV-01 | Restaurar CI verde e gate local reproduzível |
| M0 | DEV-02 | Preparar ambiente alvo e contratos operacionais |
| M3 | DEV-03 | Executar staging e container smoke integral |
| M5 | DEV-04 | Congelar candidato e obter Gauntlet final |
| M5 | DEV-05 | Decisão humana e promoção controlada |

## Backlog executável

### DEV-01 — Restaurar CI verde e gate local reproduzível

**P1 · M · M1 · R2**. Dependências: QUA-02, SUP-01.

Passar gates no checkout limpo sem mascarar teste falho ou fazer recaptura histórica.

Entradas e superfície permitida: `.github/workflows/ci.yml`; `scripts/verify-production.ts`; `scripts/verify-static.ts`.

Reservas exclusivas: `ci`, `evidence-harness`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- CI executa instalação, lint, typecheck, testes, build, banco efêmero e browsers
- Falha é atribuída a procedimento/ambiente e impede promoção
- Gates e SBOM do mesmo SHA com logs sanitizados; baseline 330 não vira quota artificial

Validação planejada, ainda não executada para esta melhoria:

- npm run lint
- npm run build
- npm test
- npm run verify:static
- npm run verify:production
- Executar workflow remoto no candidato quando conexão estiver autorizada

Artefato esperado: Entrega revisável de DEV-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F28.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DEV-02 — Preparar ambiente alvo e contratos operacionais

**P1 · M · M0 · R3**. Dependências: AAA-000.

Identificar cedo capacidade, endpoints, identidades, serviços e donos que condicionam provas externas.

Entradas e superfície permitida: `docs/staging.md`; `docs/adr/`; `docker/.env.example`.

Reservas exclusivas: `environment-contracts`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Inventário contém responsáveis e referências, nunca segredos
- Especifica staging isolado, PostgreSQL compatível, TLS, storage, OTLP, provider/DeepSeek e teto de custo
- Preparação técnica concluída pode ser entregue; parte sem acesso fica BLOCKED até disponibilidade real

Validação planejada, ainda não executada para esta melhoria:

- Revisão do inventário contra docker-compose.production.yml e scripts de verificação
- Inspeção read-only de ferramentas e recursos disponíveis

Artefato esperado: Entrega revisável de DEV-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Pré-requisitos externos/decisões:

- Autoridade de infraestrutura define/provisiona recursos e acessos externos; não pressupor credenciais ou orçamento

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DEV-03 — Executar staging e container smoke integral

**P1 · L · M3 · R3**. Dependências: DEV-01, DEV-02, SUP-02, ARC-02, ARC-03.

Rodar o artefato de CI com TLS/configuração real de teste e comprovar lifecycle completo.

Entradas e superfície permitida: `docker-compose.production.yml`; `docker/nginx/`; `scripts/verify-container-smoke.ts`; `scripts/verify-staging.ts`.

Reservas exclusivas: `staging-deploy`, `containers`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Config inválida/segredo ausente falha fechado; health não substitui jornada autenticada
- Login/MFA, leitura/escrita, heartbeat/outbox, replay, shutdown e restart comprovados
- Headers observados no endpoint TLS; readiness e rollback documentados

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:production
- npm run verify:container-smoke -- --url https://ALVO_AUTORIZADO --release-sha SHA_CANDIDATO --artifact-digest DIGEST_CANDIDATO
- npm run verify:staging

Artefato esperado: Entrega revisável de DEV-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F30, F32, F33.

Pré-requisitos externos/decisões:

- Deploy somente em staging autorizado com TLS, configurações e serviços de teste; placeholders do comando devem ser substituídos por referências reais

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DEV-04 — Congelar candidato e obter Gauntlet final

**P1 · L · M5 · R3**. Dependências: CON-03, FIN-03, A11Y-03, SEC-04, PER-03, OPS-03, SUP-03, DOC-03.

Consolidar F0–F38, 25 gates e 22 dimensões; executar críticos e reparar até critérios objetivos.

Entradas e superfície permitida: `docs/final-closure-audit.md`; `docs/triple-aaa-final-scorecard.md`.

Reservas exclusivas: `release-candidate`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Roster das 15 especialidades completo com contexto novo e artefatos imutáveis
- Cada reparo cria candidato/evidência novos e invalida prova afetada
- Zero CRITICAL/HIGH e todos os gates técnicos PASS; score não é concedido pelo builder

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:triplo-aaa
- Revisão independente da matriz F0–F38, receipts, fases e sujeito
- Reprodução de achados e execução integrada após cada alteração

Artefato esperado: Entrega revisável de DEV-04: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F0, F36, F37.

Pré-requisitos externos/decisões:

- Revisores independentes e evidências externas reais disponíveis; humanApproval permanece pendente até DEV-05

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DEV-05 — Decisão humana e promoção controlada

**P1 · S · M5 · R3**. Dependências: DEV-04.

Apresentar candidato concreto, riscos e rollback para decisão humana verificável.

Entradas e superfície permitida: `docs/11-transicao-para-producao.md`.

Reservas exclusivas: `human-approval`, `promotion`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Aprovação humana real assinada ligada ao candidato exato; não fabricada pelo agente
- 25 gates, 39 fases e 22 dimensões satisfazem verificador incluindo F38
- Produção só ocorre se explicitamente autorizada; rejeição não é convertida em PASS

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:triplo-aaa
- npm run verify:promotion-invariant -- --manifest promotion.json
- Conferir identidade, escopo, validade e assinatura da decisão humana

Artefato esperado: Entrega revisável de DEV-05: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F34, F38.

Pré-requisitos externos/decisões:

- Decisor humano independente emite atestação válida
- Implantação em produção requer autorização explícita para aquele candidato

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

