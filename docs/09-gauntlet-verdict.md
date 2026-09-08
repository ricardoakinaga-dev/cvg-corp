# CVG-Corp — Registro de Gauntlet e veredito

**Estado:** `FAIL` na barra integral; a documentação original foi aprovada como registro de desenho, e o artifact local posterior permanece sintético, com limitações e produção bloqueada.

**Data da execução:** 2026-09-07 (America/Sao_Paulo)

## 1. Escopo e autorização

Objetivo: produzir somente a documentação da arquitetura-alvo do CVG-Corp, usando o corpus corporativo inspecionado durante a preparação e o `deepseek-harness` como motor proposto. A autorização desta fase permitiu escrita apenas em `harness-corp/docs/`; não autorizou código, configuração de runtime, banco, segredo, deploy ou integração externa.

Quality Bar ativo: v1.1, registrado em [`00-quality-bar-v1.md`](00-quality-bar-v1.md). `PASS` neste documento significará, quando fechado, qualidade da documentação desta fase; nunca aprovação de produção.

## 2. Estado do artifact

| Item | Evidência |
|---|---|
| Escopo de arquivos | documentos Markdown em `harness-corp/docs/` |
| Fingerprint antes do rework (artefato sem este relatório) | `4135f7b8223a3bb16ecccbfa3b553478494d5079d7e588bfa7e24a258e65613c` |
| Fingerprint após o primeiro rework (artefato sem este relatório) | `6e6af164b41f77d41a863deb6a3df82ed4ac4ecd3ebd883ee562a231bf54fc19` |
| Fingerprint após o segundo rework (artefato sem este relatório) | `a29fe34e287cc3d2da8bcc870bd5166179b44b4e98348412f17fe7a30bbf3a19` |
| Fingerprint após a normalização final do README (artefato sem este relatório) | `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483` |
| Fingerprint após a correção de empacotamento/proveniência (artefato sem este relatório) | `abaa05e1b8ce864b68a9e95570299b6e8d4358f2d616a5839fd1cb96f17052b1` |
| Motor | commit `6454e3270642c3a7551dcae4f7447e4032febd77`, manifesto `0.1.1-rc.2`, `git status` limpo |
| Runtime CVG | não existe nesta fase |

O fingerprint é calculado sobre os arquivos Markdown de primeiro nível em `harness-corp/docs/`, excluindo este relatório para evitar auto-referência; ele é um sentinel de escopo, não uma assinatura de release.

## 3. Rodadas executadas

### Discovery e scouts

Três scouts read-only independentes inspecionaram produto, motor e adversarial risks. Não alteraram arquivos nem executaram subagentes. Suas conclusões foram incorporadas como hipóteses, restrições e gates, sem transformar o domínio veterinário em fato observado nas fontes.

### Critic round I1-A — arquitetura

**Critic:** `CRITIC-ARCH-20260907-A` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: os vinte critérios do addendum v1.1 não estavam individualmente ligados a design, contrato, risco, owner e verificação; havia referências de IDs não definidos. Gaps associados: lifecycle por store, isolamento, budget, auditoria e versionamento. O critic informou não ter observado mutação do artifact.

### Critic round I1-B — segurança

**Critic:** `CRITIC-SAFETY-20260907-B` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: ausência de contratos negativos executáveis para `DATA-02`, `ISO-01/02`, `BUD-01/02`, `TRACE-01` e lifecycle de dispositivo. Também apontou jornadas sem recuperação explícita e distinção insuficiente entre telemetry e auditoria. O critic informou não ter observado mutação do artifact.

### Critic round I1-C — arquitetura pós-rework 1

**Critic:** `CRITIC-ARCH-20260907-C` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: os vinte gates v1.1 já estavam individualizados, mas os gates v1 ainda eram agregados no plano; os três gates AAA estavam combinados no documento de rastreabilidade; e os claims `SRC-DSH-*` não apareciam junto às linhas de uso em 02/04. Também classificou como parciais a recuperação explícita de UC-01/02/07, o binding de versão de sessão/credencial e a instanciação dos contratos de integração. Sentinel antes informado: `f6b62b5d44699c96cf994324ac77e9a766cc69e9b93cc7c64ecdaa994508038f`; depois não calculado por interrupção, sem mutação observada.

