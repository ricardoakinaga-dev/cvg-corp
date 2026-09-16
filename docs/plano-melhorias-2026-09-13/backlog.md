# Backlog de melhorias — auditoria 13/09/2026

Catálogo de contratos planejados. Fonte estruturada: [backlog.json](backlog.json). Estado de execução somente em `.agent/backlog.json` após AUD13-01; este arquivo não marca trabalho concluído.

| ID | Pri. | Marco | Entrega | Dependências | IDs legados relacionados |
|---|---|---|---|---|---|
| AUD13-01 | P1 | M0 | Reconciliar planos, estado e evidência atual | — | AAA-000, DOC-01 |
| AUD13-02 | P1 | M0 | Instalação e isolamento reproduzíveis | AUD13-01 | SUP-01, QUA-03 |
| AUD13-03 | P1 | M0 | Tornar fixture de evidências determinística e portátil | AUD13-01 | QUA-01, QUA-02 |
| AUD13-04 | P1 | M1 | Conectar validação semântica de respostas | AUD13-01 | CON-01, CON-02 |
| AUD13-05 | P1 | M1 | Logout honesto sob falha e reconexão | AUD13-04 | SEC-01, UX-01 |
| AUD13-06 | P1 | M1 | Completar login com challenge MFA | AUD13-04 | SEC-01, SEC-03, CON-02 |
| AUD13-07 | P1 | M1 | Corrigir toast e estados de feedback | AUD13-01 | UX-02, A11Y-01 |
| AUD13-08 | P2 | M1 | Corrigir contexto, datas e indicadores reais | AUD13-07 | UX-02, FUN-01 |
| AUD13-09 | P1 | M1 | Corrigir saldo aberto sem inventar estorno | AUD13-04 | FIN-01, FIN-02, CON-02 |
| AUD13-10 | P1 | M1 | Reconciliar hashing, limites e anti-enumeração | AUD13-02 | SEC-02, PER-02 |
| AUD13-11 | P1 | M0 | Inventariar e fechar contratos das jornadas | AUD13-01 | FUN-01, FIN-01 |
| AUD13-12 | P1 | M2 | Tutores e pacientes completos | AUD13-11, AUD13-04, AUD13-05 | FUN-03 |
| AUD13-13 | P1 | M2 | Agenda, check-in, triagem e handoff | AUD13-12, AUD13-08 | FUN-03 |
| AUD13-14 | P1 | M2 | Prontuário, anexos, assinatura e adendo | AUD13-13, AUD13-04 | FUN-03 |
| AUD13-15 | P1 | M2 | Exames: pedido, amostra, resultado e revisão | AUD13-14 | FUN-03 |
| AUD13-16 | P1 | M2 | Internação, medicação, procedimento e alta | AUD13-14 | FUN-03 |
| AUD13-17 | P1 | M2 | Estoque e inventário completos | AUD13-11, AUD13-04 | FUN-02 |
| AUD13-18 | P1 | M2 | Jornada financeira e decisão de estornos | AUD13-09, AUD13-11, AUD13-17 | FIN-02, FIN-04, FIN-03 |
| AUD13-19 | P1 | M2 | Histórico e operação do copiloto | AUD13-14, AUD13-04, AUD13-08 | FUN-03, AIG-01 |
| AUD13-20 | P1 | M2 | Conhecimento, catálogo e admissão de artefatos | AUD13-11, AUD13-04 | AIG-01, AIG-03, FUN-03 |
| AUD13-21 | P1 | M2 | Budget atômico e settlement multidimensional | AUD13-04, AUD13-11 | AIG-01, AIG-03 |
| AUD13-22 | P1 | M2 | Identidade idempotente e claims abandonados | AUD13-02, AUD13-11 | DAT-02 |
| AUD13-23 | P1 | M2 | Escritas autoritativas por domínio e banco real | AUD13-02, AUD13-22 | DAT-01, DAT-02 |
| AUD13-24 | P1 | M3 | Lifecycle de dados e retorno reconciliado do restore | AUD13-23, AUD13-20 | DAT-03, DAT-04, OPS-02, OPS-03 |
| AUD13-25 | P1 | M3 | Workers, automações e comunicação operacionais | AUD13-23, AUD13-21 | WRK-01, WRK-02, FUN-03 |
| AUD13-26 | P1 | M0 | Preparar recursos e autoridade de teste externa | AUD13-01 | DEV-02 |
| AUD13-27 | P1 | M3 | Governance durável do ACP e vertical DeepSeek | AUD13-20, AUD13-21, AUD13-23, AUD13-26 | AIG-02, AIG-03 |
| AUD13-28 | P1 | M3 | Provider real, secrets e MFA forte | AUD13-06, AUD13-10, AUD13-25, AUD13-26 | WRK-03, SEC-03, SEC-04 |
| AUD13-29 | P1 | M1 | Telemetria limitada, causalidade e relatórios | AUD13-02, AUD13-11 | OPS-01, PER-02, FUN-03 |
| AUD13-30 | P1 | M1 | Readiness por capacidade e degradação manual | AUD13-02 | OPS-01, FUN-03 |
| AUD13-31 | P1 | M3 | Renderizar Alertmanager e provar entrega | AUD13-26, AUD13-29, AUD13-30 | OPS-01 |
| AUD13-32 | P1 | M1 | Gates de runbooks e carga que discriminem runtime | AUD13-03, AUD13-02 | QUA-03, PER-01, OPS-03 |
| AUD13-33 | P2 | M3 | Extrações arquiteturais e otimização medidas | AUD13-23, AUD13-25, AUD13-29, AUD13-32 | ARC-02, ARC-03, PER-01, PER-02 |
| AUD13-34 | P1 | M3 | CI do candidato, imagens e staging imutável | AUD13-03, AUD13-02, AUD13-26, AUD13-30 | DEV-01, DEV-03, SUP-02, SUP-03 |
| AUD13-35 | P1 | M4 | Acessibilidade e usabilidade das jornadas completas | AUD13-05, AUD13-06, AUD13-07, AUD13-08, AUD13-12, AUD13-13, AUD13-14, AUD13-15, AUD13-16, AUD13-17, AUD13-18, AUD13-19, AUD13-20, AUD13-25, AUD13-29, AUD13-34 | A11Y-01, A11Y-02, A11Y-03, UX-03 |
| AUD13-36 | P1 | M4 | Carga, caos, segurança e recovery operacionais | AUD13-24, AUD13-27, AUD13-28, AUD13-31, AUD13-32, AUD13-33, AUD13-34 | PER-03, SEC-04, OPS-02, OPS-03, FIN-03 |
| AUD13-37 | P1 | M5 | Dossiê integrado, reavaliação e crítica final | AUD13-35, AUD13-36 | DEV-04, DOC-02, DOC-03, CON-03 |
| AUD13-38 | P1 | M5 | Decisão humana e promoção do artefato aprovado | AUD13-37 | DEV-05 |

