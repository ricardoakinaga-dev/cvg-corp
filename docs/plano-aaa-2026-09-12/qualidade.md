# Barra de qualidade e rastreabilidade AAA

## Autoridade e integridade

A barra ativa é [`.gauntlet/bar-v4.json`](../../.gauntlet/bar-v4.json), ID `CVG-BAR-2026-09-11-FINAL-PROMPT`, SHA-256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`. Sua fonte é o [prompt operacional final](../prompt-final-operational-proof-2026-09-10.txt), digest `39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3`. O [verificador](../../scripts/verify-triplo-aaa.ts) executa o contrato de promoção. Este planejamento não muda esses arquivos.

O prompt arquitetural anterior ajuda a interpretar produto, mas sua numeração F0–F40 e piso uniforme 95 não substituem F0–F38 e os limiares da barra v4. Cada contrato planejado é derivado da auditoria, código e barra existentes; critérios novos derivados de hipótese precisam de método e decisão explícitos antes de implementar.

## Metas obrigatórias

- Piso de candidatura: 95; Overall ≥97; cada uma das 22 dimensões precisa do seu próprio limiar e evidência.
- Zero CRITICAL/HIGH não resolvido, zero hard blocker, fases obrigatórias aprovadas e revisão independente atual.
- `NOT_RUN`, `BLOCKED`, `INVALID`, `STALE` e `FAIL` não são PASS; notas ausentes no scorecard de promoção ficam null.
- Mesmo sujeito: HEAD/sourceSha/ciSha/artifactSha, digests dos artefatos e worktree limpo segundo o verificador.
- Não converter a média local 72/100 em nota AAA, nem atribuir a nota-meta ao terminar uma tarefa.

| Dimensão canônica | Limiar | Áreas responsáveis |
|---|---:|---|
| `architecture` | 97 | ARC |
| `domainIntegrity` | 97 | CON, DAT, FUN, FIN |
| `security` | 97 | SEC |
| `authentication` | 97 | SEC |
| `authorization` | 97 | CON, SEC |
| `pdp` | 97 | SEC |
| `toolGateway` | 97 | AIG |
| `database` | 97 | DAT |
| `reliability` | 97 | WRK, FIN, PER |
| `workers` | 96 | WRK |
| `deepseek` | 95 | AIG |
| `aiGovernance` | 97 | AIG |
| `providerIntegration` | 95 | WRK |
| `frontend` | 95 | FUN, UX |
| `accessibility` | 95 | A11Y |
| `testing` | 97 | QUA |
| `observability` | 95 | OPS |
| `performance` | 95 | PER |
| `recovery` | 97 | OPS |
| `devOps` | 96 | DEV |
| `supplyChain` | 95 | SUP |
| `productionReadiness` | 95 | DEV, DOC |

## Ponte das 16 áreas para a promoção

Cada item tem sua ficha com roadmap próprio. Uma dimensão pode depender de várias áreas; seu resultado só é fechado depois de integrar todas elas. Documentação não é dimensão autônoma do verificador atual: DOC recebe meta de planejamento 95, e fornece suporte transversal ao aceite, sem inventar uma 23ª dimensão.

| Área | Baseline local | Meta de área planejada | Dimensões relacionadas |
|---|---:|---:|---|
| Arquitetura e manutenção (ARC) | 72 | 97 | architecture |
| Contratos e validação de entrada (CON) | 88 | 97 | domainIntegrity, authorization |
| Autenticação, autorização e sessão (SEC) | 76 | 97 | security, authentication, authorization, pdp |
| Governança de IA (AIG) | 86 | 97 | aiGovernance, toolGateway, deepseek |
| Persistência e integridade (DAT) | 78 | 97 | database, domainIntegrity |
| Worker e resiliência (WRK) | 80 | 97 | workers, reliability, providerIntegration |
| Completude funcional (FUN) | 58 | 97 | domainIntegrity, frontend |
| Correção do financeiro (FIN) | 50 | 97 | domainIntegrity, reliability |
| Interface e usabilidade (UX) | 84 | 95 | frontend |
| Acessibilidade (A11Y) | 90 | 95 | accessibility |
| Testes e confiabilidade das verificações (QUA) | 72 | 97 | testing |
| Desempenho e escalabilidade (PER) | 58 | 97 | performance, reliability |
| Observabilidade e recuperação (OPS) | 72 | 97 | observability, recovery |
| Dependências e cadeia de fornecimento (SUP) | 85 | 95 | supplyChain |
| CI/CD e prontidão para produção (DEV) | 45 | 96 | devOps, productionReadiness |
| Documentação e rastreabilidade (DOC) | 60 | 95 | productionReadiness |

## Cobertura das fases e receipts

As fases abaixo conservam IDs e nomes da barra. `Tarefas` identifica quem produz a prova; o Lead consolida o receipt da gate dona. Relatório genérico, fixture ou soma de tarefas não substitui o artefato de execução requerido. Esta tabela é derivada do catálogo; nenhum PASS foi emitido.

| Fase obrigatória | Gate dona | Tarefas vinculadas |
|---|---|---|
| F0-reauditoria-final | `critics` | AAA-000, DEV-04, DOC-01 |
| F1-pdp-universal-de-verdade | `universalPdp` | SEC-02, AIG-01 |
| F2-authoritative-writes-universais | `authoritativeWrites` | DAT-02 |
| F3-deepseek-harness-real | `deepseek` | AIG-02 |
| F4-deepseek-failure-matrix | `deepseek` | AIG-03 |
| F5-provider-externo-real | `provider` | WRK-03 |
| F6-provider-chaos | `provider` | WRK-03 |
| F7-durable-idempotency-sob-concorrencia | `postgresConcurrency` | DAT-02, FIN-03 |
| F8-postgresql-multi-instance | `postgresConcurrency` | DAT-01, DAT-02 |
| F9-worker-handlers-reais | `resourcePressure` | WRK-01, WRK-02 |
| F10-backpressure | `resourcePressure` | WRK-01, WRK-02, PER-03 |
| F11-secret-authority-real | `secretAuthority` | SEC-03 |
| F12-webauthn-break-glass-real | `webauthnBreakGlass` | SEC-03 |
| F13-observability-staging | `staging` | OPS-01 |
| F14-alert-delivery-real | `observability` | OPS-01 |
| F15-slo-measurements | `observability` | PER-03 |
| F16-load-test-production-like | `load` | PER-03 |
| F17-chaos-infra | `chaos` | PER-03 |
| F18-recovery-real | `recovery` | DAT-04, OPS-03 |
| F19-rto-rpo | `rtoRpo` | OPS-03 |
| F20-backup-operacional | `restore` | OPS-02 |
| F21-full-browser-matrix | `browserMatrix` | A11Y-01, A11Y-03 |
| F22-accessibility-real | `browserMatrix` | A11Y-02, A11Y-03 |
| F23-security-red-team | `critics` | SEC-04 |
| F24-db-security-red-team | `critics` | SEC-04 |
| F25-audit-immutability | `authoritativeWrites` | DAT-03 |
| F26-usage-settlement | `provider` | AIG-03, FIN-03 |
| F27-export-hardening | `universalPdp` | DAT-03 |
| F28-ci-do-mesmo-sha | `ciSameSha` | SUP-03, DEV-01 |
| F29-release-provenance | `ciSameSha` | QUA-02, SUP-02, SUP-03 |
| F30-container-smoke-real | `containerSmoke` | DEV-03 |
| F31-resource-pressure-test | `resourcePressure` | WRK-02, PER-03 |
| F32-security-headers-real | `securityHeaders` | DEV-03 |
| F33-production-config-fail-closed | `productionConfig` | DEV-03 |
| F34-staging-promotion-model | `stagingPromotion` | SUP-03, DEV-05 |
| F35-runbook-execution | `runbookExecution` | OPS-03 |
| F36-final-gauntlet | `critics` | DEV-04 |
| F37-repair-loop | `repairLoop` | DEV-04 |
| F38-human-approval-gate | `humanApproval` | DEV-05 |

Os 25 nomes de gates em `backlog.json.gate_phases` devem permanecer iguais a `PROMOTION_GATE_PHASES`. O validador do planejamento verifica nomes, numeração, cobertura de tarefas e digest da barra; não verifica se os efeitos operacionais ocorreram.

## Evidência por gate e julgadores

Cada entrada do scorecard requer `score`, `evidence`, `sha`, `test`, `artifact`, `limitations` e `residualRisk`. Os bundles e receipts finais devem satisfazer as estruturas exatas dos verificadores existentes; o modelo genérico do protocolo multiagente não as substitui.

As provas externas usam raiz fora do checkout definida por `CVG_TRIPLO_EVIDENCE_ROOT`. Assinaturas e autoridades são verificadas pelas referências públicas configuradas, incluindo `CVG_EXTERNAL_EVIDENCE_PUBLIC_KEY`, `CVG_INDEPENDENT_REVIEW_PUBLIC_KEY` e `CVG_RELEASE_APPROVAL_PUBLIC_KEY`; a proveniência especializada de DeepSeek/provider tem suas chaves próprias. O planejamento não cria ou distribui essas chaves.

F23 e F24 exigem artefatos distintos com seus 16 e 8 critérios. A gate critics exige as especialidades: architecture, security, authorization, database, reliability, AI safety, DeepSeek, provider, worker, observability, frontend, accessibility, recovery, DevOps e production readiness. São revisões novas do candidato, não notas herdadas desta auditoria.

O smoke precisa observar shutdown/outbox/replay/restart, além de jornada autenticada. CI deve estar ligada a SBOM e imagens efetivamente avaliadas. `humanApproval` só é satisfeita pela decisão humana verificável, não por um agente marcando aceite.

## Critérios observáveis por classe de prova

| Classe | Evidência mínima | Caso que deve falhar |
|---|---|---|
| Correção A01/A02 | Reproduzir antigo; nova expectativa correta por UI/API e sessão/ledger | Logout sem confirmação rotulado concluído; pago entra em aberto |
| Policy/dados | API, tools e SQL negativos; role real sem bypass e dois processos | Cross-tenant, privilégio revogado, efeito duplicado, audit alterada |
| IA/provider | Verticais reais, engine/model identificados e receipts/usage | Fallback, approval inválida, unknown tratado como sucesso, callback duplicado |
| Recuperação | Backup/restauração real, pós-watermark, quarentena e tempo medido | Restore ressuscita acesso/dado ou reenvia efeito desconhecido |
| Performance | Workload/ambiente/seed congelados e séries p50/p95/p99, erro e saturação | Apenas média ou benchmark de fixture para alegar capacidade de produção |
| Frontend/assistividade | Browsers selecionados, estados críticos, humano/tecnologia assistiva | Screenshot/axe substituir leitor de tela ou skip contar como cobertura |
| Proveniência | Bytes/digests/SHA/assinaturas e artefatos de execução | Mudar fonte/imagem/SBOM, refazer timestamp de prova antiga, autoassinar aprovação |

## Targets de operação ainda propostos

Preservar os alvos propostos em [operação e recuperação](../06-operacao-qualidade-e-recuperacao.md): p95 transacional ≤300 ms, salvamento clínico ≤500 ms, policy ≤100 ms, AI TTFT p95 ≤5 s na amostra definida; erro técnico <0,1%, disponibilidade mensal 99,9%, RPO ≤5 min e RTO ≤60 min. Não são medições atuais nem compromisso aceito.

PER-01 documenta hardware, volumes, W-A…W-H, concorrência, sample size, cold/warm e custos. Operação decide os alvos antes do teste final e conserva histórico de mudanças; só uma falha do método/requisito pode justificar revisão, nunca acomodar resultado ruim. OPS-03 mede RTO/RPO de fato. Uma execução de minutos não comprova disponibilidade mensal: a janela real deve permanecer explícita e o critério não observado continua pendente.

## Rastreabilidade dos achados da auditoria

| Achado | Tarefas de resolução principais |
|---|---|
| A01 — logout | SEC-01, UX-01, SEC-02 |
| A02 — saldo financeiro | FIN-01/02/03/04, CON-02 |
| A03 — teste dependente do Git | QUA-01 |
| A04 — evidência/commit divergentes | QUA-02, DEV-01, DOC-01/03, SUP-03 |
| A05 — árvore de dependências divergente | SUP-01/02, DEV-01 |
| A06 — ações incompletas | FUN-01/02/03, FIN-02, UX-02/03 |
| A07 — concentração e capacidade não medida | ARC-01/02/03, PER-01/02/03, DAT-02 |
| A08 — prova operacional ausente | SEC-03/04, AIG-02/03, WRK-03, DAT-04, OPS-01/02/03, DEV-02/03/04/05 |
| A09 — lint/tokens | QUA-03, UX-02, A11Y-01/03 |

## Política de mudança e score

Antes de BUILD, o Lead congela o checksum do contrato e registra método/baseline por critério. Uma mudança material requer razão, fonte, diff do contrato, tarefas impactadas e revalidação; nunca editar barra imutável no curso de uma tarefa para passar. Mudança legítima da barra exige novo artefato versionado e compatibilidade deliberada com o verificador, conservando v4.

Notas são atribuídas após evidência integrada e crítica, com âncoras observáveis. Os campos score do manifesto não devem ser preenchidos automaticamente a partir de contagem de testes, conclusão de backlog ou meta declarada. Enquanto houver gate obrigatório ausente, o veredito continua AAA_NOT_PROVEN, mesmo que notas locais tenham melhorado.
