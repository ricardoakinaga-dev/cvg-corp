# CVG-Corp — Rastreabilidade e decisões

**Estado:** TARGET/PROPOSED para o programa completo; este ledger também aponta para o artifact local executável e para a evidência corrente em [12](12-estado-da-implementacao.md).

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
| NFR-DATA-01/02 | data inventory + transações locais atômicas + lifecycle journal | perda/retention incorreta ou evento separado do fato | synthetic lifecycle, crash entre commit/relay e restore com replay pós-backup | PROPOSED/NOT_RUN |
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
| `DATA-02` | lifecycle matrix/DataRef, decisão completa, `LifecycleTransitionEvent`/projeção e `LifecycleJournal` em `03 §13/14` + fluxo sensível em `05 §7` | retenção/expurgo incoerente entre cópia, provider, backup e telemetry; restore ressuscita dado, perde a decisão referenciada ou duplica transição | fixture sintética DB→object→vector→session→cache→backup→provider→telemetry + `backup→exclusão/restrição/revogação→restore`, perda do store local da decisão, replay e dedup de evento — dados/privacidade | PROPOSED/NOT_RUN |
| `DATA-03` | `LocalEndpointPolicy`, lease D0–D2 e estados de device em `05 §8` | perda, revogação ou wipe local deixa dado/privilégio utilizável | device-loss/revoke/wipe/update/restore + expiração/revalidação offline — segurança/ops | PROPOSED/NOT_RUN |
| `ISO-01` | matriz de stores em `05 §12`, `CvgContext`, DataRef e ACL | leitura, mutação ou export cross-tenant/workspace | negative tests por DB/object/vector/session/cache/billing/export/backup — domínio/segurança | PROPOSED/NOT_RUN |
| `ISO-02` | `SecurityContextSnapshot`/`PolicyBinding` em `05 §4` e lease/revalidação em `05 §8` | sessão, cache ou credencial antiga mantém privilégio | policy change, revocation epoch, TTL, workspace swap, lease expirado e reconexão — identidade/AI | PROPOSED/NOT_RUN |
| `AUTH-02` | matriz Admin Master/organização/suporte/break-glass em `05 §4` | acesso privilegiado sem finalidade, janela, dual control ou revisão | allow/deny e relatório de exceção — segurança/ops | PROPOSED/NOT_RUN |
| `AUTH-03` | `ApprovalBinding`, chave canônica, lease de claim, `IdempotencyRecord`/`ActionEnvelope` em `04 §7/7.1/7.2` e os dois caminhos de admissão em [05 §13](05-seguranca-privacidade.md#13-admission-universal-e-escrita-de-auditoria) | approval é reutilizado após alteração de args, recurso, estado ou policy, retry legítimo é negado como replay, `actionId` instável perde receipt ou claim abandonado fica preso | mutação + expiração + digest alterado + resposta perdida; retry compatível devolve receipt por chave estável sem nova approval/dispatch, ausência é comparada sem `NULL` e claim pré-dispatch é finalizado/reconciliado — AI/segurança | PROPOSED/NOT_RUN |
| `INJ-01` | untrusted-content rules em `04 §7.1`, `05 THR-01…04` | documento, RAG, e-mail, MCP ou web altera autoridade | red-team por origem e comparação de policy antes/depois — AI/segurança | PROPOSED/NOT_RUN |
| `INJ-02` | `CvgToolAdmission` comum em `04 §7.1` | native/local/MCP/skill/Code Mode/nested contorna authz/egress | bypass, nested dispatch e ferramenta comprometida — AI/runtime | PROPOSED/NOT_RUN |
| `INT-01` | `IntegrationContract`, atomicidade inbox/outbox e `OUTCOME_UNKNOWN` em `02 §9/§12/03 §8` | timeout/retry/crash gera efeito clínico externo duplicado ou falso sucesso, ou fato sem evento | crash antes/depois do commit, relay repetido, consumer duplicate/ack e reconciliação — integração | PROPOSED/NOT_RUN |
| `INT-02` | contrato individual de laboratório, pagamento, mensagem, calendário e provider em `02 §12` | adapter sem identidade, versão, webhook, erro ou reconciliação | contract/codec + integração isolada — integração | PROPOSED/NOT_RUN |
| `BUD-01` | `BudgetReservation`, dimensões e hard stop em `04 §8`, com seam mínima exigida em M3 | nested/retry/mídia/MCP consome além do limite ou M3 despacha sem budget | M3: stub com reserva/hard stop; M6: nested, crash, late usage, modalidades e limite — AI/dados | PROPOSED/NOT_RUN |
| `BUD-02` | `UsageAttempt`, lançamentos `UsageLedgerEntry` e `ProviderUsageEvent` em `04 §8` | múltiplas modalidades/estados no mesmo attempt duplicam ou perdem usage, settlement ou discrepância | crash, out-of-order, late, duplicate provider event e dois postings legítimos no mesmo attempt — dados/financeiro | PROPOSED/NOT_RUN |
| `AUD-01` | audit ledger independente em `03 §13` e `05 §9` | perda de telemetry elimina a trilha de efeito/acesso | interromper collector e consultar ledger íntegro — segurança/ops | PROPOSED/NOT_RUN |
| `AUD-02` | campos mínimos, `argumentDigest` e `TelemetryPolicy` em `05 §9` | segredo ou PII clínica desnecessária no audit/log | known-good/known-bad e inspeção de payload — segurança | PROPOSED/NOT_RUN |
| `REL-03` | estados operacionais, bounded retry e quarentena em `06 §3/5` | retry/backpressure/cancelamento/poison sem limite | fault injection e fila cheia — SRE | PROPOSED/NOT_RUN |
| `REL-04` | workloads W-A…W-H e targets em `06 §2/3` | performance aceita por média sem cauda ou mix realista | benchmark com p50/p95/p99, concorrência e provider mix — SRE | PROPOSED/NOT_RUN |
| `OBS-02` | `TelemetryPolicy`, IDs de dedup e perda em `05 §9/06 §4` | telemetry vaza, perde/duplica contexto ou é confundida com auditoria | collector indisponível, retenção, redaction e duplicate test — ops | PROPOSED/NOT_RUN |
| `AI-01` | `GovernedArtifact` registry/admission em `04 §11`, com registry/digest mínimo no M3 | modelo/prompt/tool/skill/MCP sem origem, avaliação, rollback ou kill switch executa | M3: registry/admission mínimo e digest pinado; M6: evaluation/rollback/capabilities/kill-switch — AI/clinical | PROPOSED/NOT_RUN |
| `VER-01` | `ContractDescriptor`, upcaster, decisão/eventos append-only com `decisionRecordRef`, `journalWatermark` e contratos de exportação em `03 §13/14` | versão mista ou restore muda semântica/perde vínculo/ACL, revive exclusão/revogação, perde decisão referenciada ou reenvia export desconhecido | mixed-version replay, migration, evento desconhecido, transição legítima + reentrega, perda do store local da decisão e fixture `backup→mutação→restore` sem reenvio — dados/runtime | PROPOSED/NOT_RUN |

## 2.2 Correções da auditoria documental de 2026-09-08

Os IDs abaixo são estáveis para esta rodada e não substituem os critérios existentes. `DOCUMENTED/NOT_RUN` significa que o contrato foi corrigido nos documentos, mas nenhuma implementação ou fixture executável foi apresentada.

| ID | Achado de origem | Correção canônica aplicada | Artefatos/critério afetado | Estado |
|---|---|---|---|---|
| `AUDIT-20260908-01` | Inbox/outbox podia ser persistido depois do commit, abrindo uma lacuna entre fato e evento. | Mutação + outbox do produtor, ou inbox + efeito local do consumidor, são uma única transação; relay/publicação/ack só depois do commit. | `02 §9/§12`, `03 §8`, `INT-01`, `NFR-DATA-01/02` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-02` | Chave única do settlement confundia identidade de tentativa, lançamentos e eventos do provider. | `UsageAttempt`, `UsageLedgerEntry` e `ProviderUsageEvent` têm identidades e unicidades separadas; modalidades, release e compensação são postings vinculados ao attempt. | `04 §8`, `BUD-02` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-03` | Uma máquina de medicação misturava prescrição, dispensação e administração e colocava omissão/recusa depois de administrada. | Máquinas e cardinalidades separadas; `OMITIDA`/`RECUSADA` são resultados alternativos da ocorrência de administração. | `03 §3/§4`, `INV-06`, `CLIN-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-04` | Contrato offline prometia bloquear revogação mesmo sem conexão. | V1 limita lease offline a D0–D2 read-only com `maxOfflineAge`; D3–D5/efeitos, escrita e rascunho offline exigem conexão; revogação é revalidada no primeiro boundary online e falha de revalidação nega/purga. | `01 §5/§10`, `04 §10`, `05 §4/§8`, `06 §5`, `DATA-03`, `ISO-02` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-05` | Restore não exigia reaplicar exclusões/restrições/revogações posteriores ao backup. | `LifecycleJournal` independente, `journalWatermark`, continuidade/hash, replay idempotente antes de liberar leitura e fixture explícita de backup→mutação→restore. | `03 §13/§14`, `06 §5`, `DATA-02`, `VER-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-06` | M3 exigia timeout/replay/copiloto antes da primeira integração com o Harness, relegada ao M6. | M3 agora entrega a seam mínima pinada e reproduzível, incluindo registry, budget e credential/transfer stub; M6 estende para Harness completo, knowledge, budget/settlement e automações. | `07 §3/§4/§6`, `ARC-02`, `BUD-01`, `AI-01`, `PLAN-01` | DOCUMENTED/NOT_RUN |

## 2.3 Correções adicionais da auditoria de consistência — 2026-09-08

Esta rodada mantém a mesma regra: `DOCUMENTED/NOT_RUN` indica contrato atualizado, sem implementação ou fixture executável comprovando o comportamento.

| ID | Achado de origem | Correção canônica aplicada | Artefatos/critério afetado | Estado |
|---|---|---|---|---|
| `AUDIT-20260908-07` | Approval one-shot era consultado antes da idempotência e podia negar o retry legítimo. | Revalidar identidade/escopo e comparar digest; resultado `SUCCEEDED`/`IN_FLIGHT`/`OUTCOME_UNKNOWN` compatível devolve receipt/estado existente sem consumir approval, budget ou dispatch. Nova chave ou digest divergente segue approval novo/conflito. | `04 §7/§7.1`, `AUTH-03`, `BR-10/BR-12` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-08` | A decisão de lifecycle podia ser confirmada antes de estar durável no journal independente. | Durabilidade `QUORUM_DURABLE`, checkpoint reconciliado, replay de pendências anteriores e posteriores ao watermark, estados `DURABILITY_PENDING`/`UNKNOWN`, guard fail-closed e conclusão somente após decisão recuperável fora do snapshot; a separação entre decisão e eventos de fase é detalhada em `AUDIT-20260908-13`. | `03 §13/§14`, `DATA-02`, `VER-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-09` | M3 usava provider/tool sem registry e budget exigidos pela admissão antes do dispatch. | M3 passa a incluir registry/digest, budget reservation/hard stop e credential/transfer stub; M6 fica responsável pela extensão completa, settlement, rotação e capabilities. | `07 §3/§4/§6`, `ARC-02`, `BUD-01`, `AI-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-10` | PRD e estados operacionais permitiam rascunho offline enquanto a policy V1 restringia a leitura. | V1 é `OFFLINE_READ_ONLY` D0–D2, sem rascunho local persistido, edição offline aceita ou sincronização de escrita. Queda breve preserva o texto apenas no buffer volátil enquanto o contexto é válido; exibição depende de classificação e autorização conforme o [contrato de buffer em 05](05-seguranca-privacidade.md#buffer-de-composição-durante-desconexão), mantendo D3–D5/desconhecido oculto em quarentena; `COMPOSER_CONTEXT_LOST` é o único gatilho de descarte e ocorre no encerramento/invalidação da composição. A reconexão revalida sessão/policy antes de permitir revisão e envio explícito. | `01 §5/§10`, `04 §10`, `06 §5`, `FR-22`, `OFF-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-11` | O diagrama sugeria worker conectado diretamente ao PostgreSQL. | Worker passa por `cvg-domain`/`CvgAdmission`; não acessa diretamente store clínico. Integração externa usa adapter governado e store técnico distinto só se explicitamente classificado. | `02 §2/§4`, `05 §12`, `ISO-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-12` | `INV-07` permitia exceção de negócio ao saldo negativo, contrariando BR-06. | Saldo negativo é sempre rejeitado atomicamente; ajuste autorizado corrige discrepância sem criar saldo negativo e registra motivo, alçada e auditoria. | [01 §6](01-prd-cvg.md#6-regras-de-negócio-e-invariantes), [03 §5](03-dominio-dados-contratos.md#5-invariantes-transacionais), [06 §6](06-operacao-qualidade-e-recuperacao.md#6-estratégia-de-testes), `BR-06`, `INV-07` | DOCUMENTED/NOT_RUN |

## 2.4 Correções da auditoria de contratos de replay e lifecycle — 2026-09-08

Esta rodada resolve quatro achados novos sem alterar os IDs das rodadas anteriores. O estado `DOCUMENTED/NOT_RUN` significa que o contrato e os cenários foram registrados, mas ainda não há implementação, crash test ou fixture executável.

| ID | Achado de origem | Correção canônica aplicada | Artefatos/critério afetado | Estado |
|---|---|---|---|---|
| `AUDIT-20260908-13` | A mesma decisão precisava registrar `ENFORCEMENT_REQUIRED` e `COMPLETED`, mas o append por operação/digest tratava a segunda fase como colisão. | `LifecycleDecision` tem identidade lógica `(operationId, decisionDigest)`; cada `LifecycleTransitionEvent` tem `transitionEventId`/`eventSequence` próprios, receipt durável e deduplicação por evento. `LifecycleStateProjection` materializa a fase atual; transição legítima cria novo evento e reentrega idêntica é no-op. A durabilidade do payload completo da decisão e sua referência imutável estão detalhadas em `AUDIT-20260908-17`. | `03 §13/§14`, `07 M7`, `DATA-02`, `VER-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-14` | `LifecycleCommand` aceitava `EXPORT`, mas o enum do journal representava somente enforcement. | `EXPORT` segue contrato durável próprio com `ExportAuthorization`, `ExportOperation`, `ExportDeliveryAttempt` e `ExportDurableReceipt`. Recuperar autorização, recuperar tentativa e criar novo envio são operações distintas; tentativa `UNKNOWN` não é reenviada automaticamente e não entra no `LifecycleJournal` de enforcement. | `03 §13/§14`, `05 §13`, `07 M7`, `INT-01`, `VER-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-15` | A deduplicação usava `actionId` sem estabilidade, então uma resposta perdida podia gerar outra execução para a mesma chave. | `IdempotencyLookupKey` server-scoped usa identidade, escopo, tipo de comando, recurso e `idempotencyKey`; `actionId`/`commandId` originais são persistidos e recuperados do registro, nunca usados como chave de busca. A representação não anulável de campos ausentes está detalhada em `AUDIT-20260908-18`. | `01 BR-10/AC-PRD-11`, `04 §7/§7.1`, `07 M3`, `AUTH-03` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-16` | Replay, admissão geral e fluxo de segurança não distinguiam claramente leitura de resultado existente de nova execução com credencial/egress. | `REPLAY_LOOKUP` revalida identidade, escopo, revogação e autorização de leitura e devolve o receipt sem budget/approval/credencial/dispatch; `NEW_EXECUTION` reivindica a chave e passa por authz de ação/estado, registry, budget, approval, credencial e egress. Corrida na reivindicação retorna ao replay; a recuperação de claim abandonado está detalhada em `AUDIT-20260908-19`. | `04 §7/§7.1`, `05 §13`, `07 M3`, `AUTH-03` | DOCUMENTED/NOT_RUN |

## 2.5 Correções da auditoria de durabilidade e reivindicação — 2026-09-08

Esta rodada fecha as lacunas restantes de recuperação. `DOCUMENTED/NOT_RUN` continua significando contrato corrigido, sem implementação ou fixture executável.

| ID | Achado de origem | Correção canônica aplicada | Artefatos/critério afetado | Estado |
|---|---|---|---|---|
| `AUDIT-20260908-17` | O receipt do evento carregava `decisionId`, mas não comprovava que o payload completo da decisão estava recuperável fora do snapshot. | `LifecycleDecision` é um registro imutável e completo, persistido antes do evento em armazenamento independente; `LifecycleDecisionDurableReceipt` comprova sua durabilidade. Evento e receipt carregam `decisionRecordRef`/digests e só são válidos com durabilidade da decisão e do evento. Restore sem o registro referenciado entra em quarentena; o teste cobre perda do store local da decisão. | `03 §13/§14`, `06 §5`, `07 M7`, `DATA-02`, `VER-01` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-18` | Campos opcionais no índice composto podiam virar `NULL` e permitir duplicatas concorrentes no PostgreSQL. | A chave usa codificação canônica tipada `VALUE|ABSENT`, `lookupKeyHash NOT NULL UNIQUE` e comparação do canonical; colunas decompostas só podem usar `NULLS NOT DISTINCT`/equivalente. O aceite cobre concorrência com `unitId`, `workspaceId` e `resourceId` ausentes individualmente e em combinação. | `04 §7`, `01 AC-PRD-12`, `07 M3`, `AUTH-03` | DOCUMENTED/NOT_RUN |
| `AUDIT-20260908-19` | Claim criado antes do dispatch podia permanecer `IN_FLIGHT` após negação ou crash, sem caminho de recuperação. | `ADMISSION_PENDING` usa lease e `claimEpoch`; negação sem intent finaliza `FAILED/PRE_DISPATCH`, claim expirado sem intent vira `CLAIM_ABANDONED`, e qualquer intent/envio possível vira `OUTCOME_UNKNOWN` para reconciliação. O registro não é apagado nem redispatchado pelo replay; worker antigo é cercado por fencing. | `04 §7/§7.2`, `05 §13`, `06 §5`, `07 M3`, `AUTH-03`, `INT-01` | DOCUMENTED/NOT_RUN |

## 2.6 Correção da exibição do buffer offline — 2026-09-08

| ID | Achado de origem | Correção canônica | Artefatos/critério afetado | Estado |
|---|---|---|---|---|
| `AUDIT-20260908-20` | Preservar todo texto visível offline permitia exibir D3–D5 ou conteúdo não classificado apesar da restrição D0–D2. | [05 — Buffer de composição](05-seguranca-privacidade.md#buffer-de-composição-durante-desconexão) separa retenção volátil e exibição: D0–D2 classificados/autorizados podem ser lidos; demais conteúdos ficam ocultos em quarentena. Reexibição exige revalidação e classificação autorizada; perda do contexto purga. | `AC-PRD-08`, `OFF-01`, `DATA-03`, `ISO-02`, `07 M3/M7` | DOCUMENTED/NOT_RUN |

## 3. Quality Bar→artefatos

| Critério | Artefato que owns a resposta | Evidência atual | Lacuna |
|---|---|---|---|
| DOC-01 | `00-fontes-e-premissas.md` | fontes/hash e classificações registrados | validar mudanças de origem |
| DOC-02 | `01-prd-cvg.md` | jornadas, regras, FR/NFR e acceptance escritos | confirmação da operação real |
| ARC-01 | `02-arquitetura-alvo.md` + `03-dominio-dados-contratos.md` | ownership, fonte transacional e artifact PostgreSQL local verificados | repositories de leitura completos, lifecycle e recovery operacional ainda ausentes |
| ARC-02 | `04-motor-deepseek-e-plugins.md` + `07` | seam local de policy/budget/approval/replay e matriz para seams atuais | profile dump, registry completo, provider real, egress e controles de produção não foram executados |
| DATA-01 | `03` + `05` | classes, entidades e invariantes propostos | retenção, backup e restore desconhecidos |
| SEC-01 | `05` | trust boundaries, matriz e ameaças documentadas | testes e políticas aprovadas ausentes |
| CLIN-01 | `01`, `03`, `05` | draft/signed, states e controles | direção clínica ainda não aprovou |
| OPS-01 | `06` | SLO/RTO/RPO e runbooks propostos | baseline e drills não executados |
| AAA-01 | `06` | rubric A1, assistência segura, falhas bloqueadoras e aceite | evidência de runtime clínico inexistente |
| AAA-02 | `06` | rubric A2, isolamento, integridade, ledger, segregação e restore | evidência de runtime administrativo inexistente |
| AAA-03 | `06` | rubric A3, policy, tools, budget, approval, knowledge, telemetry e kill switch | evidência de runtime do harness inexistente |
| TRACE-01 | este documento | relações para FR/NFR e riscos | checks aguardam repositório de implementação |
| PLAN-01 | `07` | milestones, dependências, recuperação e checkpoint B1–B5 | B6/B7, restore operacional e aceite completo permanecem pendentes |
| DOC-03 | todos em `docs/` | escopo de escrita registrado e estado corrente em 12 | fingerprint de release e aceite independente ainda não confirmam produção |

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

**Status:** PROPOSED. **Drivers:** fontes permitem degradação sem novos acessos, mas não definem contrato. **Decisão V1:** offline só oferece leitura D0–D2 previamente autorizada por lease finito (`maxOfflineAge`); não permite D3–D5, privilégio, escrita pendente, comunicação ou efeito externo. Revogação server-side é garantida no primeiro boundary online, antes de leitura ou sincronização; enquanto desconectado, o contrato não promete invalidação instantânea, e lease expirado ou revalidação impossível produz `DENIED` + purge. **Alternativa:** write-behind transparente ou offline clínico; rejeitada até conflito, retenção e revogação serem provados.

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

### Fechamento confirmado em 2026-09-08

Fonte: respostas explícitas do solicitante nesta conversa. Autoridade: definição do recorte de produto para desenvolvimento local; não substitui validação clínica, de privacidade ou aprovação de produção. Estes registros resolvem apenas os limites indicados; as perguntas da tabela continuam sendo reavaliadas nos respectivos milestones.

| Registro | Decisão confirmada | Alternativa não escolhida | Pendência residual |
|---|---|---|---|
| DEC-M1-01 / U1 | Somente CVG, preparado para várias unidades. Organização continua sendo limite de autorização; não haverá cadastro de empresas externas na primeira entrega. | SaaS para empresas independentes desde o início. | Reabrir U1 antes de atender outra empresa. |
| DEC-M1-02 / U14 e U15 parciais | Primeira entrega M1: autenticação, organização/unidade, permissões e auditoria, local e com dados sintéticos. | Incluir cadastro e agenda na primeira entrega. | Retenção real, piloto, métricas operacionais e demais decisões U14/U15 permanecem abertas. |
| DEC-M1-03 / U5 parcial | Administrador da organização gerencia usuários/permissões; veterinário e recepção recebem acessos de trabalho; operador técnico não tem acesso clínico por padrão. | Outros papéis ou regras como base inicial. | Matriz granular, alçadas, coassinaturas e acesso emergencial ainda precisam de especificação/validação aplicável. |

Ator dos três registros: solicitante do projeto; data: 2026-09-08; evidência: respostas às três perguntas de fechamento de M1; `supersedes`: nenhuma decisão aprovada anterior, refinam propostas pendentes. Não foi atribuída ao solicitante uma função clínica ou de segurança não informada.

### Ordem de resolução das pendências

| Marco de entrada | Decisões a resolver | Limite que permite postergar as demais |
|---|---|---|
| M1 local sintético | U1 resolvida; U5 base confirmada, detalhar matriz; U4 usar fixtures de unidades/workspaces; U14 definir sessão, auditoria e descarte sintéticos; U15 congelar aceite funcional local. | Sem dados reais, jornada clínica, IA, integrações, offline ou acesso emergencial habilitado. |
| M2 | U2/U3/U4 para serviços e agenda; U6 para identidade, duplicidade e vínculos. | Cadastro e agenda não são implementados em M1. |
| M3 | U7, U13 e U14 para atendimento, assinatura, contexto e provider stub. | Nenhum registro clínico nem IA em M1/M2 sem os respectivos contratos. |
| M4 | U8, U9 e U10, complementando U2/U3/U4/U5 para diagnóstico, internação e medicação. | Nenhuma dessas capacidades é habilitada antecipadamente. |
| M5 | U11 e U12; completar políticas de dados e alçadas aplicáveis. | Nenhum efeito financeiro ou comunicação externa antecipado. |
| M6 e antes de qualquer dado/provider real | U13/U14 completos para transferência, retenção, credenciais e recuperação. | Stubs e dados sintéticos não autorizam egress ou tratamento real. |
| Antes do piloto/M7 | U15 operacional, responsáveis reais e aceite dos demais U aplicáveis. | Aceite local não significa aceite de operação ou release. |

Esta ordem torna explícita a descoberta incremental; não marca como resolvida uma decisão apenas porque foi adiada. O [plano de execução](07-plano-execucao.md) controla os bloqueios de entrada; a [preparação M1](10-preparacao-m1.md) detalha o próximo trabalho técnico.

### Pacote técnico apresentado em 2026-09-08

`DEC-M1-04 — APPROVED_LOCAL_M1`: TypeScript/Node 24, React/Vite, Fastify 5, PostgreSQL 18 e sessão server-side; justificativas e fontes em 02. Autenticação e limites locais em 05; contratos de API/dados em 03; tarefas e comandos-alvo em 07. Autor da proposta: assistente; aprovado explicitamente pelo solicitante em 2026-09-08 para M1 local sintético.

`DEC-M1-05 — APPROVED_LOCAL_M1`: solicitante confirmou as alçadas propostas em 05/10 e assumiu o aceite da demonstração. Evidência: “Aprovo esse pacote para M1 local com dados sintéticos, confirmo as alçadas propostas e serei responsável pelo aceite da demonstração. Pode registrar as decisões e iniciar B1.” Ator: solicitante; data: 2026-09-08; autoridade: recorte local; alternativas: alterar stack/alçadas ou indicar outro responsável; `supersedes`: propostas locais correspondentes, sem alterar decisões clínicas/produção.

Entrada de B1 autorizada. Resolução de versões e scaffold em execução; ambiente reavaliado: Docker/Compose presentes, porém socket Docker sem permissão nesta sessão. O estado de B1 e as provas ficam em 07.

## 6. Evidência e limitações atuais

- `STALE/UNVERIFIED`: duas sínteses Markdown de apresentações corporativas foram registradas durante a preparação, mas os arquivos-fonte não estão presentes no artifact deste commit; seus hashes históricos e limites estão em `00-fontes-e-premissas.md`.
- `CURRENT`: o DeepSeek Harness documenta plugins Cordis, events, session, tools, approval, credentials, sandbox, jobs/workflows, subagents e telemetry.
- `PROPOSED`: todos os módulos `cvg-*`, contratos de domínio, policy CVG, data stores, BFF, workers e profile.
- Execução atual do artifact CVG: a evidência corrente em [12](12-estado-da-implementacao.md) registra 43/43 testes locais, build/static, 15/15 E2E, migrations `001`–`017`, `FORCE RLS` em 54/54 tabelas de domínio, 94 FKs com proveniência organizacional e restore sintético AES-256-GCM com tamper rejection e quarentena. Continuam `NOT_RUN` como critérios integrais: comportamentos completos de M1, motor externo, benchmark, lifecycle pós-watermark, stores externos, red-team, segurança clínica, integração real e recovery operacional gerenciado. Aprovação humana de recorte local registrada acima não é aceite da demonstração ou produção.

O veredito da fase depende da crítica independente registrada em [`09-gauntlet-verdict.md`](09-gauntlet-verdict.md). Até a crítica e as checagens documentais concluírem, não declarar `PASS` de produção; o bar ativo é a revisão v1.1 registrada em [`00-quality-bar-v1.md`](00-quality-bar-v1.md).
