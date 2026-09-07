# CVG-Corp — Rastreabilidade e decisões

**Estado:** TARGET/PROPOSED; ledger documental para preparar a implementação.

## 1. Convenção

As relações usam verbos explícitos: `defines`, `constrains`, `depends_on`, `verifies`, `observes`, `remediates` e `contradicts`. Um link nesta matriz indica cobertura planejada, não prova de implementação.

`CURRENT` é observação de fonte; `PROPOSED` é decisão de desenho; `UNKNOWN` requer autoridade; `NOT_RUN` é ausência de execução. Alterar uma fonte, contrato, schema, profile, policy ou target torna evidência derivada `STALE` até nova verificação.

## 2. Requisito→design→risco→verificação

| Requisito | Define/constrains | Risco | Verificação planejada | Estado |
|---|---|---|---|---|
| FR-01 | `CvgContext`, M1, `SEC-01`, `ISO-02` | cross-tenant, sessão roubada | authn/authz, binding e revocation E2E | PROPOSED/NOT_RUN |
| FR-02 | `AnimalPatient`, `GuardianLink`, INV-01/02 | paciente/tutor duplicado ou errado | dedup, merge auditado e vínculo negativo | PROPOSED/NOT_RUN |
| FR-03 | Agenda, reservation command, INV-09 | double booking | concorrência e retry | PROPOSED/NOT_RUN |
| FR-04 | Queue/Triage/Encounter state | handoff perdido ou acesso indevido | state machine + role matrix | PROPOSED/NOT_RUN |
| FR-05 | ClinicalDocument/Signature/Addendum | perda/sobrescrita de histórico | append/adendo/restore | PROPOSED/NOT_RUN |
| FR-06 | AiDraft + `CommitClinicalDocument` | draft virar fato | draft-not-published + approval | PROPOSED/NOT_RUN |
| FR-07 | DiagnosticRequest/Specimen/Result | resultado fora de ordem | quarantine/out-of-order test | PROPOSED/NOT_RUN |
| FR-08 | HospitalEpisode/CareTask/Handoff | tarefa/medicação omitida | transfer/crash/closure test | PROPOSED/NOT_RUN |
| FR-09 | Product/Lot/StockMovement | lote errado ou saldo negativo | invariant/property/restore | PROPOSED/NOT_RUN |
| FR-10 | Ledger/Payment/Reconciliation | cobrança/estorno duplicado | duplicate webhook + reconcile | PROPOSED/NOT_RUN |
| FR-11 | AuditRecord | investigação incompleta ou vazamento | query/redaction/integrity check | PROPOSED/NOT_RUN |
| FR-12 | server authz + guard | UI bypass/tool bypass | actor→action→resource→condition | PROPOSED/NOT_RUN |
| FR-13 | DSH session bridge | contexto não reconstruível | session replay + scope test | PROPOSED/NOT_RUN |
| FR-14 | profile/policy/tool catalog | tool/MCP não governado | admission, hash, kill switch | PROPOSED/NOT_RUN |
| FR-15 | BudgetReservation/UsageRecord | overspend/late usage | hard stop + retry/média de modalities | PROPOSED/NOT_RUN |
| FR-16 | ApprovalBinding | efeito sem consentimento | approval digest/expiry/replay | PROPOSED/NOT_RUN |
| FR-17 | fail-closed + health/readiness | fallback amplia privilégio | cache missing/corrupt/offline | PROPOSED/NOT_RUN |
| FR-18 | KnowledgeVersion/ACL | RAG cross-scope/prompt injection | vector ACL + red-team | PROPOSED/NOT_RUN |
| FR-19 | AutomationRun/outbox/inbox | job duplicado/poison | worker retry/quarantine | PROPOSED/NOT_RUN |
| FR-20 | CredentialRef/integration ports | segredo/escopo excessivo | rotation/revocation/egress | PROPOSED/NOT_RUN |
| FR-21 | projections/telemetry/audit | decisão sem visão operacional | dashboards + synthetic incidents | PROPOSED/NOT_RUN |
| FR-22 | offline states/manual path | falso sucesso clínico | disconnected failure drill | PROPOSED/NOT_RUN |
| NFR-SEC-01 | 05 autorização | exposição não autorizada | negative tests em todos stores | PROPOSED/NOT_RUN |
| NFR-SEC-02 | 04 credentials | key desce ao cliente | bundle/traffic/log inspection | PROPOSED/NOT_RUN |
| NFR-SEC-03 | 05 THR-01…03 | prompt injection | red-team known-bad | PROPOSED/NOT_RUN |
| NFR-DATA-01/02 | data inventory + transactions | perda/retention incorreta | synthetic lifecycle + crash | PROPOSED/NOT_RUN |
| NFR-AI-01/02 | AiDraft + policy + approval | decisão clínica automática | tool/UI/replay | PROPOSED/NOT_RUN |
| NFR-REL-01/02 | ops/DR | indisponibilidade não explicada | health, backup, restore | PROPOSED/NOT_RUN |
| NFR-PERF-01 | W-A…W-H | escala sem cauda medida | load p95/p99 | PROPOSED/NOT_RUN |
| NFR-TRACE-01 | event/audit envelopes | sem atribuição causal | cross-service correlation | PROPOSED/NOT_RUN |
| NFR-COMP-01 | schema/version/upgrade | incompatibilidade de sessão | mixed-version/replay | PROPOSED/NOT_RUN |

