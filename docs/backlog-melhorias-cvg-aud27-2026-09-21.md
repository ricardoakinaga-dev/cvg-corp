# Backlog executável CVG-AUD27

**Origem:** [reauditoria técnica AUD27](./auditoria-resultado-cvg-aud27-2026-09-21.md)
**Roadmap:** [roadmap executivo AUD27](./roadmap-melhorias-cvg-aud27-2026-09-21.md)
**Estado inicial dos itens:** `PROPOSED`
**Veredito inicial:** `PROMOTION_BLOCKED — AAA_NOT_PROVEN`

## 1. Regras do backlog

- Este documento propõe a rodada AUD27; ele não deve ser importado silenciosamente sobre a rodada AUD26 ativa.
- A importação para `.agent/backlog.json` e `.agent/state.json` deve ocorrer de forma append-only na tarefa AUD27-001.
- `DONE` exige todos os critérios de aceite, evidência atual, fingerprint aplicável e comandos reproduzíveis.
- `PARTIAL` exige evidência do que foi observado e lista explícita do que falta.
- `BLOCKED_EXTERNAL` e `BLOCKED_HUMAN` nunca são convertidos em sucesso por inferência.
- Rebind, plano ou descrição não substituem execução comportamental.
- O agente deve preservar alterações preexistentes e parar diante de conflito de ownership.

## 2. Resumo priorizado

| ID | Prioridade | Tamanho | Marco | Título | Depende de |
|---|---:|---:|---|---|---|
| AUD27-001 | P0 | M | M0 | reconciliar achados, tarefas e status AUD26 | — |
| AUD27-002 | P0 | L | M0 | criar manifest semântico e verificador adversarial | 001 |
| AUD27-003 | P0 | M | M0 | separar estados observado, planejado e bloqueado | 001, 002 |
| AUD27-004 | P0 | L | M1 | consolidar candidato Git limpo e reproduzível | 001 |
| AUD27-005 | P0 | L | M1 | criar evidence root externo, durável e ancorado | 002, 004 |
| AUD27-006 | P0 | L | M1 | substituir rebind-only e preencher evidências parciais | 003, 005 |
| AUD27-007 | P0 | M | M2 | congelar inventário dos contratos de resposta | 002 |
| AUD27-008 | P0 | XL | M2 | tipar respostas de auth, admin, operação e agenda | 007 |
| AUD27-009 | P0 | XL | M2 | tipar respostas clínicas, diagnóstico e assistência | 007 |
| AUD27-010 | P0 | XL | M2 | tipar respostas hospitalares, estoque, finanças, comunicação e IA | 007 |
| AUD27-011 | P0 | L | M2 | preparar harness real de migração dos 24 slices | 004 |
| AUD27-012 | P0 | XL | M2 | migrar slices clínicos e operacionais | 011 |
| AUD27-013 | P0 | XL | M2 | migrar hospital, medicação e estoque | 011 |
| AUD27-014 | P0 | XL | M2 | migrar finanças, comunicação, conhecimento e IA | 011 |
| AUD27-015 | P0 | L | M3 | provar build e smoke da imagem real | 004, 005 |
| AUD27-016 | P0 | M | M3 | resolver licenças e publicar licença de raiz | 001 |
| AUD27-017 | P1 | L | M3 | fixar imagens e provar supply chain/OCI | 015, 016 |
| AUD27-018 | P1 | L | M4 | endurecer coverage e adicionar mutation testing seletivo | 002 |
| AUD27-019 | P1 | L | M4 | qualificar WebKit e acessibilidade renderizada | 004, 005 |
| AUD27-020 | P1 | XL | M4 | decompor monólitos com limites automatizados | 008–014 |
| AUD27-021 | P1 | L | M5 | implantar logs duráveis, SLOs, dashboards e alertas | 004, 005 |
| AUD27-022 | P1 | XL | M5 | executar staging, carga, caos, restore e DR | 012–017, 021 |
| AUD27-023 | P1 | M | M6 | implementar protocolo de crítica independente selada | 005, 006 |
| AUD27-024 | P1 | M | M6 | consolidar documentação e snapshot final | 006–023 |
| AUD27-025 | P0 | L | M6 | executar dupla qualificação no mesmo candidato | 024 |
| AUD27-026 | P0 | M | M7 | fechar gates externos obrigatórios | 017, 019, 021, 022, 025 |
| AUD27-027 | P0 | S | M7 | obter decisão humana e emitir veredito final | 025, 026 |

