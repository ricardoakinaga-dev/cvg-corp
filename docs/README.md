# CVG-Corp — Programa de Gestão do Centro Veterinário Guarapiranga

Este diretório contém a documentação da arquitetura-alvo de um programa de gestão clínico, operacional, administrativo e de automação inteligente para o Centro Veterinário Guarapiranga.

## Estado da entrega

| Campo | Estado |
|---|---|
| Fase | BUILD vNext; fundação de runtime/policy/tools, API e web modulares, worker separado, migrations 001–034, fila/heartbeats duráveis, boundary local de autenticação, provider/reconciliação fail-closed, cadeia de auditoria local, repositories normalizados e verificação determinística |
| Escopo desta fase | Evolução brownfield controlada; mock/sintético e PostgreSQL local continuam permitidos; aceite operacional independente e produção continuam pendentes |
| Motor proposto | `AgentRuntime` com adapter Mock e bridge DeepSeek `/v1` opcional; port nativo e protocolo externo ainda não provados |
| Qualidade | barra v3 `FAIL_WITH_LIMITATIONS`; `verify:triplo-aaa`/`verify:staging` fail-closed, recorte local executável incluindo sandbox HTTP de provider, produção bloqueada |
| Fonte de verdade clínica | O domínio transacional do CVG, não a conversa do agente |
| Próximo gate | PostgreSQL/Docker production-like, provider/consulta externa real, secret authority, observabilidade/carga/recovery, matriz de browsers/acessibilidade e aceite independente |

## Leitura recomendada

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
16. [`production-readiness-vNext.md`](production-readiness-vNext.md) — gate operacional e dependências ainda bloqueadas.
17. [`security-review-vNext.md`](security-review-vNext.md) — controles de segurança, dados e lacunas.
18. [`ai-runtime-vNext.md`](ai-runtime-vNext.md) — runtime, tools, PDP, adapter e proveniência.
19. [`deployment-vNext.md`](deployment-vNext.md) — artifact, Compose, CI, worker e runbooks.
20. [`verification-vNext.md`](verification-vNext.md) — comandos executados e evidência atual.
21. [`state-of-the-art-scorecard.md`](state-of-the-art-scorecard.md) — scorecard honesto da barra v3.
22. [`benchmarks/local-baseline.md`](benchmarks/local-baseline.md) — metodologia e baseline sintético, sem SLO de produção.
23. [`fault-matrix-vNext.md`](fault-matrix-vNext.md) — cenários de falha, recuperação e limites de execução.
24. [`error-taxonomy-vNext.md`](error-taxonomy-vNext.md) — envelope e taxonomia estável de erros.
25. [`auth-boundary-vNext.md`](auth-boundary-vNext.md) — MFA, rotação, lockout, recuperação e autoridade de sessão.
26. [`visual-qa-vNext.md`](visual-qa-vNext.md) — correções visuais, acessibilidade e limites da evidência.
27. [`prompt-state-of-the-art-triplo-aaa-2026-09-09.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09.txt) — cópia byte a byte do prompt de execução recebido.
28. [`prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt) — cópia byte a byte da revisão v2 recebida nesta execução.
29. [`final-closure-audit.md`](final-closure-audit.md) — reaudit F0, blockers, plano, rollback e gates de promoção.
30. [`deepseek-production-integration.md`](deepseek-production-integration.md), [`provider-production-integration.md`](provider-production-integration.md) — boundaries de AI e provider, com matriz de contrato e limitações reais.
31. [`pdp-universal-coverage.md`](pdp-universal-coverage.md) — cobertura corrente de PDP, idempotência e repositories.
32. [`observability-production.md`](observability-production.md), [`staging.md`](staging.md) — observabilidade, TLS e pré-condições de staging.
33. [`load-and-chaos.md`](load-and-chaos.md), [`recovery-proof.md`](recovery-proof.md) — evidência local e gates ainda não executados de carga, caos e recovery.
34. [`triple-aaa-final-scorecard.md`](triple-aaa-final-scorecard.md) — scorecard final honesto, sem declarar AAA.
35. [`production-reality-audit-vNext.md`](production-reality-audit-vNext.md) — fotografia corrente, blockers e limites de produção.
36. [`deepseek-integration-vNext.md`](deepseek-integration-vNext.md), [`provider-integration-vNext.md`](provider-integration-vNext.md) — boundaries históricos de runtime e provider com fail-closed.
37. [`observability-vNext.md`](observability-vNext.md), [`staging-vNext.md`](staging-vNext.md), [`recovery-vNext.md`](recovery-vNext.md), [`performance-vNext.md`](performance-vNext.md) — evidência, execução e limites operacionais históricos.
38. [`adr/019-universal-durable-command-idempotency.md`](adr/019-universal-durable-command-idempotency.md), [`verification-2026-09-10-durable-idempotency.md`](verification-2026-09-10-durable-idempotency.md) — fronteira de idempotência durável para comandos retryable e evidência desta lane.
39. [`adr/021-authoritative-normalized-guardian-write.md`](adr/021-authoritative-normalized-guardian-write.md), [`verification-2026-09-10-guardian-source-write.md`](verification-2026-09-10-guardian-source-write.md) — escrita normalizada autoritativa de Guardian, com replay e escopo contextual.
40. [`adr/022-authoritative-diagnostic-request-write.md`](adr/022-authoritative-diagnostic-request-write.md), [`verification-2026-09-10-diagnostic-request-source-write.md`](verification-2026-09-10-diagnostic-request-source-write.md) — escrita autoritativa de pedido de exame e backstop de escopo PostgreSQL.
41. [`adr/023-authoritative-diagnostic-child-writes.md`](adr/023-authoritative-diagnostic-child-writes.md), [`verification-2026-09-10-diagnostic-child-source-writes.md`](verification-2026-09-10-diagnostic-child-source-writes.md) e [`../.gauntlet/critique-diagnostic-child-writes-20260910.md`](../.gauntlet/critique-diagnostic-child-writes-20260910.md) — escritas autoritativas de espécime/resultado, escopo armazenado, backstop de integridade e replay seguro.

Os procedimentos operacionais estão em [`runbooks/`](runbooks/), incluindo deploy, rollback, backup/restore, incidentes de banco e segurança, indisponibilidade de provider/DeepSeek, rotação de credenciais, backlog do worker, quarentena e o break-glass ainda bloqueado. O SDK/exporter OTLP está conectado em API, worker e bridge; o stack declarado de observabilidade está em [`docker-compose.observability.yml`](../docker-compose.observability.yml) e permanece `NOT_RUN` fora da prova local do exporter.

As decisões técnicas vNext estão em [`adr/`](adr/), com boundaries de runtime, PDP, tools, persistência, worker, secrets, release, DeepSeek, RLS, approval, fonte de verdade da IA, restore e o contrato do bridge em [`ADR-015`](adr/015-deepseek-bridge-contract.md).

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