## Contratos implementáveis

### AUD13-01 — Reconciliar planos, estado e evidência atual

**P1 · M0 · M · R2 · responsável técnico proposto: Lead**

Achados: H07, M06. Dependências: nenhuma. Legado: AAA-000, DOC-01.

Superfície máxima: `.agent/`, `docs/README.md`, `docs/12-estado-da-implementacao.md`, `docs/08-rastreabilidade-e-decisoes.md`. Reservas: control-plane, docs-index. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Verificar HEAD, bytes e trabalho concorrente antes de iniciar.
- Mapear cada AUD13 para tarefa legada, acrescentando critérios sem duplicar execução.
- Reabrir apenas o aceite afetado por evidência atual e conservar histórico.
- Ponteiro, ExecPlan e next_action concordam; nenhuma correção ganha DONE por planejamento.

Verificação:

- git status --short.
- git rev-parse HEAD.
- Revisar DAG e mapa de migração; ativação repetida não duplica IDs.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-01, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-02 — Instalação e isolamento reproduzíveis

**P1 · M0 · M · R2 · responsável técnico proposto: Build/qualidade**

Achados: H14. Dependências: AUD13-01. Legado: SUP-01, QUA-03.

Superfície máxima: `package.json`, `package-lock.json`, `apps/web/package.json`, `playwright.config.ts`, `tests/`, `scripts/`. Reservas: dependencies, test-harness. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- npm ci e npm ls usam versões do lockfile, sem atualizar versões sem causa.
- Testes usam banco/porta/origem/output próprios e encerram recursos.
- Build, E2E e SBOM usam a mesma árvore resolvida.

Verificação:

- npm ci --ignore-scripts.
- npm ls --depth=0.
- npm run build.
- Executar dois runners isolados sem colisão.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-02, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-03 — Tornar fixture de evidências determinística e portátil

**P1 · M0 · M · R2 · responsável técnico proposto: Qualidade**

Achados: H07. Dependências: AUD13-01. Legado: QUA-01, QUA-02.

Superfície máxima: `tests/unit/evidence-snapshot.test.ts`, `scripts/verify-evidence-snapshot.ts`. Reservas: evidence-harness. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Mesmos testes passam em checkout limpo e modificado.
- Bytes/SHA/inventário/tempo adulterados são rejeitados.
- Cópia de bytes idênticos não falha apenas por mtime.
- Prova exige execução real no sujeito; nunca recapturar sucesso histórico.

Verificação:

- node --import tsx --test tests/unit/evidence-snapshot.test.ts.
- Executar fixture conhecida boa/ruim em cópias limpa/dirty com clock e mtimes controlados.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-03, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-04 — Conectar validação semântica de respostas

**P1 · M1 · M · R2 · responsável técnico proposto: Contratos**

Achados: H02, H03, H07. Dependências: AUD13-01. Legado: CON-01, CON-02.

Superfície máxima: `apps/web/src/api/`, `packages/contracts/src/`, `tests/unit/contracts.test.ts`. Reservas: contracts, web-client. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Revalidar schemas de ADR030 já existentes sem refazê-los.
- Payload inválido dentro de envelope válido não chega ao estado da UI.
- Login normal/MFA, logout, saldo, partial/receipt são discriminados e preservam correlationId.
- Compatibilidade explícita durante migração de endpoints.

Verificação:

- npm run test:contract.
- npm run typecheck.
- Interceptar resposta inválida por recurso e testar consumidor válido/legado permitido.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-04, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-05 — Logout honesto sob falha e reconexão

**P1 · M1 · M · R2 · responsável técnico proposto: Sessão/web**

Achados: H01. Dependências: AUD13-04. Legado: SEC-01, UX-01.

Superfície máxima: `apps/web/src/hooks/use-session.ts`, `apps/web/src/app-shell/`, `apps/web/src/state/`, `apps/api/src/app.ts`, `tests/e2e/`. Reservas: web-session, api-root, e 2e-session. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Revogação confirmada exige observação server-side conforme ADR030.
- Offline/timeout/5xx mostram saída local e revogação pendente sem sucesso falso.
- Online permite tentativa explícita de revogar; recarga não apaga a informação de risco por engano.
- Buffer sensível é purgado sem persistir credencial/draft; nenhuma Promise fica rejeitada sem tratamento.

Verificação:

- npm run test:security.
- npm run typecheck.
- E2E sucesso, offline, abort, 5xx, recarga e reconexão; exigir comportamento corrigido.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-05, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-06 — Completar login com challenge MFA

**P1 · M1 · M · R2 · responsável técnico proposto: Auth/web**

Achados: H02. Dependências: AUD13-04. Legado: SEC-01, SEC-03, CON-02.