## 2.1 Quality Bar v1.1 — requisito→contrato→risco→prova

Esta é a matriz individual dos vinte critérios adicionados no addendum. Cada linha tem owner de prova; `PROPOSED/NOT_RUN` é o estado honesto desta fase documental.

| Critério | Design/contrato que owns a resposta | Risco rejeitável | Verificação e owner | Estado |
|---|---|---|---|---|
| `EV-01` | claim ledger em `00-fontes-e-premissas.md`, estados `CURRENT/TARGET/PROPOSED/UNKNOWN` e fingerprint em 09 | claim de vídeo/mock ou seam do motor tratado como runtime | inspeção de claim/source/hash + artifact fingerprint — lead/docs | PROPOSED/NOT_RUN |
| `DATA-02` | lifecycle matrix/DataRef em `03 §13` + fluxo sensível em `05 §7` | retenção/expurgo incoerente entre cópia, provider, backup e telemetry | fixture sintética DB→object→vector→session→cache→backup→provider→telemetry — dados/privacidade | PROPOSED/NOT_RUN |
| `DATA-03` | `LocalEndpointPolicy` e estados de device em `05 §8` | perda, revogação ou wipe local deixa dado/privilégio utilizável | device-loss/revoke/wipe/update/restore drill — segurança/ops | PROPOSED/NOT_RUN |
| `ISO-01` | matriz de stores em `05 §12`, `CvgContext`, DataRef e ACL | leitura, mutação ou export cross-tenant/workspace | negative tests por DB/object/vector/session/cache/billing/export/backup — domínio/segurança | PROPOSED/NOT_RUN |
| `ISO-02` | `SecurityContextSnapshot`/`PolicyBinding` em `05 §4` | sessão, cache ou credencial antiga mantém privilégio | policy change, revocation epoch, TTL, workspace swap e offline — identidade/AI | PROPOSED/NOT_RUN |
| `AUTH-02` | matriz Admin Master/organização/suporte/break-glass em `05 §4` | acesso privilegiado sem finalidade, janela, dual control ou revisão | allow/deny e relatório de exceção — segurança/ops | PROPOSED/NOT_RUN |
| `AUTH-03` | `ApprovalBinding`/`ActionEnvelope` em `04 §7/7.1` e `05 §4` | approval é reutilizado após alteração de args, recurso, estado ou policy | mutação + expiração + replay entre approval/dispatch — AI/segurança | PROPOSED/NOT_RUN |
| `INJ-01` | untrusted-content rules em `04 §7.1`, `05 THR-01…04` | documento, RAG, e-mail, MCP ou web altera autoridade | red-team por origem e comparação de policy antes/depois — AI/segurança | PROPOSED/NOT_RUN |
| `INJ-02` | `CvgToolAdmission` comum em `04 §7.1` | native/local/MCP/skill/Code Mode/nested contorna authz/egress | bypass, nested dispatch e ferramenta comprometida — AI/runtime | PROPOSED/NOT_RUN |
| `INT-01` | `IntegrationContract`, inbox/outbox e `OUTCOME_UNKNOWN` em `02 §12/03 §8` | timeout/retry/crash gera efeito clínico externo duplicado ou falso sucesso | response-lost, duplicate, retry e reconciliação — integração | PROPOSED/NOT_RUN |
| `INT-02` | contrato individual de laboratório, pagamento, mensagem, calendário e provider em `02 §12` | adapter sem identidade, versão, webhook, erro ou reconciliação | contract/codec + integração isolada — integração | PROPOSED/NOT_RUN |
| `BUD-01` | `BudgetReservation`, dimensões e hard stop em `04 §8` | nested/retry/mídia/MCP consome além do limite | stub com reserva atômica, crash, late usage e limite — AI/dados | PROPOSED/NOT_RUN |
| `BUD-02` | `UsageRecord`, settlement e `BUDGET_RECONCILIATION_HOLD` em `04 §8/03 §7` | usage/provider/ledger/cobrança duplica ou perde discrepância | crash, out-of-order, late e duplicate events — dados/financeiro | PROPOSED/NOT_RUN |
| `AUD-01` | audit ledger independente em `03 §13` e `05 §9` | perda de telemetry elimina a trilha de efeito/acesso | interromper collector e consultar ledger íntegro — segurança/ops | PROPOSED/NOT_RUN |
| `AUD-02` | campos mínimos, `argumentDigest` e `TelemetryPolicy` em `05 §9` | segredo ou PII clínica desnecessária no audit/log | known-good/known-bad e inspeção de payload — segurança | PROPOSED/NOT_RUN |
| `REL-03` | estados operacionais, bounded retry e quarentena em `06 §3/5` | retry/backpressure/cancelamento/poison sem limite | fault injection e fila cheia — SRE | PROPOSED/NOT_RUN |
| `REL-04` | workloads W-A…W-H e targets em `06 §2/3` | performance aceita por média sem cauda ou mix realista | benchmark com p50/p95/p99, concorrência e provider mix — SRE | PROPOSED/NOT_RUN |
| `OBS-02` | `TelemetryPolicy`, IDs de dedup e perda em `05 §9/06 §4` | telemetry vaza, perde/duplica contexto ou é confundida com auditoria | collector indisponível, retenção, redaction e duplicate test — ops | PROPOSED/NOT_RUN |
| `AI-01` | `GovernedArtifact` registry/admission em `04 §11` | modelo/prompt/tool/skill/MCP sem origem, avaliação, rollback ou kill switch executa | registry/admission/evaluation/rollback/kill-switch — AI/clinical | PROPOSED/NOT_RUN |
| `VER-01` | `ContractDescriptor`, upcaster e restore em `03 §14` | versão mista ou restore muda semântica/perde vínculo/ACL | mixed-version replay, migration, unknown event e restore — dados/runtime | PROPOSED/NOT_RUN |

