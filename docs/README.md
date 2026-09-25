# CVG-Corp — Programa de Gestão do Centro Veterinário Guarapiranga

Este diretório contém a documentação da arquitetura-alvo de um programa de gestão clínico, operacional, administrativo e de automação inteligente para o Centro Veterinário Guarapiranga.

## Fotografia inicial — auditoria de 23/09/2026

A [auditoria de 23/09](auditoria-repositorio-2026-09-23.md) atribuiu **68/100** à qualidade técnica e **35/100** à prontidão para produção na árvore de trabalho local auditada. O pacote desta data contém [50 melhorias priorizadas](melhorias-50-priorizadas-2026-09-23.md), [plano executivo](plano-executivo-2026-09-23.md), [roadmap proposto](roadmap-2026-09-23.md) e [backlog de critérios](backlog-2026-09-23.md). A fotografia inicial não é uma afirmação sobre cada revalidação posterior.

Na fotografia inicial, o registro de respostas cobria 80/80 schemas específicos, 24/32 coleções estavam `SNAPSHOT_PRIMARY`, a raiz externa AUD27 existia mas não correspondia ao fingerprint da árvore, `npm test` tinha uma falha e os gates de control plane e licenças estavam vermelhos. A [reauditoria AUD27 de 21/09](auditoria-resultado-cvg-aud27-2026-09-21.md) é histórica; o fingerprint `sha256:585ac671…` pertence ao pacote AUD26, conforme registrado em [12-estado-da-implementacao.md](12-estado-da-implementacao.md).

## Fontes de execução

- **Requisitos propostos:** [MEL23-001..050](backlog-2026-09-23.md) e [roadmap MEL23](roadmap-2026-09-23.md).
- **Relação sem duplicar tarefas:** [reconciliação MEL23→AUD27](mel23-aud27-reconciliation.json); o status continua em `.agent/backlog.json#items`.
- **Vocabulário controlado:** [status e estado de evidência](mel23-status-vocabulary.md).
- **Decisões humanas pendentes:** [pacote de revisão da política de licenças](third-party/license-policy-review-2026-09-23.md); não declara licença raiz nem amplia a política.
- **Validação documental:** `npm run verify:docs-integrity`; **matriz automática de evidência:** `npm run verify:mel23-evidence`.

O estado operacional deve ser lido no último checkpoint deste índice e nos recibos atuais em `.agent`. `PROPOSED` identifica o plano MEL23; status de execução pertencem às tarefas AUD27. Os relatórios datados abaixo preservam a fotografia de sua própria execução.

## Revalidação local anterior — 24/09/2026 (superseded pela revalidação pós-MEL24)

Esta seção preserva a fotografia da rodada anterior. A contagem de 735 testes e os gates listados abaixo descrevem aquela execução; a fotografia corrente está na seção seguinte.

Na revalidação corrente de 24/09, `npm test` passou com 735 testes (734 pass, 0 fail, 1 skip); typecheck, lint, build, schema manifest, verificadores static e semântico, migration harness, integridade documental e control plane também passaram. Os testes exercitam as 105 rotas, validam os 80 schemas específicos e têm fixtures de sucesso com schema para 103/105 respostas no runtime em memória, mais 2/2 respostas PostgreSQL duráveis. As 45 rotas GET têm fixtures explícitas de sucesso; 41/45 retornaram payload autenticado com dados e as outras quatro têm fixtures de sucesso próprias além dos probes 404 versionados por ID sintético. O callback de integração respondeu `202/PROCESSED` após HMAC-SHA256 sintético; a exportação governada respondeu `201` com envelope AES-256-GCM sintético. Os logs atuais estão nos diretórios `aud27-products-backfill-20260924-current`, `aud27-24-slices-20260924-current`, `aud27-normalized-writes-20260924-current`, `aud27-migration-protocol-20260924-current` e `mel23-response-route-postgres-20260924-current` sob `artifacts/operational-proof/`.