Superfície máxima: `apps/web/src/components/Login.tsx`, `apps/web/src/hooks/use-session.ts`, `apps/web/src/api/`, `apps/api/src/app.ts`, `tests/e2e/`, `tests/unit/auth.test.ts`. Reservas: web-session, api-root, web-client. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- HTTP202 abre etapa TOTP sem tentar contexts[0].
- Challenge expira, tentativas limitadas e cancelamento permitem recuperação.
- OTP errado/replay/revogado negam; sucesso obtém contexto e sessão corretos.
- Erro não exibe TypeError interno e foco/anúncio acompanham etapa.

Verificação:

- npm run test:security.
- E2E challenge canônico, OTP válido/inválido, expiração, replay e fator revogado.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-06, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-07 — Corrigir toast e estados de feedback

**P1 · M1 · M · R2 · responsável técnico proposto: Frontend**

Achados: H04. Dependências: AUD13-01. Legado: UX-02, A11Y-01.

Superfície máxima: `apps/web/src/app-shell/Shell.tsx`, `apps/web/src/styles.css`, `tests/e2e/`. Reservas: shared-ui, e 2e-visual. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Toast não participa do encolhimento da área principal.
- Main mantém largura útil em 375/768/1440 após aviso curto/longo/repetido.
- Teclado, status/live region, reduced-motion e dismiss sem perda de foco.
- Medir geometria e captura após interação; scrollWidth sozinho não aceita.

Verificação:

- npm run typecheck.
- E2E Notificações e avisos com largura de main positiva, conteúdo/controles íntegros.
- npm run audit:contrast.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-07, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-08 — Corrigir contexto, datas e indicadores reais

**P2 · M1 · M · R2 · responsável técnico proposto: Frontend/dados**

Achados: M01. Dependências: AUD13-07. Legado: UX-02, FUN-01.

Superfície máxima: `apps/web/src/features/agenda/`, `apps/web/src/features/overview/`, `apps/web/src/features/copilot/`, `apps/web/src/app-shell/`, `tests/e2e/`. Reservas: shared-ui, web-features. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Agenda deriva dia/período/unidade do contexto efetivo e timezone.
- Badge/contagens e gráficos usam dados reais ou rótulo persistente de ilustração.
- Provenance visual deriva resposta: modelo/versão/fontes/timestamp/revisão; sem rótulo stub fixo sobre runtime real.
- Centro/Sul, dataset vazio, virada de dia e erro são testados.

Verificação:

- E2E contextoSul e relógio fixado.
- Testar contagens/gráficos contra respostas controladas e erro de fetch.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-08, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-09 — Corrigir saldo aberto sem inventar estorno

**P1 · M1 · M · R2 · responsável técnico proposto: Financeiro**

Achados: H03. Dependências: AUD13-04. Legado: FIN-01, FIN-02, CON-02.

Superfície máxima: `apps/web/src/features/finance/`, `apps/api/src/application/read-services.ts`, `apps/api/src/app.ts`, `packages/domain/src/`, `tests/`. Reservas: finance, api-root, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- PAID de 10000 resulta em zero aberto.
- Parcial mostra remanescente em centavos; sem double count.
- REFUNDED tem estado explícito; regra ainda desconhecida produz UNKNOWN/REQUIRES_POLICY.
- API e UI usam contrato de saldo comum, não soma de cobranças brutas.

Verificação:

- npm run test:contract.
- npm run test:database.
- E2E OPEN, PAID, parcial, estorno indeterminado e falha de leitura.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-09, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-10 — Reconciliar hashing, limites e anti-enumeração

**P1 · M1 · M · R2 · responsável técnico proposto: Segurança**

Achados: H06. Dependências: AUD13-02. Legado: SEC-02, PER-02.

Superfície máxima: `packages/domain/src/index.ts`, `packages/auth/`, `packages/config/`, `apps/api/src/app.ts`, `tests/unit/auth.test.ts`, `tests/integration/`. Reservas: auth-core, api-root, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Registrar contrato vigente de docs 05§14 versus implementação; não reduzir custo para obter verde.
- Hash assíncrono parametrizado/formatado, fila limitada e no máximo concorrência acordada.
- Migrar hashes existentes sem invalidar contas silenciosamente.
- Usuário inexistente realiza derivação equivalente; limites ID/IP independentes e respostas uniformes.
- Medir memória/event-loop sob logins válidos, inválidos e sobrecarga.

Verificação:

- npm run test:security.
- Testes compatibilidade hash antigo/novo e migração após login.
- Benchmark login concurrente com atraso event-loop/RSS, sem usar senha real.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-10, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-11 — Inventariar e fechar contratos das jornadas

**P1 · M0 · M · R2 · responsável técnico proposto: Produto/domínio**

Achados: H05, H11. Dependências: AUD13-01. Legado: FUN-01, FIN-01.

Superfície máxima: `docs/01-prd-cvg.md`, `docs/adr/`, `docs/03-dominio-dados-contratos.md`. Reservas: product-contracts. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Mapear todos FR01–22, UC01–07 e CTA para UI/API/policy/commit/receipt.
- Separar implementado, bloqueio legítimo e ausente, sem excluir módulo para encerrar plano.
- Registrar perguntas clínicas/financeiras com dono; implementar apenas regras já definidas.
- Congelar exemplos sucesso/negação/recuperação por jornada.

Verificação:

- Inspeção conectada por CTA e teste de consulta.
- Revisão de contratos clínicos/financeiros existentes e decisões residuais.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-11, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-12 — Tutores e pacientes completos

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/cadastro**

Achados: H05. Dependências: AUD13-11, AUD13-04, AUD13-05. Legado: FUN-03.

Superfície máxima: `apps/web/src/features/patients/`, `apps/web/src/routes/`, `apps/api/src/application/`, `packages/domain/src/`, `tests/`. Reservas: patient-feature, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Cadastrar/pesquisar tutor/paciente e gerenciar vínculo pelo servidor.
- Abrir ficha, desativar e mesclar com aprovação preservando histórico.
- Cross-scope/duplicidade/retry/conflito negam sem parcialidade.
- UI exibe receipt, erro recuperável e confirmação de ação destrutiva lógica.