### Critic round I1-D — segurança pós-rework 1

**Critic:** `CRITIC-SAFETY-20260907-D` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: a figura ainda mostrava rota privilegiada direta, a matriz combinava provider/telemetry e não tinha linha própria para audit ledger. Também exigiu contrato formal para coordenador de lifecycle, canonicalização/consumo one-shot do approval, ledger de settlement, registry fail-closed e autoridade independente de break-glass. Sentinel antes/depois: `6e6af164b41f77d41a863deb6a3df82ed4ac4ecd3ebd883ee562a231bf54fc19`/o mesmo valor; delta zero. Nenhum arquivo foi alterado pelo critic.

### Critic final I1-E — fechamento

**Critic:** `FINAL-CVG-20260907-E` — contexto novo, não herdado, packet selado. **Decisão documental:** `PASS`.

Resultado: v1 `PASS-DOC` em 14/14 e v1.1 `PASS-DOC` em 20/20. O critic confirmou contratos de lifecycle/stores, proveniência, jornadas com sucesso/negação/recuperação, isolamento, binding revogável, break-glass, admission comum, aprovação canônica one-shot, integrações instanciadas, budget/ledger, audit write, telemetry, registry de IA e versionamento/restore.

Gap residual: `INT-02/U8` — fornecedores, endpoints/regiões, versões externas e algumas fontes de verdade permanecem `PROPOSED/UNKNOWN`. É um bloqueador explícito do BUILD e não um overclaim. Runtime, implementação e testes continuam `NOT_RUN`.

Sentinel do critic: `a29fe34e287cc3d2da8bcc870bd5166179b44b4e98348412f17fe7a30bbf3a19` antes e depois, delta zero; nenhuma mutação observada.

### Revisor final de consistência I1-F

**Revisor:** `FINAL-CVG-20260907-F` — contexto novo, não herdado, packet selado. **Decisão:** `PASS`.

O revisor confirmou que a normalização do README não criou contradição, que os 14 critérios v1 e 20 critérios v1.1 permanecem cobertos, e que a documentação continua distinguindo `NOT_RUN` de evidência operacional. Sentinel antes/depois: `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483`, delta zero.

## 4. Rework aplicado após os critics

- Proveniência individual `SRC-DSH-*` para seams de plugins, session, tools, approval, credentials, sandbox, jobs, workflow, subagents, remote e telemetry.
- Recuperação explícita para exames, internação, estoque e financeiro no PRD.
- Lifecycle ponta a ponta e `DataRef` para DB, audit, object, vector, session, cache, provider, telemetry, backup e export.
- `SecurityContextSnapshot`, `PolicyBinding`, revocation epoch, TTL, binding de credencial e separação concreta de Admin Master/break-glass.
- Matriz negativa de isolamento em cada store/fluxo, inclusive session, billing, export e restore.
- `CvgToolAdmission`/`ActionEnvelope` comum para tool nativa/local, MCP, skill, Code Mode, subagente e remote.
- Reserva atômica, hard stop, sub-reservas nested, settlement e hold de late usage.
- `IntegrationContract` por laboratório/imagem, pagamento, mensageria, calendário e provider.
- `TelemetryPolicy` com redaction, retenção, perda e deduplicação, independente do audit ledger.
- `GovernedArtifact` registry com avaliação, admissão, rollback e kill switch; `ContractDescriptor` com migração, mixed-version e restore seguro.
- Propagação individual dos gates v1 no plano, separação dos três gates AAA e IDs `SRC-DSH-*` junto aos claims de arquitetura e motor.
- Rota privilegiada sem acesso direto a dados; audit ledger separado e boundary universal para Admin Master, break-glass, restore, export, workers e plugins.
- Canonicalização, consumo one-shot e atomicidade do approval binding; registry/digest/revision fail-closed no dispatch.
- `LifecycleCoordinator`, `AuditWrite`, ledger de usage/settlement e schemas versionados individuais por integração.

## 5. Checks locais atuais