O [relatório MEL23 corrente](../artifacts/operational-proof/mel23-evidence-matrix-current.json) registra por critério o resultado, recibo, ambiente e fingerprint; use seus dados, em vez de contagens de checkpoints anteriores. MEL23-021 agora tem prova local de sucesso para 105/105 rotas, distribuída entre fixtures em memória e as duas respostas PostgreSQL; isso não qualifica candidato congelado nem autoriza dados reais, provedores externos ou promoção.

Os bancos PostgreSQL 16 usados nesta rodada eram distintos, vazios, loopback-only e tmpfs; cada um foi removido após sua verificação. O protocolo AUD27 aplicou 49 migrations e passou crash antes/depois de checkpoint, recuperação, replay, rollback e escopo tenant. A prova normalizada passou escrita/removal de produto; a prova de 24 slices passou paridade de linha e contagem 24/24, replay sem duplicatas, rollback e rejeição de linha-semente ausente. O backfill sombra adicional de `products` passou dry-run sem DML, paridade de digest integral, replay, drift quarantine, rollback/retomada, recuperação de crash pós-commit via SIGKILL e concorrência de SKU. Esses dados são sintéticos e não demonstram backfill de produção, restore pós-cutover ou mudança de autoridade; `products` permanece `SNAPSHOT_PRIMARY` e 24/32 coleções continuam `SNAPSHOT_PRIMARY`.

O [crosswalk MEL23→AUD27](mel23-aud27-reconciliation.json) mantém 50 requisitos ligados a tarefas AUD27 existentes, sem itens MEL23 duplicados. A matriz corrente é derivada dos recibos focais em `.agent/verification.jsonl` e do fingerprint observado; leia a qualificação e os bloqueios diretamente no relatório vinculado acima. A raiz externa AUD27 e a licença raiz ainda exigem reconciliação/decisão humana; veja o [pacote de revisão de licenças](third-party/license-policy-review-2026-09-23.md). O sujeito continua dirty e `UNFROZEN_UNTIL_AUD27-004`.

Em execução local anterior, a matriz E2E executou 503/540 casos em 12 projetos: 503 passaram, 37 foram skips explícitos e não houve falhas. WebKit precisou de workaround local temporário; tecnologia assistiva e aceite humano não foram avaliados. Imagens API e web foram construídas apenas localmente com BuildKit SBOM/proveniência e escaneadas por Trivy: API com 0 vulnerabilidades altas/críticas (15 médias, 7 baixas) e web com 0 vulnerabilidades; ambos sem achados de segredo no scan. A verificação de secrets do repositório ainda aponta um valor genérico com formato de API key em trace Playwright gerado; nenhuma allowlist foi adicionada. As classificações de licença do Trivy se referem aos pacotes do sistema operacional e não substituem o audit npm. Digest, SBOM e proveniência locais não foram publicados, assinados nem aceitos por issuer externo.

No Compose sintético, API e worker executaram como UID 65532, com root filesystem somente leitura e capacidades removidas. Postgres, API, web, worker e proxy ficaram saudáveis; a rede `backend` continuou interna e apenas o proxy entrou também na rede publicável `edge`. Pela porta de loopback `127.0.0.1:45001`, login e gravação/leitura sintéticos passaram; a leitura persistiu após reinício da API e novo login. Isso verifica a topologia local, não TLS/egress em produção. A edge dá egress ao proxy, portanto a política de firewall externa ainda precisa ser definida e observada.

O pacote externo AUD27 ainda não aceita o fingerprint observado; staging, registry/issuer e evidência externa, providers reais, autoridade de segredo, decisão legal e aprovação humana seguem abertos. O sujeito continua `UNFROZEN_UNTIL_AUD27-004`, com `PROMOTION_BLOCKED / AAA_NOT_PROVEN`.

## Revalidação pós-auditoria MEL24 — 24/09/2026

