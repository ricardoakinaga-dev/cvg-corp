# Verification vNext

**Data:** 2026-09-09 — fotografia local mais recente após os gates de CI/release, boundary de autenticação, PDP target-bound, scheduler do worker, contratos de SLO e fault harness

## Passe local atual

| Comando | Resultado | Observação |
|---|---|---|
| `npm run lint` | PASS | Lint repository-owned: newline, credenciais, storage de browser e imports proibidos |
| `npm run typecheck` | PASS | TypeScript sem emissão |
| `npm run test:contract` | PASS | Envelopes e descriptors versionados |
| `npm run test:security` | PASS | Auth, policy, gateway e fault-deny |
| `npm run test:database` | PASS | Persistência/recovery sintéticos |
| `npm run test:fault` | PASS | Worker e fault harness local |
| `npm test` | PASS — 70/70 | Unitário + integração, incluindo MFA, lockout, rotação, recovery manifest, PDP target-bound, scheduler/lifecycle do worker e fault harness |
| `npm run build` | PASS | Vite web + typecheck |
| `npm run verify:static` | PASS | 30 artefatos e 101 arquivos-fonte |
| recovery bundle manifest | PASS — bundle completo + 5 rejeições | watermark, tenant, digests de ledgers, partial, stale, migration mismatch, ciphertext adulterado e chave errada |
| application PDP / patient detail | PASS — fatia target-bound | Sessão autenticada, capability/operation registrada, resourceId, escopo persistido, projeção pelo `PatientApplicationService` e testes negativos de API/policy |
| `npm run test:e2e` | PASS — 22/22 executados | Chromium; mobile 375, tablet 768, desktop 1440; dois skips intencionais |
| `npm run audit:contrast` | PASS — 7/7 | pares WCAG de texto, banner, CTA e indicador de foco |
| `npm run audit:tokens -- --strict` | PASS | zero high/critical; 72 sinais medium heurísticos |
| `npm audit --omit=dev` | PASS | zero vulnerabilidades de produção |
| `npm run audit:licenses` | PASS | política SPDX aplicada a 193 dependências de terceiros |
| `npm sbom --sbom-format cyclonedx` | PASS | SBOM gerado a partir do lockfile |
| `npm run benchmark:local` | PASS limitado | baseline sintético com amostras brutas; não é SLO |
| `tests/integration/faults.test.ts` | PASS — 2 cenários | crash após marcador de dispatch e perda de lease; fixture determinística, não drill distribuído |
| `tests/unit/worker.test.ts` | PASS — 6 cenários | health, quarentena, ausência de sink, lifecycle, seis lanes do ciclo e falha isolada de runner |
| worker lane cycle | PASS — 6 lanes nomeadas | outbox, jobs, schedule, reconciliation, notifications e maintenance; contagens/status por lane e default-deny sem sink |
| SLO/alert evaluator | PASS — harness sintético | oito sinais tipados; targets sem aprovação permanecem `PROPOSED`/`TBD`; amostra ausente e avaliação sem evidência retornam `NOT_RUN`; alertas apontam para runbooks e não fazem dispatch |
| `npm run verify:production` | PASS limitado | Gates locais completos; Compose estrutural validado com valores sintéticos; nenhum serviço iniciado |
| `node --import tsx scripts/verify-production.ts --production` | FAIL-CLOSED esperado | configuração real ausente; o gate não autoriza defaults ou produção incompleta |
| `git diff --check` | PASS | Sem erro de whitespace |

## Não executado / bloqueado

PostgreSQL limpo e produção-like nesta fotografia, execução remota do CI, Docker image build/startup Compose, scan de imagens, DeepSeek real, secret manager/KMS, provider de TOTP/recuperação, providers externos, fault injection distribuído, restore operacional gerenciado, carga/benchmark production-like, collector/alertas operacionais/SLO medidos, Firefox/WebKit, axe/leitor de tela e aceite independente. O avaliador local de SLO/alertas é somente um contrato determinístico de harness: não é baseline, alerta enviado, capacidade ou aprovação de produção. O PDP target-bound foi provado somente na rota de detalhe de paciente; a aplicação inteira ainda não possui prova de uso universal do PDP/Tool Gateway. O scheduler do worker possui lanes e ciclo observáveis, mas jobs, schedule, reconciliação, notificações e manutenção reais continuam sem store/adapter configurado e ficam `BLOCKED`. O workflow agora declara gates bloqueantes para PostgreSQL efêmero, migrations, restore, E2E, segurança, visual, SBOM e containers, mas ele ainda não foi executado por um runner remoto nesta máquina. O fault harness local e o recovery manifest cobrem somente transições e validações determinísticas sem serviço externo; o manifesto não prova backup gerenciado, RTO/RPO ou restore de stores parciais. O histórico de drills PostgreSQL sintéticos permanece documentado em `docs/12-estado-da-implementacao.md`; ele não substitui o ambiente-alvo.

## Interpretação

O passe demonstra uma base compilável, testável e com controles locais de supply chain, uma fatia de autorização target-bound verificável, um ciclo de worker com default-deny observável e contratos de avaliação SLO fail-closed. Não demonstra disponibilidade, segurança, durabilidade, desempenho ou entrega externa em produção. A classificação correta continua `FAIL_WITH_LIMITATIONS`.
