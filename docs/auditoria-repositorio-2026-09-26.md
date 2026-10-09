# Auditoria do repositório CVG-Corp — 26/09/2026

**Objeto:** árvore de trabalho local em `26756a892f91b40b358836744649e794d2d396af` (candidato 9), com 14 entradas modificadas/untracked no `git status --short`, todas em `.agent/` e `artifacts/` (provas de 25/09 ainda não commitadas).
**Método:** análise do acervo de `docs/` (280 arquivos) seguida da execução direta de 25 gates de verificação do próprio projeto nesta sessão, na árvore observada.
**Independência:** revisão de sessão única, sem segunda qualificação independente; nenhum arquivo do repositório foi alterado durante a fase de auditoria.
**Nota técnica ponderada:** **75/100** (75,05 antes do arredondamento).
**Prontidão para produção:** **42/100**, julgamento separado da nota técnica.
**Veredito:** `PROMOTION_BLOCKED / AAA_NOT_PROVEN` — concorda com a autodeclaração corrente do projeto.

Este relatório registra a fotografia observada nesta data. Usei os mesmos pesos das auditorias de [23/09](./auditoria-repositorio-2026-09-23.md) e [24/09](./auditoria-repositorio-2026-09-24.md) para permitir comparação por dimensão; as notas não são automaticamente comparáveis entre rodadas. As ações propostas estão no [roadmap](./roadmap-2026-09-26.md) e no [backlog](./backlog-2026-09-26.md) deste pacote, com IDs `MEL26` propostos.

## Critérios e pontuação

| Dimensão | Peso | Nota | Fundamentação resumida |
|---|---:|---:|---|
| Documentação e rastreabilidade | 6 | 80 | Acervo amplo e incomumente honesto; `docs-integrity` PASS (270 arquivos, 0 achados); camada histórica pesada dificulta a leitura do estado corrente; claim de cobertura do relatório de 25/09 vencido nesta árvore. |
| Arquitetura e fronteiras | 7 | 82 | `verify:architecture` PASS: 13 pacotes runtime, 0 ciclos, `app.ts` em 2.446 linhas (orçamento 2.500), 18 orçamentos ativos. |
| Domínio e invariantes | 7 | 85 | `verify:authoritative-writes` PASS (32 domínios, adulteração rejeitada); migração snapshot→comando com replay concorrente, rollback e reconciliação verdes. |
| API e contratos | 6 | 86 | 105 rotas, 80 schemas executáveis, fixtures de sucesso 105/105 (103 memória + 2 PostgreSQL), `verify:schema-manifest` PASS (`latest=049`). |
| Segurança e privacidade | 10 | 80 | PDP universal PASS, RLS `FORCE`, `verify:secrets` PASS com exceção documentada, 10 ataques cobertos, `npm audit` 0 vulnerabilidades. Sem pentest externo nem Secret Authority real. |
| Persistência e migrações | 12 | 68 | 49 migrations e harness verdes; 24/32 coleções seguem `SNAPSHOT_PRIMARY`; branch coverage da área em 68,18%. |
| Backup, restore e recuperação | 11 | 68 | Drill local AES-256-GCM com digests imutáveis e quarentena; RTO/RPO medidos e restore em ambiente equivalente ausentes. |
| IA e governança | 6 | 76 | Kernel embarcado com 66 testes focados, 0 arquivos DeepSeek incorporados, IA-desligada testada; turno de modelo real `NOT_RUN`. |
| Workers e integrações | 6 | 76 | `verify:worker-runtime` PASS (6 policies, 38 testes), sandbox de provider com replay/HMAC/resposta perdida; provedores reais pendentes. |
| Frontend e acessibilidade | 6 | 72 | Build 830 ms; E2E `chromium-wide-1440` reexecutado nesta auditoria: 56 pass, 2 skips, 0 falhas. 37 skips da matriz completa sem justificativa consolidada; tecnologia assistiva não avaliada. |
| Testes e verificabilidade | 8 | 78 | Suíte verde: 749 testes, 748 pass, 0 fail, 1 skip; mutação 30/30 (100%). Porém `verify:coverage` **FALHOU** nesta árvore — ver AR26-F01. |
| CI/CD e cadeia de suprimentos | 5 | 74 | CI pinado por SHA, SBOM/Trivy/proveniência locais, licença raiz decidida (`UNLICENSED` + `LICENSE`), 183 pacotes aprovados; attestations não assinadas/publicadas externamente. |
| Observabilidade | 5 | 68 | OTLP e alertas declarados, stack local no Compose; coleta e entrega externas `NOT_RUN`. |
| Desempenho e resiliência | 3 | 58 | Baseline sintético; carga/caos/DR nunca executados em ambiente equivalente. |
| Manutenibilidade | 2 | 62 | `app.ts` reduzido, mas `packages/persistence/src/index.ts` tem 4.792 linhas. |
| **Total ponderado** | **100** | **75** | **75,05 arredondado.** |

## Evidência executada nesta auditoria