A execução do pacote [MEL24](./roadmap-2026-09-24.md) restaurou a suíte e os gates estruturais na árvore local. `npm test` passou com 741 testes (740 aprovados, 0 falhas, 1 skip); `verify:coverage` passou acima do ratchet de 88,40%; as execuções consecutivas registraram 88,43%–88,48% de linhas e 76,69%–76,74% de branches (o artefato `artifacts/coverage-summary.json` registra a medição da rodada); `verify:architecture`, `verify:authoritative-writes`, `verify:secrets` e `verify:production --structural --skip-local-gates` também passaram. A causa-raiz da suíte vermelha era o duplo de teste `fakePool` respondendo sem `snapshot`/`snapshot_digest` à leitura do commit durável e sem projetar a tabela `products`; o seam de escrita AUD27 ganhou teste de contrato das 24 projeções; a cobertura ganhou margem com testes reais de continuidade da IA desabilitada e das distinções operacionais do copiloto. O sujeito continua dirty e `UNFROZEN_UNTIL_AUD27-004`: as provas acima são locais e não qualificam candidato congelado. Ver [auditoria de 24/09](./auditoria-repositorio-2026-09-24.md), [roadmap](./roadmap-2026-09-24.md), [backlog](./backlog-2026-09-24.md) e o adendo de execução no backlog.

Os gates externos e humanos do pacote MEL24 permanecem sem prova: congelamento Git (MEL24-007), licença de raiz (MEL24-013), staging, provedores reais, observabilidade externa, carga/caos/DR, WebKit/tecnologia assistiva e as duas qualificações independentes. `verify:mel23-evidence` e `verify:aud27-evidence-root` continuam bloqueados por fingerprint; 24/32 coleções seguem `SNAPSHOT_PRIMARY`.

## Revalidação MEL23-015/016/039 — imagens e Compose — 23/09/2026

As imagens locais API r4 e web r2 passaram por smoke com PostgreSQL descartável, identidade sintética, leitura/escrita, persistência após reinício e inspeção dos headers estáticos. O Compose de produção foi resolvido somente com variáveis sintéticas; Postgres e o inicializador do volume de backup receberam probes locais descartáveis. O relatório completo, digests, SBOMs, proveniência e scans está em [`mel23-container-smoke-supply-chain-2026-09-23.md`](verification/mel23-container-smoke-supply-chain-2026-09-23.md) e [`artifacts/operational-proof/mel23-image-smoke-2026-09-23/report.json`](../artifacts/operational-proof/mel23-image-smoke-2026-09-23/report.json). A API tem 22 vulnerabilidades médias/baixas sem versão corrigida indicada; web tem zero. As imagens foram construídas com a árvore dirty e ficam sem vínculo com candidato congelado. Egress externo do proxy, revisão de severidade, licença raiz, externalização/assinatura das attestations e aceite humano continuam pendentes; promoção permanece bloqueada.

## Estado histórico preservado — checkpoint CVG-AUD25

| Campo | Estado |
|---|---|
| Fase | CVG-AUD25; o fechamento `CVG-AUD24-003 = DONE` foi auditado e rejeitado |
| Escopo desta fase | Vincular autoridade e fingerprint à mesma conexão que executa o restore, provar known-bads em PostgreSQL real e então retomar corpus, rollback, least privilege e requalificação |
| Motor proposto | AgentRuntime e bridge ACP com PDP de aplicação, budget/settlement serializados por sessão, receipts com claim fence e fallback fail-closed; integração real ainda não provada |
| Qualidade | Regressão local: 576 testes, 575 pass, 0 fail e 1 skip; database 71/71, fault 34/34, typecheck, lint (238 arquivos), JSON/JSONL, diff e control plane passaram no sujeito auditado. PostgreSQL 16 descartável aplicou 44 migrations e o conhecido-bom passou. Porém, uma contraprova split-client levou uma conexão não validada a `BEGIN` e DML; a matriz negativa real e o rollback pelo entrypoint continuam ausentes. `verify:static` segue vermelho. Programa permanece `AAA_NOT_PROVEN` |
| Fonte de verdade clínica | O domínio transacional do CVG, não a conversa do agente |
| Próximo gate | `CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL`: reabrir AUD24-003 por append, invalidar dependentes e ativar a correção same-connection |

## Leitura recomendada

**Fotografia anterior (21/09/2026):** [reauditoria técnica AUD27](auditoria-resultado-cvg-aud27-2026-09-21.md), [roadmap AUD27](roadmap-melhorias-cvg-aud27-2026-09-21.md) e [backlog AUD27](backlog-melhorias-cvg-aud27-2026-09-21.md). O veredito era `PROMOTION_BLOCKED / AAA_NOT_PROVEN`. O pacote AUD26 permanece como registro histórico da fotografia `585ac671…`; o estado ativo atual deve ser consultado em `.agent`, sem inferir importação ou conclusão a partir deste índice.