## 3. Quality Bar→artefatos

| Critério | Artefato que owns a resposta | Evidência atual | Lacuna |
|---|---|---|---|
| DOC-01 | `00-fontes-e-premissas.md` | fontes/hash e classificações registrados | validar mudanças de origem |
| DOC-02 | `01-prd-cvg.md` | jornadas, regras, FR/NFR e acceptance escritos | confirmação da operação real |
| ARC-01 | `02-arquitetura-alvo.md` + `03-dominio-dados-contratos.md` | ownership e fonte transacional propostos | schema e execução inexistentes |
| ARC-02 | `04-motor-deepseek-e-plugins.md` | matriz para seams atuais e CVG propostas | adapter não existe; profile dump não executado |
| DATA-01 | `03` + `05` | classes, entidades e invariantes propostos | retenção, backup e restore desconhecidos |
| SEC-01 | `05` | trust boundaries, matriz e ameaças documentadas | testes e políticas aprovadas ausentes |
| CLIN-01 | `01`, `03`, `05` | draft/signed, states e controles | direção clínica ainda não aprovou |
| OPS-01 | `06` | SLO/RTO/RPO e runbooks propostos | baseline e drills não executados |
| AAA-01 | `06` | rubric A1, assistência segura, falhas bloqueadoras e aceite | evidência de runtime clínico inexistente |
| AAA-02 | `06` | rubric A2, isolamento, integridade, ledger, segregação e restore | evidência de runtime administrativo inexistente |
| AAA-03 | `06` | rubric A3, policy, tools, budget, approval, knowledge, telemetry e kill switch | evidência de runtime do harness inexistente |
| TRACE-01 | este documento | relações para FR/NFR e riscos | checks aguardam repositório de implementação |
| PLAN-01 | `07` | milestones, dependências e recuperação | nenhum milestone de código começou |
| DOC-03 | todos em `harness-corp/docs` | escopo de escrita registrado | fingerprint final precisa confirmar |

## 4. ADRs propostos