| Procedimento | Resultado observado |
|---|---|
| `npm test` | PASS; 749 testes, 748 pass, 0 fail, 1 skip (25,1 s). |
| `npm run typecheck`, `lint`, `build` | PASS; build web em 830 ms. |
| `npm run verify:static` | PASS; 250 artefatos obrigatórios, 302 arquivos-fonte. |
| `npm run verify:architecture` | PASS; 13 pacotes, 0 ciclos, 24 casos de writer AUD27. |
| `npm run verify:secrets` | PASS; exceção sintética documentada. |
| `npm run verify:authoritative-writes` | PASS; 32 domínios, 8 comandos, 24 snapshot-primary, tamper rejeitado. |
| `npm run verify:control-plane` | PASS; 334 itens, ativo `AUD27-015:REAL-IMAGE-SMOKE`. |
| `npm run verify:docs-integrity` | PASS; 270 arquivos, 0 achados. |
| `npm run verify:schema-manifest` | PASS; `latest=049`, 12 marcadores. |
| `npm run verify:audit-chain` | PASS; adulteração rejeitada. |
| `npm run verify:pdp-universal` | PASS. |
| `npm run verify:snapshot-command-migration` | PASS; 32 coleções, replay/rollback/reconciliação. |
| `npm run verify:claims` | PASS; `aaaState=AAA_NOT_PROVEN`, `productionState=NOT_PROVEN`. |
| `npm run verify:aud27-semantics` | PASS; 39 achados, known-bad rejeitado 5/5. |
| `npm run verify:agent-security` | PASS; 10 ataques. |
| `npm run verify:embedded-harness` | PASS; 17 artefatos, MIT, 0 arquivos incorporados. |
| `npm run verify:provider-sandbox` | PASS. |
| `npm run verify:worker-runtime` | PASS; 6 policies, 38 testes, fila em reject. |
| `npm run verify:mutation` | PASS; 30/30 mortos, score 100%, `status=FROZEN`. |
| `npm run audit:licenses` | PASS; 183 pacotes + raiz `UNLICENSED`. |
| `npm audit --omit=dev` | PASS; 0 vulnerabilidades. |
| `npm run doctor` | `DOCTOR_VERDICT=PASS` (aviso opcional de `psql`). |
| `npx playwright test --project=chromium-wide-1440` | PASS; 56 pass, 2 skips, 0 falhas (2,2 min). |
| `npm run verify:coverage` | **FAIL**; linhas 88,20–88,21% < ratchet 88,40% (duas execuções). |
| `npm run verify:mel23-evidence` | Recibos com SHA/fingerprint de candidatos anteriores; vínculo ao sujeito corrente ausente. |
| `npm run verify:aud27-evidence-root` | **FAIL**; raiz externa não corresponde ao SHA nem ao fingerprint do candidato corrente. |

Não executei nesta rodada PostgreSQL real, deploy, staging, provedores externos, carga/caos/DR, RTO/RPO, revisão independente ou aceite humano.

## Achados atuais

### AR26-F01 — Regressão do ratchet de cobertura — P0

`verify:coverage` falha na árvore atual: 88,20–88,21% de linhas contra o ratchet de 88,40%, confirmado em duas execuções independentes. O [relatório parcial de 25/09](./relatorio-parcial-2026-09-25.md) registrava 88,45–88,49%; houve regressão real ou variância de medição não determinística — em ambos os casos o gate está vermelho e o claim documental está vencido nesta árvore. Fontes: [scripts/verify-coverage.ts](../scripts/verify-coverage.ts), `artifacts/coverage-output.txt`.

### AR26-F02 — Evidência externa segue desvinculada — P0 para promoção

`verify:aud27-evidence-root` FAIL: o pacote em raiz externa não corresponde ao SHA nem ao fingerprint do candidato corrente; os recibos MEL23 apontam fingerprints de candidatos anteriores. É o bloqueio conhecido AUD27-005, dependente da autoridade de release executar o kit sobre o candidato congelado.

### AR26-F03 — Provas de 25/09 não commitadas e fotografia expirando — P1

O estado declara candidato 9 congelado, mas o `git status` mostra 14 entradas sujas: recibos de `.agent` e provas de `artifacts/operational-proof` geradas em 25/09 (image smoke, OCI, staging local) após o commit `26756a8`. Enquanto não forem consolidadas em revisão, a fotografia expira na próxima edição e o vínculo recibo↔candidato não pode avançar.

### AR26-F04 — Gates externos e humanos não comprovados — P0 para promoção

Staging real (o atual é local/sintético), provedores reais e turno real do modelo, Secret Authority, carga/caos/DR em ambiente equivalente, WebKit/tecnologia assistiva com participante humano, qualificação independente e decisão humana final seguem sem evidência para o mesmo candidato. É o blocker perene de `AAA_NOT_PROVEN`.

## O que passou e merece registro

A progressão desde 24/09 é real: a suíte voltou a ser verde e cresceu (749 testes), a mutação subiu para 30/30, `app.ts` voltou ao orçamento, a licença de raiz foi decidida, o staging local com TLS foi provisionado e o achado de headers duplicados no edge foi corrigido. A documentação continua declarando `NOT_RUN` e `BLOCKED_EXTERNAL` em vez de inflar resultados.

## Decisão e limite

O primeiro passo verificável é recuperar o ratchet de cobertura com testes reais (AR26-F01), consolidar as provas de 25/09 em revisão limpa (AR26-F03) e então reexecutar o vínculo de evidência sobre o novo candidato. A raiz externa e os gates humanos permanecem com seus responsáveis. Estes números são avaliação técnica desta fotografia, não certificação nem aceite clínico.
