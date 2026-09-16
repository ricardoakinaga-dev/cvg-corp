# Auditoria da entrega do agente — 13/09/2026

**Veredito: FAIL para Triplo AAA; entrega parcial com avanços locais comprovados.** Foram registrados 18 achados materiais, incluindo falhas novas em contexto clínico, medicação e governança de IA. Nenhuma correção de produto foi implementada nesta auditoria.

## Escopo, candidato e método

Auditoria brownfield de entrega e planejamento de evolução. Critérios: PRD, contratos de domínio, governança/segurança/operação e [barra v4](../.gauntlet/bar-v4.json), SHA256 `2093461a8d6103641a555ad45371dde4649e5f144c32260b80244e219fa70697`. Mantidos Overall ≥97 e limiares individuais, 39 fases, 25 gates, 22 dimensões, zero High/Critical aberto e nenhuma prova obrigatória ausente.

Candidato: HEAD `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc` **com alterações locais**, identificado também pelo [manifesto de 653 arquivos](../artifacts/audit-entrega-2026-09-13/baseline.json). HEAD sozinho não identifica a entrega. A cópia de auditoria foi criada em `/tmp/cvg-delivery-audit-20260913-bcsdpob2/repo`; dependências locais compartilhadas por symlink, sem reinstalação nesta rodada. Nenhum serviço existente foi encerrado ou reutilizado para atribuir prova ao candidato.

Dois críticos frescos, sem histórico herdado (`fork_turns:none`, independência I1), inspecionaram backend e frontend. O Lead examinou operação, estado e evidências e verificou os achados. Os críticos não implementaram correções. O ambiente recusou uma terceira criação por limite de threads; não se inventou um crítico adicional. Após essas análises, um terceiro crítico fresco e distinto revisou o pacote documental e suas fontes: [revisão final](../artifacts/audit-entrega-2026-09-13/final-review.md). Aprovou o escopo de auditoria/planejamento com duas correções textuais, aplicadas. Revisão humana I3, provider real e Gauntlet final de produção não ocorreram.

Severidade HIGH significa risco material de integridade, autorização, jornada obrigatória ou gate de promoção; MEDIUM significa lacuna localizada de uso ou validade de evidência. Prioridade de correção e comprovação externa estão separadas no backlog. Não foi atribuída nota numérica nova: contagem de testes e de tarefas não mede as 22 dimensões e não permite declarar melhora percentual sobre 59/100.

## Entrega observada

| Registro | Quantidade / interpretação |
|---|---|
| Contratos AUD13 principais | 38 |
| Estado declarado DONE | 17; declaração histórica, não aceite independente |
| Estado declarado PARTIAL | 11 |
| Estado declarado PLANNED | 10 |
| Filhos adicionais planejados | 6: 14A,16A,17A,18A,20A,25A |
| Aceites diretamente contraditos | AUD13-21 (budget) e AUD13-15 (semântica UC03) precisam reconciliação |

Avanços confirmados no recorte executado: logout online/offline e erro explícito, challenge MFA sintético, saldo PAID, validação de payload, toast sem colapso, datas/contexto da agenda, cadastro/edição/mesclagem de pacientes, formulários clínicos/diagnósticos/internação, histórico do copiloto e comunicação preparada sem falso envio. Hashing usa scrypt assíncrono com parâmetros explícitos e limites separados por identificador/IP. Telemetria passou a usar buffers limitados. Essas melhorias devem ser preservadas.

## Verificações realmente executadas