Verificação:

- npm run test:database.
- npm run verify:pdp.
- E2E cadastro→busca→ficha→merge/desativação e negativos.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-12, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-13 — Agenda, check-in, triagem e handoff

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/recepção**

Achados: H05, M01. Dependências: AUD13-12, AUD13-08. Legado: FUN-03.

Superfície máxima: `apps/web/src/features/agenda/`, `apps/web/src/features/clinical/`, `apps/api/src/application/`, `packages/domain/src/`, `tests/`. Reservas: agenda-feature, clinical-feature, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Criar/reagendar/cancelar/confirmar sem dupla reserva.
- Check-in→fila→triagem→atribuição→handoff com autoria/estado.
- Duas confirmações concorrentes geram uma reserva e conflito claro.
- Sem CTA substituído apenas por aviso genérico.

Verificação:

- npm run test:database.
- E2E reserva→check-in→handoff.
- Concorrência duas sessões e replay após resposta perdida.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-13, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-14 — Prontuário, anexos, assinatura e adendo

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/clínica**

Achados: H05, H11. Dependências: AUD13-13, AUD13-04. Legado: FUN-03.

Superfície máxima: `apps/web/src/features/clinical/`, `apps/api/src/application/`, `packages/domain/src/`, `packages/persistence/`, `tests/`. Reservas: clinical-feature, domain-core, persistence-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Editor/timeline/anexos com escopo e estados persistidos.
- Draft IA nunca vira fato assinado sem revisão e ator autorizado.
- Assinatura imutável; correção via adendo, conflito de versão explícito.
- Com IA indisponível, registro manual continua concluível.

Verificação:

- npm run test:database.
- npm run verify:authoritative-writes.
- E2E editar→revisar→assinar→adendo e upload/ACL/falha.
- Decisões clínicas faltantes devem ser registradas antes dos atos afetados.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-14, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-15 — Exames: pedido, amostra, resultado e revisão

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/diagnóstico**

Achados: H05, H11. Dependências: AUD13-14. Legado: FUN-03.

Superfície máxima: `apps/web/src/features/`, `apps/web/src/routes/`, `apps/api/src/application/diagnostic-service.ts`, `packages/domain/src/`, `tests/`. Reservas: diagnostic-feature, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- UI percorre pedido→amostra→resultado→revisão com vínculo paciente/autor.
- Out-of-order, unidade incompatível, parent errado e duplicidade vão para erro/quarentena.
- Resultados aprovados visíveis só no escopo; origem e versão preservadas.

Verificação:

- npm run test:database.
- E2E cadeia diagnóstica e publicação negada de resultado inválido.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-15, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-16 — Internação, medicação, procedimento e alta

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/internação**

Achados: H05, H11. Dependências: AUD13-14. Legado: FUN-03.

Superfície máxima: `apps/web/src/features/`, `apps/web/src/routes/`, `apps/api/src/application/`, `packages/domain/src/`, `tests/`. Reservas: hospital-feature, clinical-feature, domain-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Leito/episódio/checklist/consentimento e handoff operacionais.
- Prescrição, dispensação e administração são fatos distintos com lote/horário/autoria.
- Dose/ordem/lote inválido, dupla administração e alta com pendência são negados.
- Alta assinada e plano de retorno concluem somente com regras documentadas.

Verificação:

- npm run test:database.
- E2E admissão→ordem→administração→handoff→alta, crash/retry e pendências.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-16, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-17 — Estoque e inventário completos

**P1 · M2 · L · R2 · responsável técnico proposto: Produto/estoque**

Achados: H05. Dependências: AUD13-11, AUD13-04. Legado: FUN-02.

Superfície máxima: `apps/web/src/features/stock/`, `apps/api/src/application/`, `packages/domain/src/`, `packages/persistence/`, `tests/`. Reservas: stock-feature, domain-core, persistence-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Entrada com fornecedor/lote/validade/quantidade/custo persiste uma vez.
- Reserva/dispensa/consumo/devolução/perda/transferência e inventário são movimentos auditáveis.
- Saldo negativo/lote expirado/sem autorização negam atomicamente.
- Divergência física vira ajuste compensatório com motivo e alçada.

Verificação:

- npm run test:database.
- E2E entrada→reserva→consumo→devolução→inventário.
- Corrida de saldo insuficiente e replay.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-17, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-18 — Jornada financeira e decisão de estornos

**P1 · M2 · L · R3 · responsável técnico proposto: Produto/financeiro**

Achados: H03, H05. Dependências: AUD13-09, AUD13-11, AUD13-17. Legado: FIN-02, FIN-04, FIN-03.

Superfície máxima: `apps/web/src/features/finance/`, `apps/api/src/application/`, `packages/domain/src/`, `packages/persistence/`, `docs/adr/`, `tests/`. Reservas: finance, domain-core, persistence-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Orçamento→aprovação→cobrança→pagamento→conciliação com origem/versão/moeda.
- Regra de estorno/crédito/reabertura e alçadas pendentes decididas por responsável financeiro.
- Compensação append-only sem apagar ledger; dupla submissão não duplica liquidação.
- API/UI/ledger/export concordam em sequências aleatórias de pagamentos/estornos.

Verificação:

- npm run test:database.
- Testes de propriedades com seed, concorrência e callback duplicado.
- E2E jornada financeira e reconciliação.

Pré-requisitos externos: Decisão financeira apenas para semântica hoje não especificada; correção PAID de AUD13-09 independe dela.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-18, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-19 — Histórico e operação do copiloto

**P1 · M2 · L · R2 · responsável técnico proposto: IA/frontend**

Achados: H05, H09. Dependências: AUD13-14, AUD13-04, AUD13-08. Legado: FUN-03, AIG-01.