| Check | Resultado |
|---|---|
| marcadores de scaffold nos Markdown | PASS — nenhum encontrado |
| IDs aposentados ou órfãos nas matrizes | PASS — nenhum encontrado |
| status do motor DeepSeek | PASS — `master...v2/master`, sem alterações |
| links relativos Markdown | PASS — todos os destinos locais presentes resolvem; as duas fontes corporativas ausentes estão marcadas como metadados, sem links quebrados |
| cobertura de gates v1/v1.1 em plano, AAA e rastreabilidade | PASS — 34 IDs presentes |
| newline final nos Markdown | PASS |
| fingerprint pós-crítica | PASS — `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483` antes/depois do revisor final |
| fingerprint do artifact empacotado | PASS — `abaa05e1b8ce864b68a9e95570299b6e8d4358f2d616a5839fd1cb96f17052b1` |

## 6. Evidência que continua ausente

Além da ausência de implementação CVG, schema executável, endpoint, profile dump, adapter, credencial, provider, benchmark, teste de autorização, cross-scope, red-team, fault injection, budget ledger, auditoria durável, restore, migração, kill switch ou aprovação humana executada, os dois arquivos-fonte corporativos usados nas sínteses não estão presentes no artifact atual. Por isso `VERIFIED` e `RELEASE_READY` permanecem fora do escopo desta fase; os claims que dependem exclusivamente dessas fontes exigem restauração e nova inspeção.

## 7. Veredito final da fase

`CONDITIONAL PASS` documental. A documentação atingiu a barra v1.1 nesta fase, mas não autoriza produção nem BUILD automático. Antes do próximo ciclo, direção clínica, produto, segurança, privacidade, operações, financeiro e integração precisam decidir U1–U15; em especial, fechar U8/U12/U14, transformar os contratos em schemas/adapters e executar os testes listados em 06/07.

## 8. Remediação documental posterior — 2026-09-08

Uma auditoria de consistência posterior identificou seis contradições de contrato: atomicidade inbox/outbox, identidade do ledger de usage, estados de medicação, revogação offline, replay de lifecycle no restore e ordem de integração mínima do Harness. As correções foram registradas em `08-rastreabilidade-e-decisoes.md` como `AUDIT-20260908-01` a `AUDIT-20260908-06` e aplicadas nos documentos 02–08. Este registro preserva o veredito histórico acima; ele não transforma a documentação em implementação nem altera o estado `NOT_RUN` dos testes. Uma nova rodada de verificação deve executar as fixtures correspondentes antes de qualquer `VERIFIED` ou `RELEASE_READY`.

## 9. Remediação documental adicional — 2026-09-08

Uma nova revisão identificou mais seis inconsistências: retry idempotente após approval one-shot, durabilidade do journal antes da confirmação, controles mínimos de Harness no M3, rascunho offline, acesso direto de worker ao banco e exceção de saldo negativo. Elas foram registradas como `AUDIT-20260908-07` a `AUDIT-20260908-12` em `08-rastreabilidade-e-decisoes.md` e corrigidas nos documentos 01–08. O estado continua documental: aprovação, restore, crash, budget, registry, offline, isolamento e estoque ainda exigem execução no artifact real.

## 10. Remediação documental adicional — replay, lifecycle e export — 2026-09-08

Uma rodada posterior tratou quatro inconsistências de contrato, registradas como `AUDIT-20260908-13` a `AUDIT-20260908-16` em `08-rastreabilidade-e-decisoes.md`. O corpus agora separa identidade da decisão e identidade dos eventos append-only, usa projeção explícita da fase atual, define um caminho durável de exportação fora do journal de enforcement, remove `actionId` da chave de busca de idempotência e documenta os caminhos `REPLAY_LOOKUP` e `NEW_EXECUTION`. Essas mudanças são documentais e preservam `NOT_RUN`: ainda faltam implementação, teste de transição legítima/reentrega, crash entre durabilidade e projeção, corrida de reivindicação da chave, recuperação de exportação e verificação no artifact real.

## 11. Remediação documental adicional — decisão completa e claims abandonados — 2026-09-08