| Verificação | Resultado | Evidência e limite |
|---|---|---|
| npm test | PASS: 385 testes, 384 pass, 1 skip | [Log](../artifacts/audit-entrega-2026-09-13/tests.log); não substitui PostgreSQL real ou provider |
| npm run build | PASS | [Log](../artifacts/audit-entrega-2026-09-13/build.log); aviso de chunk JS 514 kB, sem medição de impacto no usuário |
| npm run lint | PASS | [Log](../artifacts/audit-entrega-2026-09-13/lint.log) |
| npm run verify:static | FAIL | [Log](../artifacts/audit-entrega-2026-09-13/static.log): source SHA do snapshot não corresponde a HEAD |
| Playwright app.spec.ts / Chromium 1440 e 375 | PASS: 76 pass, 4 skip, 80 casos | [Log](../artifacts/audit-entrega-2026-09-13/browser-origin-corrected.log); não inclui Firefox/WebKit/AT humano |
| verify:authoritative-writes | PASS do inventário local | [Log](../artifacts/audit-entrega-2026-09-13/authoritative.log): 32 domínios, 8 comandos, 24 snapshotPrimary |
| Probes adversariais backend | REPRODUZEM E01–E04 | [Log](../artifacts/audit-entrega-2026-09-13/backend/probe.log); domínio/governance sintéticos |
| Probes frontend | REPRODUZEM E05/E06/E09 | [JSON](../artifacts/audit-entrega-2026-09-13/frontend/probe-results.json) e [imagem](../artifacts/audit-entrega-2026-09-13/frontend/wrong-patient-addendum.png); componente real, API mockada |
| Probes operação | REPRODUZEM E12/E13 | [Log](../artifacts/audit-entrega-2026-09-13/ops/probe.log); dependências controladas |

As primeiras tentativas de browser não são evidência contra o produto: portas 4310/15173 ocupadas impediram startup; na primeira adaptação a portas livres faltou alinhar CVG_WEB_ORIGIN, provocando 403 de CSRF. Essa execução foi interrompida e classificada INVALID por configuração de auditoria. Após alinhar origem/API/proxy, os 80 casos terminaram sem falhas. Logs anteriores foram preservados com essa interpretação; não houve correção de produto entre tentativas.

Não executados: PostgreSQL novo com migrations001–037 e crash/multiprocesso; instalação limpa; CI remoto do candidato; containers/staging/provider/modelo reais; secrets/WebAuthn; k6/chaos/RTO/RPO reais; Firefox/WebKit, leitores de tela e usuários humanos. Binários em `/usr/lib/postgresql` não estavam disponíveis; isso não prova inexistência de outras opções de banco, mas nenhuma foi provisionada ou usada nesta auditoria. Nenhuma indisponibilidade histórica do Docker foi reclassificada como observação atual.

## Achados e critérios de encerramento

### E01 — HIGH — Prescrição concluída ainda dispensa e pode ser reaberta

O probe completou a prescrição, dispensou com redução de estoque e fez COMPLETED→SUSPENDED→ACTIVE. A UI ocultar a ação não protege o comando.

**Evidência:** Domínio sintético executado; caminho HTTP identificado, ataque HTTP não reexecutado. Confiança: HIGH.

**Local:** [`packages/domain/src/index.ts:1555`](../packages/domain/src/index.ts), [`packages/domain/src/index.ts:1600`](../packages/domain/src/index.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-02 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/backend/probe.log).

### E02 — HIGH — Uso acima da reserva não entra integralmente no teto

Reserva 100, uso real 900: consumedUnits fica 100; outra reserva 900 é aceita sob cap 1000. Excedente retorna como número sem hold efetivo.

**Evidência:** Domínio sintético executado. Confiança: HIGH.

**Local:** [`packages/domain/src/index.ts:559`](../packages/domain/src/index.ts), [`packages/domain/src/index.ts:575`](../packages/domain/src/index.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-03 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/backend/probe.log).

### E03 — HIGH — ACP admite sem budget e perde vínculo de reserva após recriação

Governance com store e sem budget retorna ALLOW/zero reservas. Recriar governance perde correlação; conclusão reporta SETTLED/reservationId null sem chamar settle.

**Evidência:** Governance sintética; recriação de objeto, não prova de crash PostgreSQL ou provider real. Confiança: HIGH.

**Local:** [`packages/harness-adapters/src/index.ts:337`](../packages/harness-adapters/src/index.ts), [`packages/harness-adapters/src/index.ts:506`](../packages/harness-adapters/src/index.ts), [`packages/harness-adapters/src/index.ts:522`](../packages/harness-adapters/src/index.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-04 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/backend/probe.log).

### E04 — HIGH — Conclusão ACP aceita autoridade revogada durante a execução

Após revokeAllSessions, validateContext rejeita o contexto, mas recordTurn aceita e persiste COMPLETED. Contabilidade deve ser preservada sem autorizar conclusão/divulgação clínica.

**Evidência:** Governance sintética executada; saída remota real não executada. Confiança: HIGH.