Superfície máxima: `apps/web/src/features/copilot/`, `apps/api/src/application/agent-service.ts`, `tests/`. Reservas: copilot-feature, ai-application. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Reutilizar sessão autorizada e vincular paciente/atendimento/contexto.
- Histórico/replay, referências/modelo/versão/revisão visíveis.
- Aprovação/negação/cancelamento e retomada não duplicam turno/efeito.
- Composer oculta dados sensíveis offline, purga em perda de contexto e nunca autoenvia.

Verificação:

- npm run test:security.
- E2E múltiplos turnos, mudança contexto, offline/reconexão, aprovação e replay.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-19, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-20 — Conhecimento, catálogo e admissão de artefatos

**P1 · M2 · L · R2 · responsável técnico proposto: IA/conhecimento**

Achados: H09, H05. Dependências: AUD13-11, AUD13-04. Legado: AIG-01, AIG-03, FUN-03.

Superfície máxima: `packages/harness/`, `packages/agent-policy/`, `packages/agent-tools/`, `packages/persistence/`, `apps/web/src/features/`, `docs/adr/`, `tests/`. Reservas: ai-registry, knowledge, persistence-core. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Registro versiona modelos/prompts/tools/skills/MCP e seus escopos/digests/aprovação.
- Revogação, expiração, rollback e kill switch impedem admissão.
- Ingestão→classificação→aprovação→indexação→retrieval com origem/chunks/checksum.
- ACL é aplicada antes/depois de retrieval e remoção invalida projeções.
- UI permite gerir conhecimento sem promover conteúdo não aprovado.

Verificação:

- npm run test:security.
- Testes cross-scope, poisoning, versão revogada e índice stale.
- E2E ingestão→aprovação→busca→revogação.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-20, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-21 — Budget atômico e settlement multidimensional

**P1 · M2 · L · R2 · responsável técnico proposto: IA/dados**

Achados: H09. Dependências: AUD13-04, AUD13-11. Legado: AIG-01, AIG-03.

Superfície máxima: `packages/harness/`, `packages/agent-runtime/`, `packages/agent-tools/`, `apps/api/src/application/agent-service.ts`, `packages/persistence/`, `tests/`. Reservas: usage-ledger, persistence-core, ai-runtime. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Reservar antes do dispatch por organização/workspace/ator/sessão e modalidades.
- Sub-reservas nested/retry não ampliam teto; concorrência atômica.
- Usage tardio/duplicado/fora de ordem reconcilia; desconhecido não vira custo zero.
- Reserva não usada expira/libera sem permitir duplo gasto.

Verificação:

- npm run test:database.
- Testes paralelos orçamento insuficiente, late usage, cancelamento e crash.
- Propriedades de reserva+consumo+saldo com seed.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-21, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-22 — Identidade idempotente e claims abandonados

**P1 · M2 · L · R2 · responsável técnico proposto: Dados/idempotência**

Achados: H10. Dependências: AUD13-02, AUD13-11. Legado: DAT-02.

Superfície máxima: `apps/api/src/application/idempotency-service.ts`, `packages/domain/src/`, `packages/persistence/`, `db/migrations/`, `docs/adr/`, `tests/`. Reservas: idempotency, domain-core, persistence-core, db-schema. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Resolver conflito docs 04/ADR019 sobre sessionId com decisão explícita.
- Migração de lookup preserva receipts e replay autorizado sem ampliar escopo.
- Claim expirado invalida fence e finaliza PRE_DISPATCH quando ausência de intent é comprovada.
- Intent/envio incerto permanece OUTCOME_UNKNOWN, sem retry automático.
- Dois processos e escopos opcionais ausentes provam unicidade e takeover.

Verificação:

- npm run test:database.
- npm run verify:postgres:concurrency.
- Injetar crash imediatamente após claim e após intent; re-login e replay de chave.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-22, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-23 — Escritas autoritativas por domínio e banco real

**P1 · M2 · L · R2 · responsável técnico proposto: Dados**

Achados: H11. Dependências: AUD13-02, AUD13-22. Legado: DAT-01, DAT-02.

Superfície máxima: `packages/persistence/`, `apps/api/src/application/`, `apps/api/src/app.ts`, `db/migrations/`, `scripts/verify-authoritative-writes.ts`, `tests/`. Reservas: persistence-core, api-root, db-schema. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Inventário por comando liga tabela/owner/invariantes, não só coleção.
- Eliminar dependência operacional primária de snapshot nas entidades faltantes preservando journal/recovery.
- Commit inclui estado/audit/receipt/outbox de forma atômica.
- PostgreSQL efêmero aplica migrations imutáveis, FORCE RLS e role runtime mínima.
- Testar FK poisoning, CAS, mixed-version e crash.

Verificação:

- npm run verify:postgres.
- npm run verify:postgres:concurrency.
- npm run verify:authoritative-writes.
- npm run test:database.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-23, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-24 — Lifecycle de dados e retorno reconciliado do restore

**P1 · M3 · L · R3 · responsável técnico proposto: Dados/recuperação**

Achados: H11, M05. Dependências: AUD13-23, AUD13-20. Legado: DAT-03, DAT-04, OPS-02, OPS-03.

Superfície máxima: `packages/persistence/`, `apps/api/src/application/export-service.ts`, `apps/worker/src/`, `scripts/verify-postgres-restore.ts`, `docs/runbooks/`, `db/migrations/`, `tests/`. Reservas: recovery, persistence-core, db-schema. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Backup→restrição/revogação/exclusão→restore reaplica decisões posteriores por autoridade independente.
- Cobrir DB/object/vector/session/cache/provider/telemetry/backup/export, ou bloquear store não integrado.
- Chave errada/tamper/stale/partial/migration mismatch negam e origem intacta.
- Quarentena permanece até reconciliação comprovada; então retorno seguro a READY é exercitado.
- Export tem purpose/TTL/escopo/cifra e recuperação sem reenvio cego.

Verificação:

- npm run test:restore.
- npm run verify:postgres:restore.
- Drill com perda do store local de decisão e replay pós-watermark.