Uma nova revisão tratou três lacunas: o receipt agora comprova a decisão completa e durável por `decisionRecordRef`; a chave idempotente usa representação canônica não anulável para campos ausentes; e claims pré-dispatch têm lease, fencing e reconciliação distinta de `OUTCOME_UNKNOWN`. As correções foram registradas como `AUDIT-20260908-17` a `AUDIT-20260908-19` em `08-rastreabilidade-e-decisoes.md`. O estado continua `NOT_RUN`: restore após perda do store de decisão, concorrência com escopos opcionais ausentes e crash imediatamente após o claim ainda precisam ser executados no artifact real.

## 12. Remediação documental — exibição do buffer offline — 2026-09-08

`AUDIT-20260908-20` separa preservação volátil e autorização de exibição: D0–D2 classificados/autorizados podem permanecer visíveis; D3–D5, desconhecido ou não autorizado ficam ocultos em quarentena. PRD, contrato do motor, segurança, operação, plano e rastreabilidade foram alinhados. O veredito histórico é preservado; os cenários de interface, desconexão, revalidação e purga continuam `NOT_RUN` até execução no artifact real.

## 13. Crítica do artifact executável — round 2 — 2026-09-08

A implementação local foi submetida a uma crítica read-only em contexto fresco, registrada em [`.gauntlet/critique-round-2.md`](../.gauntlet/critique-round-2.md), contra a barra congelada em `.gauntlet/bar-v2.json`. A execução confirmou 20/20 testes, build, verificação estática, 9/9 E2E em 375/768/1440, contraste, tokens, `npm audit --omit=dev` sem vulnerabilidades e `git diff --check`. PostgreSQL ficou bloqueado por `ECONNREFUSED 127.0.0.1:5440`.

O resultado desta rodada é **`FAIL` para `CVG-FULL-IMPLEMENTATION`**: IMPL-02, IMPL-04, IMPL-05, IMPL-06, IMPL-08, IMPL-09, IMPL-10, IMPL-11 e IMPL-12 permanecem parciais. O gap dominante é a ausência de persistência transacional durável e journal independente; receipts/auditoria ainda vivem em memória e restore só prova contenção negativa. O recorte local continua demonstrável, mas não autoriza dados reais, provider externo, homologação, piloto ou produção.

## 14. Fechamento da rodada 3 do artifact executável — 2026-09-08

A crítica read-only fresca desta rodada excedeu os timeouts de espera e foi encerrada sem relatório final. Esse resultado não é tratado como aprovação, reprovação independente ou evidência de cobertura; o parecer abaixo é a auditoria objetiva reproduzida pelo agente principal contra a barra congelada em [`.gauntlet/bar-v2.json`](../.gauntlet/bar-v2.json).

### Evidência executada

- `npm run verify:all`: **PASS** — typecheck, 33/33 testes unitários/integração, build Vite, verificação estática e 12/12 E2E em 375/768/1440.
- `npm run audit:contrast`: **PASS** — os cinco pares declarados passaram o limiar WCAG 4.5.
- `npm run audit:tokens -- --strict`: **PASS** — zero achados high/critical; os 72 sinais medium são heurísticos e permanecem para revisão.
- `npm audit --omit=dev` e `git diff --check`: **PASS** — zero vulnerabilidades de produção e diff sem erro de whitespace.
- `db:migrate`: **PASS** no banco sintético separado, com migrations `001_initial`, `002_normalized_projection_support` e `003_organization_rls` aplicadas.
- `npm run verify:postgres`: **PASS** em PostgreSQL 16.15 — restart/read, idempotência, CAS concorrente, journal/auditoria/receipts duráveis, projeções e RLS organizacional foram exercitados. A prova de RLS usa papel efêmero não-superusuário e o remove ao final; não há remoção de banco.

### Veredito

O veredito da barra integral continua **`FAIL`**. O artifact agora possui uma fatia PostgreSQL durável e RLS organizacional verificadas, mas ainda não é o programa corporativo pronto para dados reais: faltam PDP e leitura normalizada completos por unidade/workspace, outbox/worker com claim/lease/fencing, provider e usage ledger reais, backup/restore e crash drills, cache offline autorizado, browsers adicionais, SLO/alertas e aceite operacional. O recorte local permanece demonstrável e explicitamente sintético.

## 15. Continuação após a auditoria objetiva — 2026-09-08