**Local:** [`packages/harness-adapters/src/index.ts:522`](../packages/harness-adapters/src/index.ts), [`apps/api/src/application/agent-service.ts:60`](../apps/api/src/application/agent-service.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-05 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/backend/probe.log).

### E05 — HIGH — Adendo de outro paciente permanece na linha do tempo

Trocar A→B com resposta de B pendente mantém a correção de A sob o título Patient B. Estado não é limpo nem vinculado à geração/contexto da consulta.

**Evidência:** Browser com componente real e ApiClient sintético; não é evidência de vazamento entre tenants no servidor. Confiança: HIGH.

**Local:** [`apps/web/src/features/clinical/Clinical.tsx:96`](../apps/web/src/features/clinical/Clinical.tsx).

**Encerramento:** satisfazer todos os aceites de AAA2-06 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/frontend/probe-results.json).

### E06 — HIGH — Histórico omite adendos de documentos assinados anteriores

A consulta escolhe somente o documento assinado mais recente; probe confirma que a-old/addenda nunca é solicitado. Correções anteriores somem da visão de prontuário.

**Evidência:** Browser com componente real e ApiClient sintético. Confiança: HIGH.

**Local:** [`apps/web/src/features/clinical/Clinical.tsx:105`](../apps/web/src/features/clinical/Clinical.tsx).

**Encerramento:** satisfazer todos os aceites de AAA2-06 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/frontend/probe-results.json).

### E07 — HIGH — Perfil estoque não alcança a dispensação disponível

Dispensação fica em Internação; carregamento exige endpoints clínicos negados a estoque. Perfil pode listar prescrições/estoque no domínio, mas não leitos/episódios/atendimentos.

**Evidência:** Inspeção conectada + probe de permissões do domínio; jornada autenticada completa de estoque não executada. Confiança: HIGH.

[Probe local de permissões](../artifacts/audit-entrega-2026-09-13/frontend/role-probe.log).

**Local:** [`apps/web/src/features/hospital/Internacao.tsx:106`](../apps/web/src/features/hospital/Internacao.tsx), [`apps/web/src/features/hospital/Internacao.tsx:299`](../apps/web/src/features/hospital/Internacao.tsx), [`apps/web/src/features/clinical/Clinical.tsx:82`](../apps/web/src/features/clinical/Clinical.tsx).

**Encerramento:** satisfazer todos os aceites de AAA2-07 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E08 — HIGH — Internação planejada fica sem caminho de admissão

Formulário permite criar sem leito; UI não oferece atribuir leito/admitir o episódio PLANNED existente. As transições visíveis começam em ADMITTED.

**Evidência:** Inspeção do fluxo conectado, sem prova de indisponibilidade de eventual ferramenta administrativa externa. Confiança: HIGH.

**Local:** [`apps/web/src/features/hospital/Internacao.tsx:293`](../apps/web/src/features/hospital/Internacao.tsx), [`apps/web/src/features/hospital/Internacao.tsx:306`](../apps/web/src/features/hospital/Internacao.tsx).

**Encerramento:** satisfazer todos os aceites de AAA2-08 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E09 — MEDIUM — Leitura de documento assinado abre diálogo sem foco interno

Campos disabled atraem a tentativa de foco inicial; activeElement permanece no botão Ver conteúdo atrás do diálogo.

**Evidência:** Browser do componente real; leitor de tela humano não executado. Confiança: HIGH.

**Local:** [`apps/web/src/features/clinical/Clinical.tsx:280`](../apps/web/src/features/clinical/Clinical.tsx).

**Encerramento:** satisfazer todos os aceites de AAA2-09 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/frontend/probe-results.json).

### E10 — HIGH — Gate estático e aceite independente não fecham o candidato atual

verify:static falha por source SHA diferente. Gates 13/21 têm critic_artifact:null e notas 8.x; isso não prova critérios de promoção. DONE de AUD13-21 é contradito pelo probe de budget.

**Evidência:** Gate estático executado; leitura dos registros feita pelo Lead após crítica técnica. Confiança: HIGH.

**Local:** [`scripts/verify-static.ts:84`](../scripts/verify-static.ts), [`.agent/gates/aud13-21.json:7`](../.agent/gates/aud13-21.json), [`.agent/gates/aud13-13.json:7`](../.agent/gates/aud13-13.json).

