# Verification vNext

**Data:** 2026-09-09 — fotografia local final desta implementação após Tool Gateway durável, provider fail-closed, reconciliação, rate limit distribuído, Compose endurecido e gates AAA/staging

## Passe local atual

| Comando | Resultado | Observação |
|---|---|---|
| `npm run lint` | PASS | Lint repository-owned: newline, credenciais, storage de browser e imports proibidos |
| `npm run typecheck` | PASS | TypeScript sem emissão |
| `npm run test:contract` | PASS | Envelopes e descriptors versionados |
| `npm run test:security` | PASS | Auth, policy, gateway e fault-deny |
| `npm run test:database` | PASS | Persistência/recovery sintéticos |
| `npm run test:fault` | PASS | Worker e fault harness local |
| `npm test` | PASS — 111 testes (110 pass, 1 skip condicional) | Unitário + integração, incluindo MFA, lockout, rotação, recovery manifest, PDP target-bound, Tool Gateway/ledger, provider loopback/reconciliação, assinatura HMAC de contexto, scheduler/lifecycle do worker, OTLP redaction e fault harness |
| `npm run build` | PASS | Vite web + typecheck |
| `npm run verify:static` | PASS | 43 artefatos e 120 arquivos-fonte |
| recovery bundle manifest | PASS — bundle completo + 5 rejeições | watermark, tenant, digests de ledgers, partial, stale, migration mismatch, ciphertext adulterado e chave errada |
| application PDP / patient detail | PASS — fatia target-bound | Sessão autenticada, capability/operation registrada, resourceId, escopo persistido, projeção pelo `PatientApplicationService` e testes negativos de API/policy |
| `npm run test:e2e` | PASS — 52 pass, 4 skips | Gate local executável: Chromium + Firefox × 375/768/1440 + Chromium stress (320 CSS px, DPR 2, touch, reduced-motion); skips intencionais de busca rápida em viewports móveis; axe passou 8/8 incluindo stress |
| `npm run test:e2e:full` | BLOCKED local | Declara e tenta WebKit × 3, mas o host não tem bibliotecas nativas e sudo exige senha; CI instala os três engines com dependências |
| `npm run audit:contrast` | PASS — 7/7 | pares WCAG de texto, banner, CTA e indicador de foco |
| `npm run audit:tokens -- --strict` | PASS | zero high/critical; 73 sinais medium heurísticos, explicitamente não bloqueantes |
| `npm audit --omit=dev` | PASS | zero vulnerabilidades de produção |
| `npm run audit:licenses` | PASS | política SPDX aplicada a 207 dependências de terceiros, incluindo MPL-2.0 do axe-core |
| `npm sbom --sbom-format cyclonedx` | PASS | SBOM gerado a partir do lockfile |
| `npm run benchmark:local` | PASS limitado | baseline sintético com amostras brutas; não é SLO |
| `tests/integration/faults.test.ts` | PASS — 2 cenários | crash após marcador de dispatch e perda de lease; fixture determinística, não drill distribuído |
| `tests/unit/worker.test.ts` | PASS — 6 cenários | health, quarentena, ausência de sink, lifecycle, seis lanes do ciclo e falha isolada de runner |
| worker lane cycle | PASS — 6 lanes nomeadas | outbox, jobs, schedule, reconciliation, notifications e maintenance; contagens/status por lane e default-deny sem sink |
| SLO/alert evaluator | PASS — harness sintético | oito sinais tipados; targets sem aprovação permanecem `PROPOSED`/`TBD`; amostra ausente e avaliação sem evidência retornam `NOT_RUN`; alertas apontam para runbooks e não fazem dispatch |
| `npm run verify:production` | PASS limitado | Gates locais completos; Compose estrutural validado com valores sintéticos; nenhum serviço iniciado |
| `node --import tsx scripts/verify-production.ts --production` | FAIL-CLOSED esperado | configuração real ausente; o gate não autoriza defaults ou produção incompleta |
| `git diff --check` | PASS | Sem erro de whitespace |
| `npm run verify:triplo-aaa` | `AAA_NOT_PROVEN` — exit 2 | gates locais PASS; registry bloqueado pela política de rede; provider, secret authority, staging, observabilidade operacional, WebKit, recovery e carga permanecem `NOT_RUN`/`BLOCKED` |
| `npm run verify:staging` | `STAGING_EVIDENCE_INCOMPLETE` — exit 2 | sem URL staging configurada; nenhuma chamada de rede foi feita |
| `npm run verify:deepseek-acp` | PASS local — boundary real | processo DeepSeek Harness ACP externo local; attestation de commit/manifesto, `initialize` e `session/new`; turn nativo bloqueado até ToolGateway governado; `modelTurn=NOT_RUN_NO_API_KEY` |
| `npm run verify:provider-sandbox` | PASS local — boundary HTTP | servidor loopback real; replay idempotente, resposta perdida→`OUTCOME_UNKNOWN`, query por chave, callback HMAC válido/inválido; `externalProvider=NOT_RUN` |
| GitHub Actions run `34421045621` / SHA `53860d0` | FAIL observado | gates prévios passaram; o gate PostgreSQL/RLS falhou após aplicar 027. A causa estrutural foi tratada com a migration forward-only 028, sem editar 027 |
| GitHub Actions run `34422274248` / SHA `c132d1d` | FAIL observado | o step `Browser E2E` terminou com exit 1; PostgreSQL/RLS e passos posteriores foram pulados. O log detalhado requer autenticação; a suíte local executável passou, mas o novo run não prova 028 |