Após o fechamento documentado da rodada 3, o builder implementou uma fatia adicional sem alterar a barra: leitura normalizada transacional de guardians/patients/appointments, migrations `004_outbox_usage_lease.sql`, `005_appointment_scope_rls.sql` e `006_scoped_projection_rls.sql`, outbox com claim/lease/fencing, `OutboxWorker` bounded, ledger idempotente sintético de uso e drill de restore PostgreSQL em destino temporário com quarentena.

As execuções reproduzidas passaram: 35 testes locais, `verify:postgres` com `normalizedReads`, `outbox`, `usageLedger`, CAS e RLS organizacional + unidade/workspace, e `verify:postgres:restore` com 18 registros de outbox e 1 de usage recuperados por digest, `sourceUnchanged=true`, login/readiness bloqueados e limpeza do destino temporário. Isso reduz gaps concretos, mas não é um novo parecer independente: o critic fresco da rodada 3 continua sem relatório. A barra integral permanece **`FAIL`** por PDP/RLS completo em todo o domínio, provider/efeitos externos e inbox/reconciliação reais, settlement completo, backup criptografado, fault/crash drills de produção, cache offline autorizado, browsers adicionais, SLO/alertas e aceite operacional.

## 16. Revalidação posterior da fatia durável — 2026-09-08

Sem mudar a barra congelada ou transformar evidência sintética em aprovação, o builder fechou novos gaps concretos. As migrations `007`–`012` adicionaram inbox com deduplicação e HMAC/key reference verificável, ledger de efeitos externos com `ADMISSION_PENDING`/`DISPATCHED`/`OUTCOME_UNKNOWN`, recibo estruturado obrigatório, reconciliação com digest e fonte, escopo DML clínico, `FORCE RLS` no snapshot/journal canônico e quarentena de registros inbox legados sem assinatura. A migration 008 permaneceu com checksum original; o endurecimento DML foi separado em 010.

O verificador PostgreSQL passou com 36/36 testes locais previamente revalidados, PostgreSQL 16.15 sintético, restart/read, CAS, leituras normalizadas, outbox, usage, receipt de provider sintético, inbox atômico, divergência, crash após marcador, takeover por fence, reconciliação manual sem reenvio e RLS negativo em canonical state e cadeia clínica. O restore passou com cinco conjuntos de recuperação por digest, quarentena, login/readiness bloqueados e origem inalterada. Última evidência registrada: sourceRevision 303, targetRevision 1, 65 outbox, 1 usage, 8 inbox e 23 efeitos externos.

### Veredito preservado

`FAIL` integral. Não há parecer independente fresco utilizável nesta rodada, e a prova não cobre provider/consulta externa reais, PDP/RLS de todas as tabelas, backup criptografado, RTO/RPO/SLO, stores object/vector/session, browsers adicionais, offline autorizado ou aceite humano independente. O recorte continua estritamente sintético e deny-by-default para efeitos reais.

## Revalidação final do builder — não independente — 2026-09-08 17:58

`npm run verify:all` passou com 36/36 testes, build, static (38 arquivos-fonte) e 12/12 E2E em 375/768/1440. Contraste, tokens strict (zero high/critical), dependências, diff e `db:check` também passaram. No banco sintético, `verify:postgres` passou todos os cenários com 302 snapshots/journals, 217 audits/ledgers, 65 outbox, 8 inbox e 23 efeitos externos; o restore serial passou com sourceRevision 303, targetRevision 1, cinco conjuntos por digest, quarentena, login/readiness bloqueados e `sourceUnchanged=true`.

Uma execução inicial com senha de fixture incompatível recebeu 401 antes de mutar o banco e foi repetida com a credencial determinística correta. Isso é registrado como erro de invocação, não como aprovação ou falha de produto. Nada nesta seção é parecer independente; a barra integral continua **`FAIL`** pelos gaps de produção já listados.

## Atualização posterior do builder — isolamento e restore autenticado — 2026-09-08 18:35