**Encerramento:** satisfazer todos os aceites de AAA2-01, AAA2-10, AAA2-31 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/static.log).

### E11 — HIGH — Cobertura autoritativa continua com 24 coleções primárias em snapshot

Verificador retorna domains=32 commands=8 snapshotPrimary=24. Validação de invariantes e inventário honestos não equivalem a escrita autoritativa universal com concorrência real.

**Evidência:** Verificador local executado; novo banco multiprocesso não executado nesta auditoria. Confiança: HIGH.

**Local:** [`scripts/verify-authoritative-writes.ts:30`](../scripts/verify-authoritative-writes.ts), [`packages/persistence/src/index.ts`](../packages/persistence/src/index.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-11, AAA2-12 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/authoritative.log).

### E12 — HIGH — Readiness não discrimina capacidades e usa estados fixos

Probe retorna ready=true/HTTP200 com outbox NOT_CONFIGURED. Ao retirar IA, retorna503 com banco READY. Secrets são capturados na inicialização. Não se comprovou bloqueio de todas as APIs manuais.

**Evidência:** Handler real com dependências controladas; sem falha de infraestrutura real. Confiança: HIGH.

**Local:** [`apps/api/src/routes/health.ts:41`](../apps/api/src/routes/health.ts), [`apps/api/src/app.ts:580`](../apps/api/src/app.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-19 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/ops/probe.log).

### E13 — MEDIUM — Runbook marca EXECUTED_LOCAL a partir de texto

executeScenarioFixtures deriva estados com split da descrição e retorna sete EXECUTED_LOCAL sem operar dependências. A suíte adicional não vincula cada transição a um cenário operacional observado.

**Evidência:** Probe executado; o próprio script distingue contrato local de drill externo, mas seu rótulo de execução é insuficiente. Confiança: HIGH.

**Local:** [`scripts/verify-runbook-execution.ts:81`](../scripts/verify-runbook-execution.ts).

**Encerramento:** satisfazer todos os aceites de AAA2-22 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

[Artefato de reprodução](../artifacts/audit-entrega-2026-09-13/ops/probe.log).

### E14 — HIGH — Workload de carga não exercita as escritas exigidas

Helper usa somente GET; AI/provider são caminhos opcionais e thresholds globais. Não prova turno, efeito, settle e drenagem por jornada.

**Evidência:** Inspeção estática; k6/staging não executados. Confiança: HIGH.

**Local:** [`tests/load/cvg-staging.k6.js:34`](../tests/load/cvg-staging.k6.js).

**Encerramento:** satisfazer todos os aceites de AAA2-23 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E15 — HIGH — Configuração de alerta ainda não tem renderização demonstrada

Arquivo montado contém placeholder shell literal; Compose injeta o arquivo sem etapa de renderização. Entrega real de alerta permanece sem prova.

**Evidência:** Inspeção estática; não se afirmou falha observada de uma instância real de Alertmanager. Confiança: HIGH.

**Local:** [`docker/observability/alertmanager.yml:16`](../docker/observability/alertmanager.yml), [`docker-compose.observability.yml:64`](../docker-compose.observability.yml).

**Encerramento:** satisfazer todos os aceites de AAA2-21 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E16 — HIGH — Jornadas e governança têm escopo obrigatório ainda parcial

Anexos, consentimento, fornecedores/custos, orçamento/conciliação, registry e automações foram deixados em filhos14A/16A/17A/18A/20A/25A planejados. Novas telas não encerram esses requisitos.

**Evidência:** Estado declarado confrontado com superfícies implementadas; não atribuir falha a operações não executadas. Confiança: HIGH.

**Local:** [`docs/adr/031-journey-inventory-and-open-decisions.md`](../docs/adr/031-journey-inventory-and-open-decisions.md), [`.agent/backlog.json`](../.agent/backlog.json).

**Encerramento:** satisfazer todos os aceites de AAA2-13, AAA2-14, AAA2-15, AAA2-16, AAA2-17, AAA2-18, AAA2-20 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E17 — HIGH — Prova operacional, supply chain e aceite final continuam ausentes

Candidato modificado não possui neste pacote prova same-SHA de CI/imagem/staging, provider/secrets/WebAuthn, carga/chaos/recovery, matriz assistiva e decisão humana. Ausência não é incidente observado nem PASS.