## Não executado / bloqueado

PostgreSQL limpo e produção-like nesta fotografia, turno DeepSeek/LLM real, secret manager/KMS, provider de TOTP/recuperação, providers externos, Docker image build/startup Compose, scan de imagens, fault injection distribuído, restore operacional gerenciado, carga/benchmark production-like, collector/alertas operacionais/SLO medidos, WebKit executável, leitor de tela, zoom real de 200% e aceite independente continuam não executados ou bloqueados. O CI remoto foi observado em dois SHAs: o primeiro passou E2E e falhou no PostgreSQL/RLS após aplicar 027; o segundo falhou no `Browser E2E` antes de chegar ao PostgreSQL/RLS. O log detalhado do segundo step requer autenticação; a suíte local executável passou, mas o novo run não prova a 028 nem autoriza promoção. O boundary ACP real foi inicializado e criou `session/new` com attestation local, mas isso não substitui um turno de modelo, provider, tools, approvals ou staging; o turno direto está bloqueado até existir um executor ACP governado pelo ToolGateway. O bridge HTTP exige bearer de serviço e, quando ativado, HMAC do contexto por SecretProvider; a prova local cobre contexto ausente/adulterado e POST/GET assinados, mas não substitui rotação operacional. O projeto stress local cobre reflow estreito, DPR 2, touch e reduced-motion, mas não substitui zoom real nem teste assistivo. O avaliador local de SLO/alertas é somente um contrato determinístico de harness: não é baseline, alerta enviado, capacidade ou aprovação de produção. A aplicação inteira ainda não possui prova de uso universal do PDP/Tool Gateway em ambiente real, embora a fatia target-bound, o ledger durável e os casos negativos estejam cobertos localmente. O workflow declara gates bloqueantes para PostgreSQL efêmero, migrations, restore, E2E, segurança, visual, SBOM e containers; é necessário obter diagnóstico/reexecução autorizada do E2E antes de avaliar o forward-fix PostgreSQL. O fault harness local e o recovery manifest cobrem somente transições e validações determinísticas sem serviço externo; não provam backup gerenciado, RTO/RPO ou restore de stores parciais. O histórico de drills PostgreSQL sintéticos permanece documentado em `docs/12-estado-da-implementacao.md`; ele não substitui o ambiente-alvo.

## Interpretação

O passe demonstra uma base compilável, testável e com controles locais de supply chain, uma fatia de autorização target-bound verificável, um ciclo de worker com default-deny observável e contratos de avaliação SLO fail-closed. Não demonstra disponibilidade, segurança, durabilidade, desempenho ou entrega externa em produção. A classificação correta continua `FAIL_WITH_LIMITATIONS`.