**Histórico recente, superseded pelo pacote AUD21:** [fotografia local da rodada AAA3 de 14/09](rodada-aaa3-2026-09-14/README.md), [auditoria AAA2-02/E01](auditoria-continuacao-aaa2-02-2026-09-13.md) e [rodada AAA3 planejada](rodada-aaa3-2026-09-13/README.md). Esses documentos descrevem suas fotografias datadas, não o estado corrente.

**Auditoria anterior da entrega:** [auditoria com 18 achados](auditoria-entrega-2026-09-13.md) e [novo plano Triplo AAA com 33 tarefas](plano-triplo-aaa-pos-entrega-2026-09-13/README.md). Preserva as melhorias verificadas e relaciona todos os 38 contratos anteriores e 6 filhos; o catálogo novo ainda não foi ativado no estado do agente.

Auditoria de 13/09/2026: [relatório e evidências — 59/100](auditoria-2026-09-13.md) e [plano de melhorias](plano-melhorias-2026-09-13/README.md), com plano executivo, roadmap e 38 contratos de tarefa cobrindo os 21 achados. O novo pacote complementa o plano anterior, referencia suas tarefas e exige reconciliação antes da execução. As notas das auditorias não são automaticamente comparáveis.

Planejamento derivado da auditoria de 12/09/2026: [relatório com notas por área](auditoria-2026-09-12.md) e [programa executivo State of Art / Triplo AAA](plano-aaa-2026-09-12/README.md), com plano executivo, roadmap, 54 tarefas, 16 fichas de área e protocolo multiagente. É um pacote para implementação futura; os critérios de promoção continuam na barra v4 e os resultados históricos abaixo não são nova prova do candidato.

1. [`00-quality-bar-v1.md`](00-quality-bar-v1.md) — barra de aceite e proveniência registrada (v1.1).
2. [`00-fontes-e-premissas.md`](00-fontes-e-premissas.md) — o que foi observado, proposto ou deixado desconhecido.
3. [`01-prd-cvg.md`](01-prd-cvg.md) — produto, usuários, jornadas, regras e aceite.
4. [`02-arquitetura-alvo.md`](02-arquitetura-alvo.md) — limites de contexto, deploy e dependências.
5. [`03-dominio-dados-contratos.md`](03-dominio-dados-contratos.md) — entidades, estados, invariantes, eventos e contratos.
6. [`04-motor-deepseek-e-plugins.md`](04-motor-deepseek-e-plugins.md) — uso do DeepSeek Harness sem inventar capacidades atuais.
7. [`05-seguranca-privacidade.md`](05-seguranca-privacidade.md) — ameaças, autorização, privacidade e segurança clínica.
8. [`06-operacao-qualidade-e-recuperacao.md`](06-operacao-qualidade-e-recuperacao.md) — SLOs propostos, observabilidade, continuidade e testes.
9. [`07-plano-execucao.md`](07-plano-execucao.md) — fatias verticais, dependências e gates de implementação.
10. [`08-rastreabilidade-e-decisoes.md`](08-rastreabilidade-e-decisoes.md) — matriz requisito→design→risco→verificação e decisões pendentes.
11. [`09-gauntlet-verdict.md`](09-gauntlet-verdict.md) — veredito da crítica independente desta fase.

12. [`10-preparacao-m1.md`](10-preparacao-m1.md) — decisões confirmadas, matriz proposta, aceite local e tarefas restantes antes de BUILD.

13. [`11-transicao-para-producao.md`](11-transicao-para-producao.md) — demonstração, homologação, piloto e produção por escopo, com critérios de passagem.