Tamanhos: `S` pequeno, `M` médio, `L` grande e `XL` deve ser executado em sub-slices sem alterar o critério de saída.

## 3. Itens detalhados

### AUD27-001 — Reconciliar achados, tarefas e status AUD26

- **Prioridade / tamanho:** P0 / M
- **Achados:** A27-F01, F02, F03, F18, F20
- **Trabalho:** construir matriz canônica F01–F39 → tarefa AUD26 → título → critério → evidência; emitir eventos append-only corrigindo `CVG-AUD26-024`, `CVG-AUD26-026`, F38 e a declaração de encerramento.
- **Aceite:** 39 achados aparecem exatamente uma vez; nenhuma tarefa aponta para assunto divergente; o histórico original permanece intacto; correções são auditáveis.
- **Evidência:** matriz versionada, diff dos eventos, teste de unicidade e parecer de revisão.

### AUD27-002 — Manifest semântico e verificador adversarial

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F01
- **Trabalho:** criar fonte canônica machine-readable para semântica de achados e critérios; integrar ao control plane; adicionar fixtures deliberadamente erradas.
- **Aceite:** o verificador rejeita os deslocamentos conhecidos de AUD26, IDs duplicados, título incompatível, critério ausente e evidência de tipo incorreto; o caso correto passa.
- **Evidência:** testes positivos/negativos, log do gate e hash do manifest.

### AUD27-003 — Separar estados observado, planejado e bloqueado

- **Prioridade / tamanho:** P0 / M
- **Achados:** A27-F11, F18, F20
- **Trabalho:** evoluir schema de backlog/estado para registrar `observed`, `remaining`, `evidence_state`, `blocker_owner` e `blocker_type` sem inferir conclusão.
- **Aceite:** toda tarefa parcial informa prova do realizado e resto verificável; planos sem execução não contam como progresso observado; bloqueio local, externo e humano não se confundem.
- **Evidência:** schema, migração, fixtures e relatório de validação de todos os itens ativos.

### AUD27-004 — Consolidar candidato Git limpo e reproduzível

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F05
- **Trabalho:** inventariar alterações tracked/untracked, excluir somente artefatos realmente efêmeros, versionar o sujeito aprovado e congelar commit/manifest.
- **Aceite:** `git status --porcelain` vazio no freeze; checkout novo reproduz dependências, build e subject fingerprint; `sourceSha` corresponde ao candidato, e `clean_worktree_required` é verdadeiro.
- **Evidência:** commit assinado quando disponível, manifest, log de checkout limpo e reprodução em diretório novo.

### AUD27-005 — Evidence root externo, durável e ancorado

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F06, F12, F19
- **Trabalho:** criar local externo por rodada, impedir fallback silencioso, exportar recibos e ancorar digest em sistema fora do repositório.
- **Aceite:** o gate falha se a raiz não existe, não é gravável, está dentro do repo ou não contém o pacote esperado; alteração de recibo é detectada; nome da rodada é AUD27.
- **Evidência:** pacote externo, digest ancorado, teste de tamper e instrução de recuperação.

### AUD27-006 — Substituir rebind-only e preencher evidências parciais

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F10, F11
- **Trabalho:** ligar cada `DONE` à execução focal vigente e anexar prova tipada aos 14 parciais hoje sem referência; manter rebind apenas como metadado auxiliar.
- **Aceite:** zero `DONE` com prova exclusivamente `SUBJECT_REBIND`; zero `PARTIAL` com progresso declarado e `evidence_refs` vazio; aplicabilidade temporal validada.
- **Evidência:** relatório de completude, grafo tarefa→critério→recibo e testes de casos stale/inaplicáveis.

### AUD27-007 — Congelar inventário dos contratos de resposta

- **Prioridade / tamanho:** P0 / M
- **Achados:** A27-F04
- **Trabalho:** gerar inventário das 105 rotas, 80 schemas e consumidores; eliminar schema morto e definir regras de paginação, redaction e limites.
- **Aceite:** toda rota tem schema nominal, owner, versão e consumidores conhecidos; a geração falha para rota sem schema.
- **Evidência:** catálogo gerado, teste de completude e baseline de compatibilidade.