Pré-requisitos externos: Política de retenção/residência e autoridade de reconciliação dos stores reais antes do drill externo; preparar e provar contrato sintético primeiro.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-24, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-25 — Workers, automações e comunicação operacionais

**P1 · M3 · L · R2 · responsável técnico proposto: Worker/produto**

Achados: H05, H15. Dependências: AUD13-23, AUD13-21. Legado: WRK-01, WRK-02, FUN-03.

Superfície máxima: `apps/worker/`, `packages/persistence/`, `apps/web/src/features/`, `apps/web/src/routes/`, `tests/`. Reservas: worker, persistence-core, automation-feature. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Cinco handlers e outbox executam trabalho governado com escopo mínimo.
- Dois workers provam lease/fencing/takeover/shutdown/restart sem duplicação.
- Fila cheia, poison, timeout e pool saturado degradam antes do claim/dispatch.
- UI agenda/janela/cancela automação e mostra execução/falha/receipt.
- Comunicação permite preparar/revisar/aprovar/consultar mensagem sem envio direto por rota.

Verificação:

- npm run verify:worker-runtime.
- npm run verify:postgres:concurrency.
- E2E automação/comunicação e teste multiprocesso com kill controlado.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-25, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-26 — Preparar recursos e autoridade de teste externa

**P1 · M0 · M · R3 · responsável técnico proposto: Infraestrutura**

Achados: H08, H13, H15. Dependências: AUD13-01. Legado: DEV-02.

Superfície máxima: `docs/staging.md`, `docs/adr/`, `docker/.env.example`. Reservas: environment-contracts. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Inventariar endpoints, versões, owners e referências sem expor segredos.
- Definir dados/destinatários sintéticos, limites de custo/carga e isolamento.
- Preparação técnica é entregável; falta de acesso bloqueia somente execução dependente.
- Revalidar autoridade já concedida na sessão antes de perguntar novamente.

Verificação:

- Inspecionar manifestos/scripts e preencher matriz recurso→responsável→disponibilidade→gate.

Pré-requisitos externos: Provisionamento de staging/TLS/DB/secret authority/modelo/provider/sink e orçamento de teste pelos responsáveis.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-26, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-27 — Governance durável do ACP e vertical DeepSeek

**P1 · M3 · L · R3 · responsável técnico proposto: IA/runtime**

Achados: H08. Dependências: AUD13-20, AUD13-21, AUD13-23, AUD13-26. Legado: AIG-02, AIG-03.

Superfície máxima: `packages/deepseek-bridge/`, `packages/harness-adapters/`, `packages/agent-runtime/`, `apps/deepseek-bridge/`, `tests/`, `docs/deepseek-real-proof.md`. Reservas: deepseek, ai-runtime, external-ai. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Implementar e injetar DeepSeekAcpGovernance durável no entrypoint.
- Modelo/tool/approval/replay/usage/provenance ligados ao candidato e perfil.
- Provar restart, cancelamento, timeout, JSON inválido, manifest/HMAC incorretos e usage ausente.
- Sem fallback para mock em ambiente real; prova externa separada de fixtures.

Verificação:

- npm run verify:deepseek-acp.
- npm run verify:deepseek-real.
- Matriz completa docs prompt final F3/F4 com logs e receipts.

Pré-requisitos externos: Runtime/modelo/segredos e teto de custo de teste autorizados.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-27, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-28 — Provider real, secrets e MFA forte

**P1 · M3 · L · R3 · responsável técnico proposto: Integrações/segurança**

Achados: H15, H08. Dependências: AUD13-06, AUD13-10, AUD13-25, AUD13-26. Legado: WRK-03, SEC-03, SEC-04.

Superfície máxima: `packages/integrations/`, `packages/auth/`, `packages/config/`, `apps/api/src/application/break-glass-service.ts`, `apps/worker/`, `tests/`. Reservas: integrations, auth-core, external-provider. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Secret authority configurada exerce falta/rotação/revogação/versão incorreta sem vazar chaves.
- WebAuthn registro/assertion/replay/rpId/origin e break-glass têm aprovador independente e revisão.
- Mensagem aprovada percorre outbox→provider→receipt/callback→inbox→effect→reconciliação.
- Perda de resposta, duplicata,429/500 e callback inválido não causam retry cego.
- Provider de pagamento/laboratório exigido pelo contrato é identificado, implementado ou permanece bloqueio explícito da jornada correspondente.

Verificação:

- npm run test:security.
- npm run verify:provider-sandbox.
- npm run verify:provider-real.
- Matriz de faults e receipt externo com dados sintéticos.

Pré-requisitos externos: Destinatário/canal/provider e identidade WebAuthn de teste autorizados; sem enviar mensagens a terceiros sem autorização explícita.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-28, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-29 — Telemetria limitada, causalidade e relatórios

**P1 · M1 · M · R2 · responsável técnico proposto: Observabilidade**

Achados: H12, H05. Dependências: AUD13-02, AUD13-11. Legado: OPS-01, PER-02, FUN-03.

Superfície máxima: `packages/ops/`, `apps/api/src/application/operational-metrics-service.ts`, `apps/web/src/features/`, `tests/unit/ops.test.ts`. Reservas: telemetry, reports-feature. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Logs/latências têm retenção/capacidade limitada e descarte observável.
- Percentis por janela/histograma sem ordenar histórico vitalício.
- Propagar trace/correlação HTTP→domínio→outbox→worker→provider sem payload sensível.
- Relatórios operação/qualidade/custo/auditoria/incidentes têm filtros e fonte real.
- Falha/duplicação collector não altera domínio.

Verificação:

- node --import tsx --test tests/unit/ops.test.ts.
- Probe 10000 eventos e soak verifica memória limitada.
- Teste collector local com contexto pai/filho e redaction.
- E2E filtros/relatório sem gráficos fixos.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-29, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-30 — Readiness por capacidade e degradação manual

