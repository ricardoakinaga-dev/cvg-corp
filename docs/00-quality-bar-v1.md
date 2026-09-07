# CVG-Corp — Quality Bar v1

**Estado:** FROZEN para a fase documental

**Data:** 2026-09-07 (America/Sao_Paulo)

**Autorização:** escrita local somente em `harness-corp/docs/`; nenhum código, configuração de runtime, banco, segredo, deploy ou integração externa será alterado nesta fase.

## Resultado que este bar deve proteger

Entregar uma documentação arquitetural executável para um programa de gestão do Centro Veterinário Guarapiranga, usando as capacidades observadas do DeepSeek Harness como motor de agentes e preservando um sistema transacional próprio para operações clínicas, administrativas e financeiras.

“Triplo AAA” é um rubric interno proposto para orientar qualidade, não uma certificação regulatória ou uma afirmação de conformidade:

1. **A1 — Assistência segura:** decisões clínicas e comunicações de alto impacto permanecem sob responsabilidade humana habilitada, com contexto, aprovação, proveniência e auditoria.
2. **A2 — Administração íntegra:** tenant, workspace, prontuário, estoque, cobrança e permissões possuem donos, invariantes, isolamento e reconciliação observáveis.
3. **A3 — Aceleração governada:** agentes, ferramentas, automações e conhecimento aumentam produtividade dentro de políticas versionadas, orçamento, fail-closed, observabilidade e recuperação.

## Critérios release-blocking da documentação

| ID | Fonte | Dimensão | Target rejeitável | Evidência exigida | Prioridade | Validade |
|---|---|---|---|---|---|---|
| DOC-01 | USER/REFERENCE | Proveniência | Toda decisão baseada nas fontes locais identifica origem, versão/hash quando disponível e separa `CURRENT`, `TARGET`, `PROPOSED` e `UNKNOWN`. | Inspeção cruzada de `00-fontes-e-premissas.md` e referências em todos os documentos. | critical | Evita transformar demonstração de vídeo ou capacidade do motor em requisito confirmado. |
| DOC-02 | USER/DERIVED | Produto | Existe PRD com usuários, escopo, não-escopo, jornadas clínicas/administrativas, regras determinísticas, erros, permissões e critérios de aceite. | Inspeção de `01-prd-cvg.md`; cada jornada material possui sucesso, negação e recuperação. | critical | Um desenho técnico sem WHAT suficiente não é implementável com segurança. |
| ARC-01 | USER/DERIVED | Arquitetura | Existem limites de contexto, donos, dependências e fonte de verdade; o motor de IA não é usado como prontuário, estoque ou razão financeira. | Inspeção de `02-arquitetura-alvo.md` e `03-dominio-dados-contratos.md`. | critical | Rejeita um “god service” e evita que o log conversacional substitua dados transacionais. |
| ARC-02 | REFERENCE | Integração DeepSeek | Cada capacidade CVG é ligada a uma seam/evento/pacote atualmente documentado ou marcada como extensão proposta; nenhuma API futura é descrita como existente. | Matriz de `04-motor-deepseek-e-plugins.md` contra `deepseek-harness/docs/architecture.md` e subsistemas citados. | critical | Permite validar a integração no código posteriormente sem inventar contrato. |
| DATA-01 | DERIVED | Dados | Entidades, escopos, invariantes, estados, transações, idempotência, retenção, exportação e exclusão têm dono e evidência planejada. | Inspeção de `03-dominio-dados-contratos.md` e `05-seguranca-privacidade.md`. | critical | Dados clínicos, estoque e cobrança falham de formas diferentes e exigem controles explícitos. |
| SEC-01 | DERIVED/REFERENCE | Segurança | Há modelo de ameaças, matriz actor→action→resource→condition, trust boundaries, segredo server-side, defesa contra prompt injection/SSRF, auditoria e fail-closed. | Inspeção de `05-seguranca-privacidade.md` contra o threat model do motor. | critical | A ausência de um controle nomeado não pode ser confundida com segurança. |
| CLIN-01 | USER/DERIVED | Segurança clínica | A IA nunca fecha diagnóstico, prescrição, dispensação, cirurgia, alta ou comunicação de alto impacto sem revisão/aprovação humana autorizada; rascunho e registro assinado são distintos. | Fluxos clínicos e tool policy em `01-prd-cvg.md`, `04-motor-deepseek-e-plugins.md` e `05-seguranca-privacidade.md`. | critical | É o principal limite de dano da automação em contexto veterinário. |
| OPS-01 | DERIVED | Operação | Há SLOs provisórios ou decisão explícita de TBD, RTO/RPO propostos, telemetria, health/readiness, retry, idempotência, backup, restore e plano de degradação. | Inspeção de `06-operacao-qualidade-e-recuperacao.md`; targets sem baseline devem estar marcados como PROPOSED. | high | “State of art” precisa ser mensurável e recuperável, não apenas uma lista de tecnologias. |
| AAA-01 | USER/DERIVED | A1 Assistência segura | A1 possui princípios, controles, cenários de falha e critérios de aceite verificáveis. | Matriz AAA em `06-operacao-qualidade-e-recuperacao.md` e rastreabilidade em `08-rastreabilidade-e-decisoes.md`. | critical | Traduz “qualidade AAA” em uma barra que um crítico pode rejeitar. |
| AAA-02 | USER/DERIVED | A2 Administração íntegra | A2 cobre isolamento, RBAC/ABAC, prontuário, estoque, billing, auditoria, reconciliação e segregação de funções. | Inspeção da matriz de controles e dos invariantes de dados. | critical | Operação clínica sem integridade administrativa é um resultado incompleto. |
| AAA-03 | USER/DERIVED | A3 Aceleração governada | A3 cobre catálogo de ferramentas, política em cascata, budget, aprovação, sandbox, jobs, conhecimento, telemetria e revogação. | Matriz DeepSeek→controle→evidência e roadmap de implementação. | high | Impede que a IA seja apenas um chat sem governança operacional. |
| TRACE-01 | DERIVED | Rastreabilidade | Cada requisito crítico liga-se a pelo menos um limite arquitetural, contrato/invariante, risco e método de verificação; lacunas ficam abertas com dono e gatilho. | Inspeção de `08-rastreabilidade-e-decisoes.md`. | high | Permite continuar da documentação para implementação sem reconstruir a conversa. |
| PLAN-01 | USER/DERIVED | Execução | Existe plano por fatias verticais, dependências, gates DISCOVERY_READY/PRODUCT_DEFINED/TECHNICALLY_SPECIFIED/IMPLEMENTATION_READY/VERIFIED e próximo passo seguro. | Inspeção de `07-plano-execucao.md`; nenhuma etapa de código é executada nesta fase. | high | Converte arquitetura em trabalho recuperável e verificável. |
| DOC-03 | USER | Escopo | As únicas mutações desta fase são arquivos documentais dentro de `harness-corp/docs/`; nenhum arquivo fora desse diretório é alterado. | `find`, fingerprint antes/depois e `git status` do motor. | critical | É uma restrição explícita do usuário. |