14. [`12-estado-da-implementacao.md`](12-estado-da-implementacao.md) — matriz corrente de evidências, limites do runtime local e reprodução dos gates.
15. [`architecture-audit-vNext.md`](architecture-audit-vNext.md) — auditoria brownfield e plano de migração vNext.
16. [`production-readiness-vNext.md`](production-readiness-vNext.md) — fotografia histórica do gate operacional vNext, rotulada no próprio documento.
17. [`security-review-vNext.md`](security-review-vNext.md) — controles de segurança, dados e lacunas.
18. [`ai-runtime-vNext.md`](ai-runtime-vNext.md) — runtime, tools, PDP, adapter e proveniência.
19. [`deployment-vNext.md`](deployment-vNext.md) — artifact, Compose, CI, worker e runbooks.
20. [`verification-vNext.md`](verification-vNext.md) — comandos e evidências de sua fotografia histórica.
21. [`state-of-the-art-scorecard.md`](state-of-the-art-scorecard.md) — scorecard honesto da barra v3.
22. [`benchmarks/local-baseline.md`](benchmarks/local-baseline.md) — metodologia e baseline sintético, sem SLO de produção.
23. [`fault-matrix-vNext.md`](fault-matrix-vNext.md) — cenários de falha, recuperação e limites de execução.
24. [`error-taxonomy-vNext.md`](error-taxonomy-vNext.md) — envelope e taxonomia estável de erros.
25. [`auth-boundary-vNext.md`](auth-boundary-vNext.md) — MFA, rotação, lockout, recuperação e autoridade de sessão.
26. [`visual-qa-vNext.md`](visual-qa-vNext.md) — correções visuais, acessibilidade e limites da evidência.
27. [`prompt-final-operational-proof-2026-09-10.txt`](prompt-final-operational-proof-2026-09-10.txt) — cópia byte a byte do prompt operacional final recebido nesta execução.
28. [`prompt-state-of-the-art-triplo-aaa-2026-09-09.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09.txt) — cópia byte a byte do prompt de execução anterior.
29. [`prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt) — cópia byte a byte da revisão v2 anterior.
30. [`final-closure-audit.md`](final-closure-audit.md) — reaudit F0, blockers, plano, rollback e gates de promoção.
31. [`deepseek-production-integration.md`](deepseek-production-integration.md), [`deepseek-acp-bridge.md`](deepseek-acp-bridge.md), [`provider-production-integration.md`](provider-production-integration.md) — boundaries de AI e provider, com governança ACP explícita, matriz de contrato e limitações reais.
32. [`pdp-universal-coverage.md`](pdp-universal-coverage.md) — cobertura corrente de PDP, idempotência e repositories.
33. [`observability-production.md`](observability-production.md), [`staging.md`](staging.md) — observabilidade, TLS e pré-condições de staging.
34. [`load-and-chaos.md`](load-and-chaos.md), [`load-proof.md`](load-proof.md), [`recovery-proof.md`](recovery-proof.md) — contrato k6 fail-closed, evidência local e gates ainda não executados de carga, caos e recovery.
35. [`triple-aaa-final-scorecard.md`](triple-aaa-final-scorecard.md) — scorecard final honesto, sem declarar AAA.
36. [`production-reality-audit-vNext.md`](production-reality-audit-vNext.md) — fotografia corrente, blockers e limites de produção.
37. [`deepseek-integration-vNext.md`](deepseek-integration-vNext.md), [`provider-integration-vNext.md`](provider-integration-vNext.md) — boundaries históricos de runtime e provider com fail-closed.
38. [`observability-vNext.md`](observability-vNext.md), [`staging-vNext.md`](staging-vNext.md), [`recovery-vNext.md`](recovery-vNext.md), [`performance-vNext.md`](performance-vNext.md) — evidência, execução e limites operacionais históricos.
39. [`adr/019-universal-durable-command-idempotency.md`](adr/019-universal-durable-command-idempotency.md), [`verification-2026-09-10-durable-idempotency.md`](verification-2026-09-10-durable-idempotency.md) — fronteira de idempotência durável para comandos retryable e evidência desta lane.
40. [`adr/021-authoritative-normalized-guardian-write.md`](adr/021-authoritative-normalized-guardian-write.md), [`verification-2026-09-10-guardian-source-write.md`](verification-2026-09-10-guardian-source-write.md) — escrita normalizada autoritativa de Guardian, com replay e escopo contextual.
41. [`adr/022-authoritative-diagnostic-request-write.md`](adr/022-authoritative-diagnostic-request-write.md), [`verification-2026-09-10-diagnostic-request-source-write.md`](verification-2026-09-10-diagnostic-request-source-write.md) — escrita autoritativa de pedido de exame e backstop de escopo PostgreSQL.
42. [`adr/023-authoritative-diagnostic-child-writes.md`](adr/023-authoritative-diagnostic-child-writes.md), [`verification-2026-09-10-diagnostic-child-source-writes.md`](verification-2026-09-10-diagnostic-child-source-writes.md) e [`../.gauntlet/critique-diagnostic-child-writes-20260910.md`](../.gauntlet/critique-diagnostic-child-writes-20260910.md) — escritas autoritativas de espécime/resultado, escopo armazenado, backstop de integridade e replay seguro.
43. [`pdp-universal-proof.md`](pdp-universal-proof.md), [`authoritative-write-proof.md`](authoritative-write-proof.md), [`deepseek-real-proof.md`](deepseek-real-proof.md), [`provider-real-proof.md`](provider-real-proof.md) — proofs da fase operacional final, com status e limites explícitos.
44. [`postgres-concurrency-proof.md`](postgres-concurrency-proof.md), [`worker-production-proof.md`](worker-production-proof.md), [`observability-proof.md`](observability-proof.md), [`load-proof.md`](load-proof.md), [`chaos-proof.md`](chaos-proof.md) — evidência local e blockers de infraestrutura; `verify:postgres:concurrency` exige duas instâncias contra o mesmo banco e `verify:worker-runtime` cobre seis policies do worker (cinco handlers tipados e o relay outbox).
45. [`recovery-proof-final.md`](recovery-proof-final.md), [`accessibility-proof.md`](accessibility-proof.md), [`security-red-team-final.md`](security-red-team-final.md) — recovery, interface e segurança sem overclaim.
46. [`adr/024-runtime-route-catalog-admission.md`](adr/024-runtime-route-catalog-admission.md), [`adr/025-application-and-worker-policy-admission.md`](adr/025-application-and-worker-policy-admission.md) e [`adr/026-universal-authoritative-invariants.md`](adr/026-universal-authoritative-invariants.md) — admissão runtime, políticas de aplicação/worker e invariantes universais de writes.
47. [`release-provenance.md`](release-provenance.md) — vínculo fail-closed entre SHA, CI, SBOM, imagens, staging e candidate de produção, sem declarar promoção externa.
48. [`../artifacts/operational-proof/local-verification-2026-09-10.json`](../artifacts/operational-proof/local-verification-2026-09-10.json) — manifesto histórico da regressão local de 10/09, com contagens e limitações sem promoção.
49. [`usage-settlement-proof.md`](usage-settlement-proof.md) — contrato tipado de usage, custo/discrepância e limites de pricing externo.
50. [`api-compatibility-proof.md`](api-compatibility-proof.md) — catálogo v1, v2 preparado e registro de upcasters fail-closed para versões mistas.
51. [`adr/039-remote-route-store-isolation.md`](adr/039-remote-route-store-isolation.md), [`adr/040-snapshot-command-migration.md`](adr/040-snapshot-command-migration.md), [`adr/041-aud27-migration-harness.md`](adr/041-aud27-migration-harness.md), [`adr/042-egress-runtime-contract.md`](adr/042-egress-runtime-contract.md) e [`adr/043-aud27-run-serialization.md`](adr/043-aud27-run-serialization.md) — decisões novas após a sequência preservada ADR 034–038, incluindo a serialização do harness de migração.