### ADR-CVG-001 — Separar domínio transacional e motor de IA

**Status:** PROPOSED. **Drivers:** prontuário/ledger exigem invariantes e autoridade distintas da sessão model-visible. **Decisão:** o domínio CVG é fonte de verdade; DeepSeek Harness é runtime de agentes e tools; integração só por portas/casos de uso. **Alternativas:** usar session log como banco clínico; rejeitada por semântica de replay/compaction e ausência de estados de negócio. **Conseqüência:** há duas trilhas correlacionadas e uma ponte de auditoria. **Revalidação:** se o produto demonstrar que o engine possui todas as garantias transacionais clínicas, revisar com evidência, não por preferência.

### ADR-CVG-002 — Modular monolith inicial

**Status:** PROPOSED. **Drivers:** domínio ainda desconhecido, alto custo de consistência e vários contextos. **Decisão:** modular monolith para transações, processos separados para AI/worker quando necessário. **Alternativas:** microsserviços desde o primeiro commit; rejeitada até haver escala/ownership/deployment demonstrados. **Conseqüência:** boundaries são enforced por pacote/porta/teste, não necessariamente por rede. **Revalidação:** falha de isolamento, escala ou ownership comprovada.

### ADR-CVG-003 — Policy monotônica e fail-closed

**Status:** PROPOSED. **Drivers:** cinco princípios das fontes e approval do motor. **Decisão:** escopos específicos podem restringir, nunca ampliar; policy ausente/corrompida/expirada nega. **Alternativas:** fallback permissivo/offline; rejeitada por expansão de privilégio. **Conseqüência:** UX precisa explicar bloqueio e manter caminho manual. **Revalidação:** somente por requisito humano aprovado e teste de segurança correspondente.

### ADR-CVG-004 — Prontuário versionado e assinatura explícita

**Status:** PROPOSED. **Drivers:** separação entre draft e fato clínico. **Decisão:** documentos assinados são imutáveis logicamente; correção é adendo; IA cria `AiDraft`. **Alternativas:** update em linha; rejeitada por perda de proveniência. **Conseqüência:** estado e UX precisam mostrar versão e autor.

### ADR-CVG-005 — Tools como únicas portas de ação de IA

**Status:** PROPOSED. **Drivers:** pipeline `tools/pre-execute`→guard→execute→post e domínio autoritativo. **Decisão:** agentes chamam tools com schema/output e elas chamam portas de aplicação; sem SQL/HTTP paralelo escrito pelo modelo. **Alternativas:** MCP direto no banco; rejeitada por não centralizar authz/idempotência/auditoria.

### ADR-CVG-006 — Conhecimento, memória e prontuário separados

**Status:** PROPOSED. **Drivers:** separação apresentada nas fontes e risco de prompt injection. **Decisão:** knowledge approved, memory derived e clinical source são stores e estados distintos. **Alternativas:** uma memória universal; rejeitada por finalidade/retention/ACL divergentes.

### ADR-CVG-007 — Auditoria independente de telemetria

**Status:** PROPOSED. **Drivers:** telemetria do motor é best-effort; approval não duplica args. **Decisão:** ledger D5 durável para efeitos e acessos; telemetria apenas operação/análise redigida. **Alternativa:** usar OTel como auditoria; rejeitada por perda/duplicidade e redaction.

### ADR-CVG-008 — Budget por reserva + ledger

**Status:** PROPOSED. **Drivers:** tokens, mídia, provider, retries e workers assíncronos. **Decisão:** reservar antes, registrar depois, reconciliar provider/uso/valor; late/unknown bloqueia novos efeitos caros. **Alternativas:** somente batch posterior; rejeitada como hard ceiling.

### ADR-CVG-009 — Sem uso P0 de Agent Teams

**Status:** PROPOSED. **Drivers:** a capability está marcada experimental no motor; `writeScopes` são advisory. **Decisão:** não usar em caminho clínico P0; subagentes de baixo risco só com policy própria. **Revalidação:** gate de concorrência, ownership, persistence, audit e recovery aprovado.

### ADR-CVG-010 — Offline somente com escopo pré-autorizado

**Status:** PROPOSED. **Drivers:** fontes permitem degradação sem novos acessos, mas não definem contrato. **Decisão:** leitura/cache e draft marcado podem continuar; efeitos clínicos, financeiros, privilégio e comunicação exigem online/receipt. **Alternativa:** write-behind transparente; rejeitada até conflito e revogação serem provados.