## Critérios consultivos

- **UX-01:** cada papel trabalha em uma superfície adequada ao risco, com acessibilidade, estados vazios, erros acionáveis e baixa carga cognitiva.
- **PERF-01:** os alvos de latência, concorrência e tokens são definidos por workload real de recepção, consulta clínica, ferramenta e automação, não por média isolada.
- **ARCH-03:** novas seams, filas, caches, microsserviços e bounded contexts aparecem somente quando possuem responsabilidade, isolamento de falha, dono ou variação justificada.
- **DOC-04:** uma página tem um dono de fato; outras páginas apontam para ela sem duplicar regra mutável.

## Proveniência registrada

- Fonte de produto 1: `LionCorp-harness-corporativo.md` — ausente no workspace atual; SHA-256 histórico `27603d1a0e7095ae28eb9791d76eeb363a100f35f00298f3e654fcf5da0dc8e4`, não revalidado neste artifact.
- Fonte de produto 2: `CresceOS-harness-corporativo-b1H-gYRW2IU.md` — ausente no workspace atual; SHA-256 histórico `5529c269ea39cde8e2453134edf74220a9df36931a4d5010e221d9b194d12fe6`, não revalidado neste artifact.
- Motor: `deepseek-harness` em commit `6454e3270642c3a7551dcae4f7447e4032febd77`, versão de manifesto `0.1.1-rc.2`.
- Arquitetura do motor, SHA-256 `2441583a992479d8ab37cd1d2fafa7a39117274b4fe156d598e0b615bb5b1d8b`.
- Primer Cordis, SHA-256 `90e493ea854a8e23fed0fa6b973ade950d4fd100e6365c6ad52d83d3436f27e9`.
- Pipeline de tools, SHA-256 `4f2f0a8459db2da876c445bb86d66d909b8f648c2c03855217274d8067cad243`.
- Threat model do motor, SHA-256 `62e51a51eb470603b641add99fd54f8d62d20d446f76a4ea84caf108346a636a`.

## Controle de mudança

Este bar só pode ser revisado por mudança de escopo do usuário, nova evidência local que revele uma restrição obrigatória ou prova de que um método de medição é inválido. Uma revisão deve registrar critério antigo, critério novo, motivo, evidência, autor e data; não é permitido reduzir um target porque a arquitetura não o atende.

## Addendum de mudança controlada — v1 → v1.1

**Data:** 2026-09-07