Os procedimentos operacionais estão em [`runbooks/`](runbooks/), incluindo deploy, rollback, backup/restore, incidentes de banco e segurança, indisponibilidade de provider/DeepSeek, rotação de credenciais, backlog do worker, quarentena e o break-glass ainda bloqueado. O SDK/exporter OTLP está conectado em API, worker e bridge; o stack declarado de observabilidade está em [`docker-compose.observability.yml`](../docker-compose.observability.yml) e permanece `NOT_RUN` fora da prova local do exporter.

As decisões técnicas vNext estão em [`adr/`](adr/), com boundaries de runtime, PDP, tools, persistência, worker, secrets, release, DeepSeek, RLS, approval, fonte de verdade da IA, restore e o contrato do bridge em [`ADR-015`](adr/015-deepseek-bridge-contract.md) e [`ADR-028`](adr/028-deepseek-acp-governance-boundary.md).

## Princípio de leitura

`CURRENT` descreve uma capacidade ou fato observado nas fontes locais; `TARGET` descreve o resultado que o produto precisa atingir; `PROPOSED` registra uma escolha de projeto ainda sujeita a aprovação; `UNKNOWN` é uma lacuna que não pode ser preenchida por inferência segura.

O conteúdo dos vídeos e da documentação do motor é tratado como evidência de desenho e capacidade documentada, não como prova de implantação, segurança, conformidade, performance ou disponibilidade em produção.