As migrations `013_complete_domain_rls.sql` e `014_cross_organization_foreign_keys.sql` fecharam o catálogo restante: o gate confirmou 54/54 tabelas de domínio com `FORCE RLS` e 90 FKs com proveniência organizacional. O bundle de recuperação passou a usar AES-256-GCM com `keyRef` externo, digest autenticado e rejeição de ciphertext alterado. O restore serial aplicou a cópia descriptografada, recuperou outbox/usage/inbox/efeitos por digest, manteve `QUARANTINED`, bloqueou login/readiness e confirmou `sourceUnchanged=true`.

O último `verify:all` passou 40/40 testes, build, static com 40 arquivos-fonte e 12/12 E2E; `verify:postgres` passou migrations `001`–`014`, 435 snapshots/journals, 289 audits/ledgers, 127 outbox, 25 inbox e 50 efeitos; restore passou com sourceRevision 436, targetRevision 1 e `tamperRejected=true`. Esta é evidência do builder, não parecer independente. O veredito integral permanece **`FAIL`**: provider/consulta externa e secret-provider reais, PDP de negócio, backup operacional gerenciado, replay pós-watermark, stores externos, fault points, workload, SLO/RTO/RPO e aceite humano continuam pendentes.

## Atualização do builder antes da crítica independente final — 2026-09-08 19:46

O artifact avançou com as migrations `015`–`018`, escopo persistido e reparável de paciente/tutor, RLS de relacionamento por agenda/encontro/comunicação e negação explícita sem unidade, matriz de capabilities server-side, bloqueio de demo fora do loopback, auditoria de métricas, seam de secret-provider, rejeição de lotes vencidos e administração UI com foco preso e auditoria visível. O checkpoint anterior não é sobrescrito; esta seção registra somente evidência nova.

Checks reproduzidos: `npm test` **43/43**, typecheck/build **PASS**, static **9 artefatos/45 arquivos**, contraste **PASS**, Playwright **15/15** em 375/768/1440 e PostgreSQL **PASS** com migrations `001`–`018`, `54/54` tabelas sob `FORCE RLS`, `94` FKs organizacionais e negação sem unidade. Restore serial **PASS WITH LIMITATIONS** com AES-256-GCM, adulteração rejeitada, sourceRevision `507`, alvo `QUARANTINED`, login/readiness bloqueados e origem inalterada. O parecer ainda é do builder; a crítica fresca seguinte deve avaliar a barra congelada independentemente.

O veredito congelado não muda: **`FAIL`** para produção/AAA integral. Provider, secret-provider e consulta externa reais, PDP de negócio completo, backup gerenciado, stores externos, replay pós-watermark, fault/workload, RTO/RPO/SLO, browsers adicionais e aceite humano continuam bloqueadores. Nenhum dado real ou release é permitido.

## Crítica independente fresca — round 4 — 2026-09-08 20:00

O critic `Galileo` (`01a0833c-36b2-7f70-92cc-bf05a0fa62d7`) avaliou a barra em contexto fresco e somente leitura; o relatório integral está em [`.gauntlet/critique-round-4.md`](../.gauntlet/critique-round-4.md). Ele classificou IMPL-01–IMPL-10 e IMPL-12 como `PARTIAL`, IMPL-11 como `NOT_RUN` naquela inspeção e a elegibilidade AAA como **`NÃO ELEGÍVEL — FAIL`**.

O critic confirmou como bloqueadores atuais o PDP/ABAC de produção, persistência/recovery operacional e integrações externas reais. Também encontrou leitura de paciente/tutor sem unidade no RLS; o lead corrigiu isso aditivamente em `018_require_patient_context.sql`, alinhou o domínio em memória e reexecutou `verify:postgres`, que passou com zero linhas de pacientes/tutores sem contexto. A correção reduz o achado específico, mas não converte a crítica em aprovação.

### Decisão da rodada

`FAIL_WITH_LIMITATIONS`: o slice local continua evidenciado por `verify:all` 43/43 + 15/15 E2E, PostgreSQL sintético 54/54 `FORCE RLS`/94 FKs e restore AES-256-GCM em quarentena; AAA integral, dados reais, provider, homologação, piloto e produção permanecem bloqueados. O critic não executou testes nesta rodada, portanto os comandos reproduzidos pelo lead são evidência separada e não foram atribuídos a ele.