### ADR-CVG-011 — Profile/bundle versionado do harness

**Status:** PROPOSED. **Drivers:** composição por patches e engine pré-release sem promessa on-disk. **Decisão:** fixar versão do motor, bundle, tools, policy, model e session format no deployment e validar replay antes de upgrade. **Alternativa:** seguir `master`; rejeitada por drift não reproduzível.

### ADR-CVG-012 — Dados locais mínimos

**Status:** PROPOSED. **Drivers:** vídeos mostram SQLite/memória/keychain, enquanto dados clínicos ampliam impacto de dispositivo. **Decisão:** web/API como caminho inicial; cache/desktop só com inventário, criptografia, revogação e offline aprovado. **Alternativa:** copiar prontuário inteiro ao cliente; rejeitada por blast radius.

## 5. Decisões pendentes com dono e gatilho

| ID | Pergunta | Dono sugerido | Gate | Gatilho de revalidação |
|---|---|---|---|---|
| U1 | Organização única ou SaaS multi-tenant? | direção + produto | DISCOVERY_READY | nova unidade/cliente externo |
| U2 | Espécies, serviços e complexidade? | direção clínica | PRODUCT_DEFINED | nova linha de cuidado |
| U3 | Urgência/24h/internação/cirurgia? | direção clínica/ops | PRODUCT_DEFINED | mudança de turno/serviço |
| U4 | Unidades, recursos, leitos e equipamentos? | operações | PRODUCT_DEFINED | nova unidade/recurso |
| U5 | Roles, alçadas e coassinaturas? | direção clínica + segurança | PRODUCT_DEFINED | incidente ou novo papel |
| U6 | Identidade/duplicidade/vínculos? | produto + recepção | PRODUCT_DEFINED | migração/novo identificador |
| U7 | Formato, assinatura e adendo de prontuário? | direção clínica + privacidade | PRODUCT_DEFINED | auditoria/retificação |
| U8 | Laboratório, imagem e devices prioritários? | clínica + integração | TECHNICALLY_SPECIFIED | provider/contrato novo |
| U9 | Medicação, lote, validade e dispensação? | clínica + farmácia | TECHNICALLY_SPECIFIED | item controlado/processo novo |
| U10 | Internação, handoff e alta? | direção clínica + enfermagem | PRODUCT_DEFINED | evento adverso/novo setor |
| U11 | Cobrança, estimativa, depósito e estorno? | financeiro | PRODUCT_DEFINED | regra fiscal/provedor novo |
| U12 | Canais e consentimento de comunicação? | produto + privacidade | PRODUCT_DEFINED | novo canal/template |
| U13 | Capacidades proibidas/permitidas da IA? | direção clínica + segurança | TECHNICALLY_SPECIFIED | mudança de model/tool/policy |
| U14 | Offline, cache, retenção, exportação e wipe? | segurança + privacidade + ops | TECHNICALLY_SPECIFIED | incidente/perda de device |
| U15 | Métricas, piloto e aceite? | produto + direção | IMPLEMENTATION_READY | baseline ou mudança de escopo |

Nenhuma decisão com owner “sugerido” deve ser tratada como aprovação. O próximo responsável deve registrar ator, data, decisão, alternativas, autoridade, evidência e `supersedes` quando reabrir uma decisão.

## 6. Evidência e limitações atuais

- `STALE/UNVERIFIED`: duas sínteses Markdown de apresentações corporativas foram registradas durante a preparação, mas os arquivos-fonte não estão presentes no artifact deste commit; seus hashes históricos e limites estão em `00-fontes-e-premissas.md`.
- `CURRENT`: o DeepSeek Harness documenta plugins Cordis, events, session, tools, approval, credentials, sandbox, jobs/workflows, subagents e telemetry.
- `PROPOSED`: todos os módulos `cvg-*`, contratos de domínio, policy CVG, data stores, BFF, workers e profile.
- `NOT_RUN`: qualquer comportamento do CVG; build/test/replay/profile dump do motor; benchmark; restore; red-team; segurança clínica; integração; aprovação humana.

O veredito da fase depende da crítica independente registrada em [`09-gauntlet-verdict.md`](09-gauntlet-verdict.md). Até a crítica e as checagens documentais concluírem, não declarar `PASS` de produção; o bar ativo é a revisão v1.1 registrada em [`00-quality-bar-v1.md`](00-quality-bar-v1.md).