**Evidência:** NOT_RUN nesta auditoria para ambientes reais; registros históricos não promovem este candidato. Confiança: HIGH.

**Local:** [`docs/staging.md`](../docs/staging.md), [`.gauntlet/bar-v4.json`](../.gauntlet/bar-v4.json), [`.agent/state.json`](../.agent/state.json).

**Encerramento:** satisfazer todos os aceites de AAA2-24, AAA2-25, AAA2-26, AAA2-27, AAA2-28, AAA2-29, AAA2-30, AAA2-31, AAA2-32 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

### E18 — HIGH — Exames concluídos no backlog ainda omitem semântica do UC03

Schema de pedido não contém instruções/amostra prevista; resultado recebe value livre, source e sourceVersion, sem campos estruturados de unidade/referência e validação de unidade incompatível exigida pelo PRD. Fluxo atual não prova esse aceite.

**Evidência:** Inspeção de contrato e formulário; suíte existente passa para o recorte implementado. Confiança: HIGH.

**Local:** [`packages/contracts/src/index.ts:240`](../packages/contracts/src/index.ts), [`docs/01-prd-cvg.md:104`](../docs/01-prd-cvg.md).

**Encerramento:** satisfazer todos os aceites de AAA2-33 no [backlog](plano-triplo-aaa-pos-entrega-2026-09-13/backlog.md), incluindo regressão e revisão independente.

## Situação dos achados da auditoria anterior

| Achado anterior | Situação após entrega |
|---|---|
| H01 logout | Correção local confirmada em browser; promoção continua separada |
| H02 MFA | Challenge/erro/cancelamento confirmados com fixture; MFA forte real pendente |
| H03 saldo | PAID e payloads incompatíveis corrigidos no recorte; jornada financeira ainda parcial |
| H04 toast | Geometria e dispensa via teclado aprovadas no recorte Chromium |
| H05 jornadas | Avanço parcial; E05–E09/E16/E18 impedem encerramento integral |
| H06 hashing/login | Implementação assíncrona e limites separados presentes; carga/red-team reais pendentes |
| H07 evidência | Fixture unitária passou, mas snapshot de promoção continua stale (E10) |
| H08 ACP | Governor implementado parcialmente; E03/E04 e integração real pendentes |
| H09 budget/registry | E02/E03/E16 impedem conclusão; reabrir aceite afetado |
| H10 claims | Migration037 e contrato evoluíram; prova crash/SQL atual não repetida |
| H11 autoridade/lifecycle | Continua parcial: 24 coleções snapshotPrimary (E11), recovery real pendente |
| H12 telemetria | Buffers limitados entregues; causalidade/relatórios/operação ainda parciais |
| H13 alertas | Config renderizada/entrega não provadas (E15) |
| H14 dependências | Build instalado passou; npm ci independente não repetido nesta rodada |
| H15 promoção externa | Ausente para o candidato atual (E17) |
| M01 contexto/indicadores | Agenda/proveniência/ilustração explícita verificadas; relatórios ainda parciais |
| M02 runbooks | Lacuna mantida (E13) |
| M03 carga | Lacuna mantida (E14) |
| M04 readiness | Lacuna mantida (E12) |
| M05 restore útil | Melhorias locais registradas; retorno útil/RTO/RPO real não provados |
| M06 documentação/estado | Histórico preservado; nova reconciliação de aceites necessária (E10) |

## Encaminhamento e integridade

Documentação atualizada por adendo datado; relatórios anteriores permanecem históricos. O estado `.agent` não foi reescrito nesta auditoria. AAA2-01 deverá reconciliar o aceite na futura implementação. O [novo programa](plano-triplo-aaa-pos-entrega-2026-09-13/README.md) cobre 33 tarefas, todos os 18 achados e todos os contratos/filhos anteriores.

O [sentinel](../artifacts/audit-entrega-2026-09-13/sentinel.json) compara o candidato original com a baseline, separando as edições documentais autorizadas. Evidências desta auditoria são locais consultivas; estarem arquivadas no repositório não as torna bundle externo válido de promoção.

**Próxima ação de implementação:** AAA2-01, seguida pelas correções de contexto clínico, medicação e autoridade/budget. **Estado do produto:** AAA_NOT_PROVEN.