**P1 · M1 · M · R2 · responsável técnico proposto: Operação/API**

Achados: M04. Dependências: AUD13-02. Legado: OPS-01, FUN-03.

Superfície máxima: `apps/api/src/routes/health.ts`, `apps/api/src/app.ts`, `packages/config/`, `docker/`, `tests/`. Reservas: api-root, readiness. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Probes medem status corrente de segredos/policy/audit/fila e DB.
- Diferenciar liveness, readiness global e capacidade IA sem retirar caminho manual válido.
- Falha DB/audit obrigatória nega operações dependentes.
- Revogação depois do startup e recuperação são observáveis; sem READY constante enganoso.

Verificação:

- npm run test:integration.
- Teste transição READY→revogado→recuperado e IA indisponível com escrita manual autorizada.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-30, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-31 — Renderizar Alertmanager e provar entrega

**P1 · M3 · L · R3 · responsável técnico proposto: SRE**

Achados: H13. Dependências: AUD13-26, AUD13-29, AUD13-30. Legado: OPS-01.

Superfície máxima: `docker/observability/`, `docker-compose.observability.yml`, `scripts/verify-production.ts`, `tests/`, `docs/runbooks/`. Reservas: observability-stack. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Arquivo de configuração efetivo contém URL válida do sink, não placeholder literal.
- Ausência de autoridade bloqueia explicitamente startup/configuração.
- Validar config do Alertmanager e receber/resolver alerta real de teste.
- API/DB/worker/backlog/provider/DeepSeek apontam runbooks e têm evidência de entrega.

Verificação:

- Validar arquivo renderizado com ferramenta da imagem fixada.
- Teste known-bad URL ausente e known-good sink local.
- Alerta chega e resolve no sink controlado.

Pré-requisitos externos: Sink e execução do stack de teste autorizados; nunca usar canais pessoais por inferência.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-31, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-32 — Gates de runbooks e carga que discriminem runtime

**P1 · M1 · M · R2 · responsável técnico proposto: Qualidade/SRE**

Achados: M02, M03. Dependências: AUD13-03, AUD13-02. Legado: QUA-03, PER-01, OPS-03.

Superfície máxima: `scripts/verify-runbook-execution.ts`, `scripts/verify-load.ts`, `tests/load/`, `tests/unit/runbook-gate.test.ts`, `tests/unit/load-gate.test.ts`. Reservas: evidence-harness, load-harness. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Separar checagem textual de cenário executado, sem EXECUTED_LOCAL para strings.
- Cada cenário aciona boundary e verifica efeito bloqueado/recuperado.
- Carga inclui clinical read/write,turno,envio,receipt e backlog além de GET.
- Workload ausente ou semântica inválida falha mesmo com HTTP200.
- Thresholds por operação/cenário/check e p 50/p 95/p 99; limites aprovados sem adaptações para passar.

Verificação:

- node --import tsx --test tests/unit/runbook-gate.test.ts tests/unit/load-gate.test.ts.
- Mutação conhecida ruim passa HTTP200 mas falha contrato.
- Executar cenários locais com medição real de estado.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-32, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-33 — Extrações arquiteturais e otimização medidas

**P2 · M3 · L · R2 · responsável técnico proposto: Arquitetura/performance**

Achados: H11, H12. Dependências: AUD13-23, AUD13-25, AUD13-29, AUD13-32. Legado: ARC-02, ARC-03, PER-01, PER-02.

Superfície máxima: `apps/api/src/`, `packages/domain/`, `packages/persistence/`, `scripts/benchmark-local.ts`, `docs/adr/`, `tests/`. Reservas: api-root, domain-core, persistence-core, benchmark. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Perfilar snapshot/locks/hash/queries/RLS/pool antes de otimizar.
- Congelar workload/dataset/hardware/seed/cold-warm/concorrência/caudas.
- Extrair composição e persistência por ownership mantendo transação e API.
- Ganho medido sem reduzir isolamento, custo do hash, auditoria ou correção.
- Não extrair apenas por quantidade de linhas.

Verificação:

- npm run benchmark:local.
- npm run verify:authoritative-writes.
- npm run verify:pdp.
- npm run test:database.
- Comparar perfil antes/depois no mesmo equipamento e carga.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-33, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-34 — CI do candidato, imagens e staging imutável

**P1 · M3 · L · R3 · responsável técnico proposto: Release**

Achados: H07, H14, H15. Dependências: AUD13-03, AUD13-02, AUD13-26, AUD13-30. Legado: DEV-01, DEV-03, SUP-02, SUP-03.

Superfície máxima: `scripts/verify-production.ts`, `scripts/verify-release-provenance.ts`, `scripts/verify-promotion-invariant.ts`, `.github/`, `docker/`, `docker-compose.production.yml`, `Dockerfile.api`, `Dockerfile.web`. Reservas: ci, containers, staging-deploy. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- CI do mesmo SHA executa instalação/typecheck/testes/build/Postgres/restore/browser/scans.
- SBOM e digests vinculam imagens reais; tags mutáveis revisadas/fixadas conforme política.
- Nenhum rebuild entre staging aprovado e promoção.
- Config insegura/demo/mock/segredo ausente falha; smoke inclui login/escrita/worker/outbox/shutdown/restart/headers TLS.
- Não atualizar evidência sem executar candidato.

Verificação:

- npm run verify:static.
- npm run verify:production.
- npm run verify:release-provenance.
- npm run verify:container-smoke.
- npm run verify:promotion-invariant.

Pré-requisitos externos: CI remoto, Docker e staging disponíveis/autorizados; não publicar ou promover produção nesta tarefa.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-34, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-35 — Acessibilidade e usabilidade das jornadas completas

**P1 · M4 · L · R3 · responsável técnico proposto: UX/qualidade**