## Resultado arquitetural resumido

O CVG-Corp é proposto como um sistema transacional modular para operação veterinária, com uma camada de IA governada pelo DeepSeek Harness. O sistema de registro mantém pacientes, tutores, consultas, prontuários, exames, internações, estoque, cobranças e auditoria; o harness executa sessões, ferramentas, aprovações, automações e recuperação dentro dos limites desse sistema.

O desenho adota três compromissos de qualidade:

- **A1 — Assistência segura:** a IA prepara, resume, alerta e sugere; um profissional habilitado confirma toda decisão clínica ou comunicação de alto impacto.
- **A2 — Administração íntegra:** cada dado tem dono, escopo, autorização, transação, auditoria e reconciliação.
- **A3 — Aceleração governada:** modelos, tools, MCPs, skills, memória, budget e jobs são versionados e fail-closed.

## Limite desta fase

A raiz do repositório contém o artifact B1–B6 e uma fatia durável PostgreSQL, com isolamento organizacional completo no catálogo, proveniência nas FKs, inbox/efeitos externos sintéticos e bundle de restore autenticado em quarentena verificados em banco sintético local, ainda não homologada para produção. Este diretório mantém o planejamento e as evidências; não há deploy, dados reais ou aceite de M1 completo. Propostas de milestones posteriores continuam sujeitas à confirmação aplicável.

51. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md` e `triple-aaa-final-scorecard.md` — revalidação VER-CVG-259 da precedência durável de reconciliação, auditoria/métrica por tentativa do outbox e cadeia hash-based, com promoção ainda bloqueada.

52. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md`, `triple-aaa-final-scorecard.md` e `worker-production-proof.md` — fotografia final VER-CVG-260, snapshot byte-bound, crítica fresh review-only e promoção bloqueada.

53. `postgres-concurrency-proof.md` — revalidação VER-CVG-261 das migrations 001–036, concorrência multiprocesso e restore local, sem promoção externa.

54. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md` e `triple-aaa-final-scorecard.md` — estado final VER-CVG-262, crítica fresh review-only e promoção bloqueada.

55. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md`, `triple-aaa-final-scorecard.md` e `worker-production-proof.md` — metadata final VER-CVG-267, snapshot reconciliado, crítica fresh review-only e promoção bloqueada.


56. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md`, `triple-aaa-final-scorecard.md` e `worker-production-proof.md` — VER-CVG-267: validação da forma bruta de autenticação antes da normalização, snapshot `dbc1da159294f9a04c8509f46b99b5a4a7a3cb5ab2a738094d6b7f0d88ee8b07`, crítica fresh review-only pendente e promoção bloqueada.

57. `final-operational-proof-audit.md`, `verification-2026-09-10-local-closure.md`, `triple-aaa-final-scorecard.md` e `worker-production-proof.md` — VER-CVG-268: digests canônicos dos campos imutáveis dos cinco ledgers de recovery, snapshot run `76518144d894beed7821e79789531bbe101c80db1ada5883303d161647c71ea4`, crítica fresh review-only e promoção bloqueada.

58. [`api-examples-v1.md`](api-examples-v1.md) — exemplos de login, Guardian, envelopes de sucesso/erro, headers de contexto/CSRF e contrato atual v1.