### AUD27-008 — Respostas de auth, admin, operação e agenda

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F04
- **Trabalho:** substituir envelopes genéricos por schemas específicos nesses domínios, com validação de runtime e contract tests.
- **Aceite:** todas as rotas do slice rejeitam payload extra/incompatível, preservam compatibilidade aprovada e cumprem limites de tamanho/redaction.
- **Evidência:** testes por rota, fixtures válidas/inválidas e relatório de clientes afetados.

### AUD27-009 — Respostas clínicas, diagnóstico e assistência

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F04
- **Trabalho:** aplicar a mesma disciplina aos endpoints clínicos e assistenciais, incluindo paginação, dados sensíveis e estados de erro.
- **Aceite:** cobertura contratual de 100% das rotas do slice; nenhum dado sensível fora do schema; clientes existentes passam nos testes de compatibilidade.
- **Evidência:** suite de contratos, snapshots de schema versionados e teste de redaction.

### AUD27-010 — Respostas hospitalares, estoque, finanças, comunicação e IA

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F04
- **Trabalho:** concluir os domínios restantes e remover o fallback genérico para qualquer schema catalogado.
- **Aceite:** 80/80 schemas têm validação específica; fallback existe apenas para erro explicitamente permitido e testado; inventário 007 permanece verde.
- **Evidência:** matriz 80/80, contract suite completa e teste que introduz schema ausente e observa falha.

### AUD27-011 — Harness real de migração dos 24 slices

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F07
- **Trabalho:** transformar o plano em executor idempotente com checkpoint, dry-run, paridade, auditoria, rollback e isolamento por tenant/slice.
- **Aceite:** dry-run e rollback passam em dataset representativo; reexecução não duplica dados; divergências bloqueiam cutover.
- **Evidência:** testes de migração, dataset dourado, recibos de paridade e runbook.

### AUD27-012 — Migrar slices clínicos e operacionais

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F07
- **Trabalho:** executar backfill, paridade, cutover e remoção de fallback para o primeiro grupo de slices, subdividido em PRs de um ou poucos slices.
- **Aceite:** todos os slices atribuídos ficam relational-primary; zero divergência não explicada; restore/replay passam; rollback foi ensaiado.
- **Evidência:** recibo por slice, contagens antes/depois, checksums e teste de fallback removido.

### AUD27-013 — Migrar hospital, medicação e estoque

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F07
- **Trabalho:** repetir o processo para hospital, medicamentos, farmácia e estoque, preservando concorrência e invariantes de quantidade.
- **Aceite:** operações concorrentes não geram saldo inválido; todos os slices do grupo deixam de usar snapshot como fonte primária.
- **Evidência:** recibos por slice, testes concorrentes, restore/replay e auditoria de invariantes.

### AUD27-014 — Migrar finanças, comunicação, conhecimento e IA

- **Prioridade / tamanho:** P0 / XL
- **Achados:** A27-F07
- **Trabalho:** concluir os slices restantes, incluindo idempotência financeira, filas/outbox, referências de documentos e metadados de IA.
- **Aceite:** `snapshot-primary = 0/32`; idempotência e replay comprovados; plano de migração marca todos os slices com evidência real, não inferida.
- **Evidência:** matriz final, testes de replay/duplicidade e restore completo.

### AUD27-015 — Provar build e smoke da imagem real

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F08
- **Trabalho:** construir a imagem do candidato, iniciar com configuração equivalente à produção, testar health/readiness, non-root, filesystem, persistência, sinais e shutdown.
- **Aceite:** a imagem inicia sem toolchain de dev; roda como usuário não root; health/readiness refletem dependências; SIGTERM encerra dentro do limite; smoke usa a imagem pelo digest.
- **Evidência:** digest, SBOM, log do build/start/smoke/shutdown e inspeção de usuário/capabilities.

### AUD27-016 — Resolver licenças e publicar licença de raiz

- **Prioridade / tamanho:** P0 / M
- **Achados:** A27-F02, F13
- **Trabalho:** classificar as 10 ocorrências, atualizar/substituir dependências ou documentar exceções aprovadas; adicionar `LICENSE`/`COPYING` compatível com a decisão do owner.
- **Aceite:** `npm run audit:licenses` passa; exceções, se houver, têm owner, justificativa e expiração; notices são gerados; licença raiz existe.
- **Evidência:** relatório legal/técnico, lockfile, gate verde, notices e aprovação humana quando necessária.