Achados: H04, H05. Dependências: AUD13-05, AUD13-06, AUD13-07, AUD13-08, AUD13-12, AUD13-13, AUD13-14, AUD13-15, AUD13-16, AUD13-17, AUD13-18, AUD13-19, AUD13-20, AUD13-25, AUD13-29, AUD13-34. Legado: A11Y-01, A11Y-02, A11Y-03, UX-03.

Superfície máxima: `tests/e2e/`, `playwright.config.ts`, `apps/web/src/`, `docs/visual-qa-vNext.md`, `docs/accessibility-proof.md`. Reservas: e 2e-visual, shared-ui, assistive-review. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Matriz Chromium/Firefox/WebKit desktop/tablet/mobile e estados críticos.
- Teclado/dialog/foco/live-region/erro/tabela/contraste e zoom nativo 200/400% utilizáveis.
- Leitor de tela/toque/dispositivo real têm operador e evidência explícitos.
- Usuários representativos concluem recepção/clínica/financeiro; medir conclusão/erros.
- Corrigir maior falha e repetir cenário; duas críticas visuais independentes sem baseline ajustado para ocultar bug.

Verificação:

- npm run test:e 2e:full.
- npm run audit:contrast.
- npm run audit:tokens.
- Roteiro assistivo/usuários com registro anonimizado.

Pré-requisitos externos: Operador assistivo, dispositivos e participantes autorizados; ausência não vira PASS.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-35, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-36 — Carga, caos, segurança e recovery operacionais

**P1 · M4 · L · R3 · responsável técnico proposto: SRE/segurança**

Achados: H06, H10, H11, H12, H15, M02, M03, M05. Dependências: AUD13-24, AUD13-27, AUD13-28, AUD13-31, AUD13-32, AUD13-33, AUD13-34. Legado: PER-03, SEC-04, OPS-02, OPS-03, FIN-03.

Superfície máxima: `tests/load/`, `tests/integration/`, `scripts/`, `docs/runbooks/`, `docs/load-proof.md`, `docs/chaos-proof.md`, `docs/recovery-proof-final.md`. Reservas: staging-db, load-environment, recovery, red-team. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- W-A…W-H,50/100 usuários e burst com hardware/dados/duração/caudas brutas.
- CPU/memória/pool/FD/filas degradam e recuperam sem corrupção.
- Kill API/worker,DB restart,network/provider/secret/model failure sem efeito duplicado.
- Backup periódico cifrado/retido/rotacionado exercitado com retorno seguro.
- Operador independente executa runbooks de outage/restore/rotação/break-glass e mede RTO/RPO.
- Red-team F23/F24 com role runtime mínima e zero High/Critical aberto.

Verificação:

- npm run verify:load.
- npm run verify:resource-pressure.
- npm run verify:runbook-execution.
- npm run verify:security-red-team.
- npm run verify:postgres:restore.

Pré-requisitos externos: Ambiente isolado, escopo de ataque, teto de custo/carga e targets SLO/RTO/RPO acordados; não deduzir disponibilidade mensal de teste curto.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-36, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-37 — Dossiê integrado, reavaliação e crítica final

**P1 · M5 · M · R2 · responsável técnico proposto: Lead/críticos**

Achados: H07, H15, M06. Dependências: AUD13-35, AUD13-36. Legado: DEV-04, DOC-02, DOC-03, CON-03.

Superfície máxima: `docs/`, `README.md`, `.agent/`, `.gauntlet/`. Reservas: release-candidate, docs-index, control-plane. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Todos achados H01–H15/M01–M06 e FR/NFR têm evidência, candidato e resolução.
- Revalidar catálogo/compatibilidade após todas integrações.
- 39 fases/25 gates/22 dimensões canônicas têm evidência exigida; crítica em 15 especialidades conforme barra.
- Notas atribuídas por análise independente, nunca meta automaticamente.
- Reparo altera candidato e invalida prova afetada; nenhum High/Critical técnico aberto.
- Histórico preservado, comandos/estado atual sem contradição.

Verificação:

- npm run verify:pdp.
- npm run test:contract.
- npm run verify:triplo-aaa.
- Conferir hashes/receipts e parecer independente; F38 pode permanecer pendente de AUD13-38.

Pré-requisitos externos: nenhum para o recorte local.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-37, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

### AUD13-38 — Decisão humana e promoção do artefato aprovado

**P1 · M5 · M · R3 · responsável técnico proposto: Decisor/release**

Achados: H15. Dependências: AUD13-37. Legado: DEV-05.

Superfície máxima: `docs/11-transicao-para-producao.md`, `.agent/`, `artifacts/`. Reservas: human-approval, promotion. O Lead deve fixar arquivos e recursos exatos antes de executar; diretório não autoriza disputa com outro agente.

Aceite:

- Apresentar candidato concreto, riscos residuais e rollback; decisão humana genuína ligada ao digest.
- F38,retenção,dados reais,alçadas e metas têm autoridade registrada.
- verify:triplo-aaa só passa com todos gates efetivamente atendidos.
- Produção apenas se explicitamente autorizada para o candidato, sem rebuild; rejeição não vira PASS.

Verificação:

- npm run verify:triplo-aaa.
- npm run verify:promotion-invariant.
- Conferir identidade/escopo/validade da decisão e sujeito.

Pré-requisitos externos: Aceite humano e autorização explícita de produção; planejamento não os concede.

Evidência: Identidade HEAD + hash de worktree/contrato; Comando/procedimento, ambiente sintético, início/fim, exit e output sanitizado; Caso bom e negativo no boundary relevante; log/receipt/screenshot e SHA256; Crítico independente e reteste da regressão pertinente; limitações NOT_RUN explícitas.

Recuperação: Preservar trabalho alheio; registrar efeitos e recursos antes de parar. Reverter só mudança própria não integrada; migration aplicada usa forward-fix. OUTCOME_UNKNOWN exige consulta/reconciliação, nunca retry cego.

Próxima ação: Ler AUD13-38, validar dependências e reproduzir o comportamento atual antes de reservar arquivos exatos.