**Motivo:** os três scouts independentes confirmaram duas restrições obrigatórias que não estavam suficientemente rejeitáveis no v1: dados clínicos percorrem stores adicionais quando entram no contexto model-visible, e os mecanismos de session/scope/approval/telemetry do motor não substituem isolamento transacional, autorização clínica, budget hard stop, auditoria durável ou recuperação.

**Evidência:** os retornos dos scouts foram somente leitura; a inspeção cruzada confirmou as limitações no snapshot fixado do `deepseek-harness-v2` — `docs/subsystems/session.md`, `tools.md`, `approval.md`, `sandbox.md`, `credentials.md`, `session-telemetry.md` e `security/threat-model.md` — além das limitações declaradas nas sínteses corporativas, hoje ausentes do artifact.

**Mudança:** v1.1 adiciona os critérios obrigatórios abaixo. Nenhum target existente foi reduzido.

| ID v1.1 | Fonte | Target rejeitável | Evidência exigida |
|---|---|---|---|
| EV-01 | REFERENCE | Toda afirmação de capacidade distingue documentação, implementação e teste; vídeo/mock não é prova de runtime. | Matriz de proveniência, fingerprint e inspeção do artifact. |
| DATA-02 | DERIVED | Retenção, exportação e eliminação são coerentes em DB, object, vector, session, cache, backup, provider e telemetry. | Lifecycle ponta a ponta com dados sintéticos. |
| DATA-03 | DERIVED | Cache/endpoint local possui criptografia, revogação, atualização confiável, wipe e recuperação definidos. | Device-loss/revoke/restore drill. |
| ISO-01 | DERIVED | Tenant/workspace/actor/resource são aplicados em DB, vector, object, cache, session, billing, export e backup. | Testes negativos de cross-scope em cada store. |
| ISO-02 | DERIVED | Policy, session e credential estão vinculadas a contexto revogável com TTL/version/hash. | Revogação, cache offline e mudança de workspace. |
| AUTH-02 | DERIVED | Break-glass/Admin Master/suporte têm escopo, motivo, janela, aprovação e auditoria. | Teste de segregação e revisão de acesso excepcional. |
| AUTH-03 | DERIVED | Approval está ligado a hash de argumentos, recurso, estado, policy revision, actor e expiração. | Mutação entre approval e dispatch deve negar. |
| INJ-01 | REFERENCE | Documento, memória, RAG, MCP, e-mail e web são conteúdo não confiável e não alteram autoridade. | Red-team de prompt injection. |
| INJ-02 | DERIVED | Tool nativa, local, MCP, skill e Code Mode obedecem à mesma autorização e egress policy. | Bypass, nested dispatch e ferramenta comprometida. |
| INT-01 | DERIVED | Efeito externo clínico é idempotente e recuperável sob timeout, retry e crash. | Resposta perdida, retry e reconciliação. |
| INT-02 | DERIVED | Cada integração possui identidade, escopo, versão, webhook, erro e reconciliação. | Contrato executável e integração isolada. |
| BUD-01 | DERIVED | Reserva atômica e hard stop cobrem tokens, mídia, transcrição, MCP, retry e nested calls. | Stub de provider com falha/duplicidade. |
| BUD-02 | DERIVED | Ledger reconcilia uso, provider e cobrança sem duplicação. | Crash/out-of-order/late usage. |
| AUD-01 | DERIVED | Auditoria crítica é durável e independente da telemetria. | Acesso ao ledger e perda do sink de telemetry. |
| AUD-02 | DERIVED | Auditoria contém contexto suficiente sem segredo/PII desnecessário. | Redaction e inspeção de payload. |
| REL-03 | DERIVED | Timeouts, cancelamento, retry, backpressure e poison messages são bounded. | Fault injection e fila cheia. |
| REL-04 | DERIVED | Escala é medida com workload, concorrência, tokens, tools, providers e p95/p99. | Benchmark W-A…W-H. |
| OBS-02 | DERIVED | Telemetry tem redaction, retenção, perda e duplicação explicitamente tratadas. | Known-good/known-bad e collector indisponível. |
| AI-01 | DERIVED | Modelos, prompts, skills, MCPs e versões têm origem, aprovação, avaliação, rollback e kill switch. | Registry/admission/rollback test. |
| VER-01 | DERIVED | Eventos clínicos e contratos têm versão, migração e restore seguro. | Mixed-version replay e rejeição de evento desconhecido. |

**Bar ativo:** v1.1. As linhas v1 permanecem válidas; as linhas v1.1 são release-blocking quando aplicáveis. Os targets numéricos de `06-operacao-qualidade-e-recuperacao.md` continuam `PROPOSED` até baseline e autoridade.

## Estado de verificação desta fase

`NOT_RUN`: o CVG-Corp ainda não possui implementação, suíte de testes, benchmark, deploy ou integração operacional. Os documentos desta fase descrevem o alvo e os métodos que deverão ser executados durante BUILD; eles não provam comportamento de runtime.