### AUD27-017 — Fixar imagens e provar supply chain/OCI

- **Prioridade / tamanho:** P1 / L
- **Achados:** A27-F14
- **Trabalho:** substituir tags mutáveis por digests, gerar SBOM/proveniência, escanear e assinar imagem no registry autorizado.
- **Aceite:** composes/manifests resolvem digests; scan atende política; assinatura e proveniência verificam; o digest promovido é o mesmo do smoke 015.
- **Evidência:** manifests, digest, SBOM, scan, assinatura e verificação no registry. Sem registry, manter `BLOCKED_EXTERNAL`.

### AUD27-018 — Endurecer coverage e mutation testing

- **Prioridade / tamanho:** P1 / L
- **Achados:** A27-F15
- **Trabalho:** definir métrica de statements ou justificativa equivalente, thresholds globais e por área crítica, ratchet sem regressão e mutation testing seletivo.
- **Aceite:** regressão de threshold falha; módulos de segurança, contratos, persistência e domínio têm metas explícitas; mutation score mínimo aprovado.
- **Evidência:** configuração, relatório de coverage, relatório de mutantes e testes de falha do gate.

### AUD27-019 — Qualificar WebKit e acessibilidade renderizada

- **Prioridade / tamanho:** P1 / L
- **Achados:** A27-F03, F16
- **Trabalho:** prover ambiente suportado para WebKit e executar contraste computado, teclado, foco, estados, zoom/reflow e leitor de tela nos fluxos prioritários.
- **Aceite:** suites Chromium/Firefox/WebKit passam sem skip indevido; zero violação crítica WCAG 2.2 AA; avaliação AT humana registrada.
- **Evidência:** relatórios de browsers, screenshots/traces, axe/contraste renderizado e checklist AT assinado. A etapa humana pode permanecer bloqueada até execução real.

### AUD27-020 — Decompor monólitos com limites automatizados

- **Prioridade / tamanho:** P1 / XL
- **Achados:** A27-F17
- **Trabalho:** extrair fronteiras coesas de persistence, API app, domain e contracts, preservando APIs e evitando ciclos; adicionar budgets de tamanho/complexidade.
- **Aceite:** cada extração tem characterization tests; nenhuma dependência circular nova; arquivos-alvo ficam abaixo dos limites aprovados; gate impede regressão.
- **Evidência:** grafo antes/depois, testes, métricas de tamanho/complexidade e ADRs de fronteira.

### AUD27-021 — Logs duráveis, SLOs, dashboards e alertas

- **Prioridade / tamanho:** P1 / L
- **Achados:** A27-F09
- **Trabalho:** enviar logs/métricas/traces a coletor durável, definir retenção, SLOs, alertas e runbooks com owner.
- **Aceite:** sinais sobrevivem ao processo; alertas disparam por sintomas; dashboards cobrem golden signals e fluxos clínicos; runbooks são exercitados.
- **Evidência:** consultas, screenshots/export dos dashboards, histórico de alerta e ata do exercício. Infraestrutura ausente permanece `BLOCKED_EXTERNAL`.

### AUD27-022 — Staging, carga, caos, restore e DR

- **Prioridade / tamanho:** P1 / XL
- **Achados:** A27-F09
- **Trabalho:** executar fluxo real em staging com provedores/segredos autorizados, carga e soak, falhas de dependência, restore e desastre regional/infraestrutural aplicável.
- **Aceite:** SLOs sob carga atendidos; retries/circuit breakers não amplificam falhas; restore preserva invariantes; RTO/RPO são medidos e aprovados; segredos não vazam.
- **Evidência:** relatórios de carga/caos, telemetria, logs redigidos, tempos de restore e aprovação operacional.

### AUD27-023 — Protocolo de crítica independente selada

- **Prioridade / tamanho:** P1 / M
- **Achados:** A27-F12
- **Trabalho:** definir pacote read-only, identidade/proveniência do revisor, instruções congeladas, sentinela de mutação e formato de parecer.
- **Aceite:** reviewer não recebe estado conversacional do builder; qualquer mutação invalida a rodada; parecer bruto e resumo ficam ligados ao pacote por digest.
- **Evidência:** protocolo, pacote de teste, hashes pre/post, parecer de ensaio e teste de mutação detectada.

### AUD27-024 — Consolidar documentação e snapshot final

- **Prioridade / tamanho:** P1 / M
- **Achados:** A27-F18, F20
- **Trabalho:** atualizar README, docs, ADRs, runbooks, OpenAPI/contratos e estado real; congelar snapshot final sem linguagem superior à evidência.
- **Aceite:** nenhum contador/status diverge entre fontes; links e exemplos funcionam; limitações e blockers aparecem no topo; docs validation e diff check passam.
- **Evidência:** relatório de links, validação documental, snapshot e revisão editorial/técnica.

### AUD27-025 — Dupla qualificação no mesmo candidato

- **Prioridade / tamanho:** P0 / L
- **Achados:** A27-F05, F06, F10, F11, F12
- **Trabalho:** congelar commit/fingerprint e executar duas qualificações independentes com pacote selado, uma delas em ambiente separado quando disponível.
- **Aceite:** ambos reproduzem o sujeito; todos os gates obrigatórios têm resultado; divergências são resolvidas por nova rodada, não por escolha arbitrária; worktree permanece imutável.
- **Evidência:** dois pareceres, logs, fingerprints, sentinelas e matriz de concordância. Se não houver segundo ambiente/revisor, manter bloqueado.

### AUD27-026 — Fechar gates externos obrigatórios

- **Prioridade / tamanho:** P0 / M
- **Achados:** A27-F09, F14, F16
- **Trabalho:** agregar, sem inferência, staging, providers, secrets, observabilidade, RTO/RPO, OCI/registry, WebKit/AT e demais aprovações externas.
- **Aceite:** cada gate possui owner, ambiente, timestamp, validade, artefato e resultado; falha ou ausência mantém `PROMOTION_BLOCKED`.
- **Evidência:** matriz externa assinada/atestada e links para artefatos imutáveis.

### AUD27-027 — Decisão humana e veredito final

- **Prioridade / tamanho:** P0 / S
- **Achados:** A27-F09
- **Trabalho:** apresentar riscos residuais, rollback, evidências e pareceres ao owner; registrar decisão sem substituí-la por automação.
- **Aceite:** owner aprova, rejeita ou registra exceção temporal com justificativa, escopo e expiração; o veredito publicado reflete exatamente a decisão e os gates.
- **Evidência:** sign-off humano, release record e, se aprovado, plano de rollback e monitoramento pós-release.

## 4. Matriz achado → tarefas

| Achado | Tarefas AUD27 |
|---|---|
| A27-F01 | 001, 002 |
| A27-F02 | 001, 016 |
| A27-F03 | 001, 019 |
| A27-F04 | 007, 008, 009, 010 |
| A27-F05 | 004, 025 |
| A27-F06 | 005, 025 |
| A27-F07 | 011, 012, 013, 014 |
| A27-F08 | 001, 015 |
| A27-F09 | 021, 022, 026, 027 |
| A27-F10 | 006, 025 |
| A27-F11 | 003, 006, 025 |
| A27-F12 | 005, 023, 025 |
| A27-F13 | 003, 016 |
| A27-F14 | 017, 026 |
| A27-F15 | 018 |
| A27-F16 | 019, 026 |
| A27-F17 | 020 |
| A27-F18 | 001, 003, 024 |
| A27-F19 | 005 |
| A27-F20 | 001, 003, 024 |

## 5. Definição global de pronto

A rodada AUD27 só pode ser marcada `DONE` quando:

1. as 27 tarefas estiverem concluídas ou, para gates genuinamente externos/humanos, houver resultado real e não mera classificação;
2. todos os P0 tiverem evidência atual no mesmo commit/fingerprint;
3. testes, typecheck, lint, build, contratos, coverage, licenças, container, PostgreSQL, restore, replay, browsers e gates estáticos passarem;
4. observabilidade, carga, caos e DR tiverem sido executados no ambiente-alvo autorizado;
5. dois revisores independentes concordarem no mesmo sujeito imutável;
6. o owner humano registrar a decisão de promoção.

Enquanto algum item obrigatório estiver ausente, o veredito permanece **`PROMOTION_BLOCKED — AAA_NOT_PROVEN`**.
