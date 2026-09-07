# CVG-Corp — Domínio, dados e contratos

**Estado:** TARGET/PROPOSED; contratos conceituais para a SPEC e o BUILD futuro.

Este documento é o dono das entidades, estados, invariantes, envelopes e regras de persistência. O PRD define o comportamento do produto; o documento 04 define como o DeepSeek Harness participa.

## 1. Identidade e escopo

Toda chamada CVG precisa resolver um `CvgContext` antes de consultar ou alterar dados:

```text
CvgContext {
  organizationId       // organização/tenant
  unitId?               // unidade física ou operacional
  workspaceId?          // área/política de trabalho
  actorId               // usuário ou serviço autenticado
  actorRoleSnapshot     // roles efetivas no momento da decisão
  patientId?            // animal em atendimento
  encounterId?          // atendimento/episódio clínico
  purpose               // finalidade explícita da consulta/ação
  policyRevision        // policy CVG + harness que decidiu o acesso
  correlationId         // rastreio ponta a ponta
}
```

Os nomes são `PROPOSED` e precisam virar IDs opacos/branded nas fronteiras públicas. Não aceitar `organizationId` vindo apenas do cliente como autoridade; o servidor deriva ou compara com a identidade autenticada.

## 2. Classificação e ownership dos dados

| Classe | Exemplos | Dono | Proteção mínima proposta |
|---|---|---|---|
| D0 público | conteúdo institucional aprovado, horários publicados, instruções públicas | comunicação/direção | revisão de conteúdo e versionamento |
| D1 interno | capacidade, procedimentos internos, indicadores agregados | operações | autenticação, escopo e retenção definida |
| D2 pessoal | nome, telefone, e-mail, endereço e identificadores do tutor | organização/privacidade | minimização, acesso por finalidade, redaction e ciclo de vida |
| D3 clínico sensível | prontuário, imagens, exames, medicações, anestesia, evolução e alta | direção clínica | least privilege, criptografia, auditoria, assinatura e retenção aprovada |
| D4 segredo | tokens, chaves, refresh tokens e credenciais de integrações | segurança/infraestrutura | vault/keychain, referência sem valor em config/log/prompt, rotação e revogação |
| D5 auditoria | decisões, acessos, aprovações, negações, exportações e reconciliações | segurança/compliance | append-only lógico, integridade, acesso restrito e retenção aprovada |

Os nomes de classes são um modelo inicial. A classificação jurídica, a base de tratamento e os prazos de retenção são `UNKNOWN` e exigem autoridade do CVG e responsável de privacidade.

## 3. Entidades canônicas

### Identidade e organização

`Organization`, `Unit`, `Workspace`, `Team`, `User`, `RoleAssignment`, `Policy`, `Consent`, `IntegrationAccount` e `AuditRecord`.

`Organization` é o limite do tenant. `Unit` representa uma unidade/filial/setor físico; `Workspace` representa uma política e uma área de trabalho, não uma autorização independente. `RoleAssignment` sempre carrega escopo e vigência.

### Tutor e paciente

`Party` representa pessoa ou organização; `GuardianLink` relaciona uma parte a um paciente com tipo de vínculo, início, fim e autoridade. `AnimalPatient` guarda espécie, raça, sexo, condição reprodutiva, nascimento aproximado, identificadores e status. Um nome, telefone ou raça não é chave suficiente. Mesclagem de duplicatas é uma operação explícita, revisável e com referência ao histórico.

### Atendimento

`ServiceCatalogItem`, `Provider`, `Resource`, `Appointment`, `QueueEntry`, `Triage`, `Encounter`, `ClinicalDocument`, `ClinicalAddendum`, `ClinicalSignature`, `Attachment`, `CarePlan`, `Order`, `MedicationOrder`, `Administration`, `DischargePlan` e `FollowUpTask`.

`ClinicalDocument` distingue conteúdo rascunhado, revisado e assinado. A fonte canônica é o documento clínico transacional; a sessão do agente e o prompt são referências de produção, não substitutos.

### Diagnóstico e procedimentos

`DiagnosticRequest`, `Specimen`, `Result`, `ResultReview`, `Procedure`, `AnesthesiaRecord`, `RecoveryRecord`, `HospitalEpisode`, `Bed`, `CareTask`, `Handoff` e `Outcome`.

Cada resultado deve apontar para pedido, paciente, amostra, origem, versão e revisão. Um resultado incompatível ou fora de ordem fica em `QUARANTINED` até decisão autorizada.

### Estoque e financeiro

`Product`, `Lot`, `StockLocation`, `StockMovement`, `Supplier`, `Purchase`, `Estimate`, `Charge`, `Payment`, `Refund`, `LedgerEntry`, `Reconciliation` e `BudgetReservation`.

O saldo é uma projeção do conjunto de movimentos válidos ou um snapshot verificável; não é um número que uma tool pode sobrescrever. O financeiro mantém seu próprio ledger e reconcilia o efeito externo.

### Conhecimento e IA

`KnowledgeCollection`, `KnowledgeDocument`, `KnowledgeVersion`, `KnowledgeChunk`, `EmbeddingReference`, `AgentProfile`, `AgentSessionLink`, `PromptContextSnapshot`, `ToolPolicy`, `ToolExecution`, `ApprovalRequest`, `UsageRecord`, `Automation`, `AutomationRun` e `AiDraft`.

`AiDraft` deve conter origem, modelo, versão do profile/policy, referências, autor do pedido, data, estado de revisão e vínculo ao recurso. A aceitação de um rascunho não transforma a saída do modelo em fato sem a ação de assinatura prevista.

## 4. Estados e transições

### Atendimento

```text
ABERTO
  -> EM_ATENDIMENTO       somente com paciente resolvido e actor clínico atribuído
  -> RASCUNHO             quando há documento ainda não assinado
  -> ASSINADO             somente por role clínica válida
  -> ENCERRADO            somente sem pendência obrigatória ou com exceção justificada
  -> EMENDADO             somente por adendo que preserva versão anterior
```

`ASSINADO` não volta para `RASCUNHO`; uma correção é nova versão/adendo. Um atendimento não pode ser encerrado enquanto uma regra obrigatória de alta, tarefa ou revisão estiver sem decisão explícita.

### Pedido e resultado

```text
RASCUNHO -> SOLICITADO -> COLETADO -> EM_PROCESSAMENTO -> RESULTADO_RECEBIDO
                                             -> QUARENTENA
RESULTADO_RECEBIDO -> EM_REVISÃO -> REVISADO -> DISPONIBILIZADO
RESULTADO_RECEBIDO -> QUARENTENA -> CORRIGIDO/REJEITADO
```

Transições exigem vínculo de paciente/encounter, origem autenticada, versão e `expectedVersion`. A revisão clínica é um estado independente do recebimento técnico.

### Ordem e administração

```text
ORDEM_RASCUNHO -> PRESCRITA -> VERIFICADA -> DISPENSADA -> ADMINISTRADA
                                     |            |             |
                                  RETIDA       CANCELADA     OMITIDA/RECUSADA
```

O domínio deve distinguir ordem prescrita, item dispensado e administração executada. Uma retry com a mesma chave não cria nova administração; uma tentativa com parâmetros incompatíveis produz conflito e exige revisão.

### Estoque

```text
RECEBIMENTO -> DISPONÍVEL -> RESERVADO -> CONSUMIDO
       |           |             |
   QUARENTENA   VENCIDO       DEVOLVIDO
```

Lote e validade são dados do movimento. `AJUSTE` nunca apaga o movimento anterior; registra diferença, motivo, ator e aprovação.

### Ação de IA

```text
SOLICITADA -> CONTEXTO_RESOLVIDO -> POLICY_VERIFICADA
    -> RASCUNHO_PRONTO -> REVISÃO_HUMANA -> PUBLICADA/REJEITADA
    -> APROVAÇÃO_PENDENTE -> EXECUTANDO -> SUCESSO/FALHA/OUTCOME_UNKNOWN
```

Uma ação `OUTCOME_UNKNOWN` não pode ser repetida automaticamente quando pode ter efeito externo. O operador deve verificar o recurso por consulta idempotente ou decidir manualmente.

## 5. Invariantes transacionais

| ID | Invariante | Ponto de enforcement |
|---|---|---|
| INV-01 | Todo objeto possui tenant e escopo compatíveis com o actor; consultas sem escopo obrigatório são inválidas. | Repositório/query policy e caso de uso; não somente UI. |
| INV-02 | Identificadores públicos são opacos e não colidem entre tipos. | Adaptadores de API, tipos e validação de boundary. |
| INV-03 | Versão esperada evita lost update; conflito devolve `STALE_VERSION`. | Comando transacional. |
| INV-04 | Assinatura não pode ser removida por update comum; adendo preserva cadeia. | Módulo de prontuário. |
| INV-05 | Pedido, amostra, resultado e revisão mantêm cardinalidade e vínculo. | Módulo de diagnóstico e inbox de integração. |
| INV-06 | Ordem, dispensação e administração são fatos distintos e correlacionados. | Módulo de terapêutica/farmácia. |
| INV-07 | Saldo por item/lote/local não fica negativo sem exceção de negócio aprovada. | Módulo de estoque. |
| INV-08 | Ledger financeiro e reconciliação são append-only lógico; estorno compensa. | Módulo financeiro. |
| INV-09 | Cada comando externo pode ser repetido com a mesma idempotency key sem duplicar efeito. | Inbox/idempotency store e domínio. |
| INV-10 | Outbox só publica evento depois do commit da transação que o originou. | Unidade transacional do domínio. |
| INV-11 | Um evento sem `correlationId`, `causationId`, actor e escopo mínimo não é aceito em caminhos auditáveis. | Event writer/auditoria. |
| INV-12 | Dado derivado por IA mantém origem e nunca sobrescreve fato canônico sem transição humana prevista. | Aplicação e policy de tools. |

## 6. Envelope de comando e resultado

O formato abaixo é um contrato de planejamento, não um endpoint atual.

```json
{
  "commandId": "opaque-command-id",
  "commandType": "clinical.document.commit",
  "schemaVersion": 1,
  "actor": { "id": "opaque-user-id", "kind": "user" },
  "scope": {
    "organizationId": "opaque-org-id",
    "unitId": "opaque-unit-id",
    "workspaceId": "opaque-workspace-id"
  },
  "resource": { "type": "encounter", "id": "opaque-encounter-id", "expectedVersion": 4 },
  "idempotencyKey": "opaque-client-key",
  "correlationId": "opaque-correlation-id",
  "purpose": "clinical-documentation",
  "payload": {}
}
```

Todo comando deve validar ator, escopo, schema, tamanho, estado, versão, policy e idempotência antes de tocar a fonte transacional. O resultado deve informar `status`, `resourceVersion`, `eventIds`, `auditId`, `warnings` e, quando aplicável, `approvalId`/`outcome`. Não retornar segredos, stack traces ou existência de recurso não autorizado.

## 7. Portas de aplicação propostas

| Porta | Entrada | Resultado mínimo | Risco |
|---|---|---|---|
| `ResolvePatientContext` | `CvgContext`, `patientRef`, purpose | contexto mínimo, fontes e versão | clínico/sensível |
| `CreateAppointment` | recurso, janela, serviço, idempotency key | reserva ou conflito | operacional |
| `OpenEncounter` | paciente, agenda/check-in, actor | encounter ativo | clínico |
| `DraftClinicalSummary` | encounter, fontes permitidas, sessão | `AiDraft` com referências | alto |
| `CommitClinicalDocument` | draft/revisão, assinatura, expectedVersion | documento assinado + evento | crítico |
| `RecordMedicationAdministration` | ordem, lote, executor, horário, idempotency key | administração ou motivo | crítico |
| `PostStockMovement` | item/lote/local, quantidade, motivo | movimento + novo saldo | alto |
| `CreateCharge` | serviços/itens aprovados, responsável | ledger entry | financeiro |
| `SendApprovedCommunication` | template, destinatário, consentimento, approval | receipt de envio | alto |
| `IndexKnowledgeVersion` | documento aprovado, ACL, hash | versão indexada ou erro | sensível |
| `RunAutomation` | automation id, janela, budget | run id e estado | alto |

Tools do harness chamam portas de aplicação; não devem gravar diretamente tabelas.

## 8. Eventos de domínio

O envelope proposto é:

```text
DomainEvent {
  eventId
  eventType
  schemaVersion
  aggregateType
  aggregateId
  aggregateVersion
  occurredAt
  actor { id, kind }
  scope { organizationId, unitId?, workspaceId? }
  correlationId
  causationId
  idempotencyKey?
  classification
  data
}
```

Exemplos: `patient.created`, `appointment.confirmed`, `encounter.opened`, `clinical.document.signed`, `diagnostic.result.received`, `diagnostic.result.reviewed`, `medication.administered`, `stock.movement.posted`, `charge.created`, `payment.reconciled`, `ai.draft.created`, `ai.action.approved`, `integration.delivery.failed` e `audit.exception.granted`.

O domínio publica depois do commit via outbox. Consumers mantêm inbox/deduplicação e não assumem ordem global; usam `aggregateVersion`, `causationId` e regras de estado. Um evento de integração duplicado, atrasado ou desconhecido vai para retry/quarentena, não para escrita silenciosa.

## 9. Relação com a sessão do DeepSeek Harness

| Dado | Fonte canônica | Relação com DSH |
|---|---|---|
| Prompt e resposta | session log do agent | model-visible, replayável e sujeito a redaction de cópia; não é prontuário. |
| Tool call/result | session log + auditoria de tool | registra tentativa, resultado e referências; efeito fica no domínio. |
| Aprovação de tool | approval events + `ApprovalRequest` | prova decisão one-shot da sessão; ainda precisa alçada/consentimento CVG. |
| Patient context snapshot | `PromptContextSnapshot` + evento de origem | mostra exatamente o contexto enviado; não altera registro por si só. |
| Rascunho IA | `AiDraft` | estado de produto ligado à sessão e ao recurso; pode ser rejeitado/editado. |
| Prontuário assinado | `ClinicalDocument` + signature | somente caso de uso clínico autorizado o cria; sessão guarda referência. |
| Uso/custo | `UsageRecord` + domínio de budget | consumo pode ser derivado da sessão, mas ledger/reconciliação é CVG. |
| Auditoria de negócio | `AuditRecord` | fonte independente para acesso e mutação; telemetria é complementar. |

O motor documenta que tudo que chega ao modelo deve ser reconstruível pelo log. Portanto, `PromptContextSnapshot` não pode conter dado que seja necessário à decisão mas que não tenha política de retenção e auditoria compatíveis.

## 10. Conhecimento e retrieval

Cada `KnowledgeVersion` precisa de `documentId`, `sourceUri`, hash, autor, aprovação, vigência, classificação, ACL, unidade/workspace, idioma, parserVersion e estado (`RECEIVED`, `VALIDATED`, `INDEXED`, `QUARANTINED`, `RETIRED`).

Cada resultado de retrieval precisa devolver `chunkId`, `documentVersion`, score, escopo, título seguro e trecho redigido. O filtro de escopo é obrigatório antes da busca vetorial, não depois de receber resultados. Um chunk é contexto não confiável e pode conter instruções adversariais; nunca altera policy.

Memória pessoal/local e conhecimento organizacional têm retenção, finalidade e exclusão diferentes. A memória derivada não pode ser usada para preencher um campo clínico assinado sem revisão e fonte.

## 11. Erros estáveis

O contrato externo deve normalizar pelo menos:

```text
AUTH_REQUIRED
FORBIDDEN
SCOPE_MISMATCH
RESOURCE_NOT_FOUND_OR_HIDDEN
VALIDATION_FAILED
STALE_VERSION
IDEMPOTENCY_CONFLICT
INVALID_STATE_TRANSITION
POLICY_DENIED
APPROVAL_REQUIRED
APPROVAL_UNAVAILABLE
BUDGET_EXCEEDED
CREDENTIAL_UNAVAILABLE
DEPENDENCY_UNAVAILABLE
TIMEOUT
OUTCOME_UNKNOWN
CLINICAL_REVIEW_REQUIRED
INTEGRATION_QUARANTINED
```

`RESOURCE_NOT_FOUND_OR_HIDDEN` evita revelar a existência de recurso fora do escopo. `OUTCOME_UNKNOWN` é diferente de `FAILURE`: significa que o sistema não sabe se o efeito externo ocorreu e deve impedir retry cego.

## 12. Retenção, backup e migração

A política definitiva é `UNKNOWN`. Antes de produção deve definir, por classe de dado, retenção mínima/máxima, expurgo, exportação, correção, anonimização, backup, restauração, legal hold e acesso excepcional.

Backups devem ser criptografados, testados em restauração isolada e associados a versão de schema, hash e janela. Migrações que alterem prontuário, ledger, sessão ou ACL precisam de plano roll-forward, compatibilidade de versões mistas, reconciliação e abort criteria.

O `SESSION_FORMAT_VERSION=0` e a postura pré-release do motor são riscos explícitos: a versão do harness, dos plugins CVG e do formato de sessão deve ficar registrada no deployment e validada por replay antes de atualização.

## 13. Contrato de lifecycle e cópias

O prazo final por classe continua `UNKNOWN`; o contrato abaixo define o que precisa ser decidido e aplicado antes do piloto. Nenhuma camada pode criar uma cópia sem declarar finalidade, escopo, owner e política de retenção. `PROPOSED` descreve o mecanismo desejado, não uma capacidade já disponível.

| Store/cópia | Classes típicas | Autoridade | Entrada e saída permitidas | Retenção, exportação e eliminação | Revogação, backup e prova |
|---|---|---|---|---|---|
| DB transacional | D1–D5 conforme tabela/coluna | domínio CVG | comandos tipados; projeções derivadas não escrevem fatos | política por classe/field; correção por versão; exclusão lógica ou anonimização somente por autoridade; export com manifest e filtro | ACL no repositório/query; backup criptografado; teste de cross-scope, idempotência e expurgo (`PROPOSED/NOT_RUN`) |
| Audit ledger | D5 | segurança/auditoria | acessos, decisões, efeitos e reconciliações minimizados | retenção independente do dado operacional, legal hold e descarte ainda `UNKNOWN`; export somente para auditoria autorizada | append-only lógico, integridade e trilha de leitura; restore e perda de sink (`PROPOSED/NOT_RUN`) |
| Object store | D2–D3: imagem, laudo, áudio, anexo e export | domínio + privacidade | upload por `AttachmentRef`, MIME/tamanho/hash validados; download por URL curta e autorizada | manifest aponta owner/classificação; revogação remove acesso e agenda expurgo; cópia de export expira conforme sua política | prefix/key não é authz; ACL server-side, criptografia, inventário de versões, restore e wipe (`PROPOSED/NOT_RUN`) |
| Vector index | D1–D3 derivados | conhecimento/privacidade | somente `KnowledgeVersion` validada, com ACL e escopo antes do embedding | é derivado: reindexar, retirar e apagar chunks/embeddings quando fonte expira; não exportar fora do escopo | filtro pré-busca + ACL pós-consulta; reconstrução a partir da fonte e teste negativo (`PROPOSED/NOT_RUN`) |
| Session persistence DSH | D2–D3 model-visible, IDs e tool results | AI gateway + privacidade | snapshot mínimo; tudo que chega ao modelo fica reconstruível no log | policy específica para session; `flush`/fork não decidem retenção; apagar/retirar exige enumerar log, projeções e referências | sessão recebe `SecurityContextSnapshot`; persistência física e replay versionado; nenhum prontuário depende só dela (`PROPOSED/NOT_RUN`) |
| Cache/endpoint local | somente subset D0–D2 previamente autorizado; D3 por exceção aprovada | segurança/ops | réplica cifrada com `DataRef`, TTL e versão; sem segredo de provider | TTL obrigatório; wipe/revoke invalidam cópia; export local proibido por padrão | secure storage, device binding, remote wipe quando aprovado, perda/restore drill (`PROPOSED/NOT_RUN`) |
| Provider LLM/mídia | payload mínimo D2–D3, uso e receipt | AI gateway + autoridade de dados | egress somente com `ProviderTransferPolicy` aprovada e credencial referenciada | contrato de retenção, treinamento, região, subprocessor e deleção são `UNKNOWN` até decisão; sem política, `DENIED`; provider delete/revoke deve ser rastreável | request/response não entram em telemetry integral; provider request id, usage e confirmação; consulta de retenção contratual (`PROPOSED/NOT_RUN`) |
| Telemetry/log operacional | D1 e metadados minimizados | ops/SRE | projeção redigida de operação, nunca payload clínico integral | retenção, sampling e perda são política própria; não reconstituem nem substituem audit ledger | collector pode perder/duplicar; `auditId` não depende dele; known-good/known-bad e expurgo (`PROPOSED/NOT_RUN`) |
| Backup/replica/export | cópia das classes de origem | dados/ops + privacidade | somente job autorizado gera manifest com schema, policy e escopo | backup segue TTL/tier/hold próprios; exclusão corrente cria tombstone/ledger e aguarda expiração da cópia conforme decisão formal; export é cópia independente com prazo | criptografia, acesso separado, restore isolado, scan de escopo e reconciliação (`PROPOSED/NOT_RUN`) |

### Envelope de lifecycle

Toda referência interna de dado que atravesse um boundary deve carregar ou resolver de forma autenticada:

```text
DataRef {
  dataRefId, sourceRecordId, classification, purpose,
  organizationId, unitId?, workspaceId?, subjectId?,
  policyRevision, policyHash, createdAt, expiresAt?, legalHold?,
  derivationOf?, exportId?, providerTransferPolicyId?
}
```

O `DataRef` não autoriza sozinho uma leitura; ele permite auditar a cópia e reavaliar a policy. A operação `erase-or-restrict` percorre o inventário de referências: DB, anexos, vetores, sessões, cache, exports, provider, telemetry e backups. Cada store retorna `removed`, `restricted`, `pending-expiry`, `held` ou `unknown`; `unknown` mantém o recurso bloqueado para nova exposição e abre reconciliação. A auditoria conserva somente o mínimo necessário para provar a decisão, conforme a política aprovada.

### LifecycleCoordinator proposto

Para que o lifecycle não dependa de uma lista manual, o domínio deve persistir uma operação coordenada e idempotente:

```text
LifecycleCommand {
  lifecycleId, operation: RESTRICT|EXPORT|ERASE|RECTIFY,
  dataRefIds, targetStores, purpose, requester,
  policyRevision, policyHash, approvalId?, idempotencyKey,
  deadline, legalHold?, status
}

LifecycleReceipt {
  lifecycleId, store, result,
  storeVersion?, providerReference?, observedAt, reasonCode, auditId
}
```

Estados: `REQUESTED → AUTHORIZED → PROPAGATING → PARTIAL/COMPLETED`, com `HELD`, `FAILED` e `UNKNOWN` como estados explícitos. O coordinator lê o inventário de `DataRef`, envia cada operação ao adapter do store, persiste receipts e repete somente operações idempotentes. Uma falha não libera a cópia restante; `PARTIAL`/`UNKNOWN` restringe nova leitura, alerta o owner e exige reconciliação. O provider não recebe solicitação de transferência se `ProviderTransferPolicy` estiver ausente; quando a retenção externa for desconhecida, o resultado é `DENIED` para o novo envio e `UNKNOWN` para a cópia já existente, até decisão contratual.

O mesmo comando gera manifest de exportação e marcação de expurgo para backup/replica; backup não é magicamente alterado, e a cópia só sai do escopo quando sua regra de expiração/tombstone for confirmada. Este contrato torna o lifecycle verificável sem inventar prazos legais; implementação e drill continuam `NOT_RUN`.

### Exportação e restauração

Um export inclui `exportId`, finalidade, requester, aprovação, filtro de escopo, classes, versões, hashes, destinatário, expiração e manifest de objetos. Restore nunca monta cópia diretamente em produção: cria ambiente isolado, aplica schema/migrations, restaura ACL e escopos, verifica vínculos, reprocessa outbox de forma congelada e só libera após reconciliação e revisão independente. Estes mecanismos são `PROPOSED/NOT_RUN`.

## 14. Versionamento, migração e restore seguro

Além de `schemaVersion` em comandos e eventos, cada contrato publicado deverá registrar:

```text
ContractDescriptor {
  contractName, schemaVersion, producerVersion,
  supportedReadVersions, supportedWriteVersions,
  compatibility, migrationId?, status, owner, effectiveAt
}
```

Regras mínimas:

1. Evento desconhecido não `ignorable` é rejeitado/quarentenado; nunca é reinterpretado por fallback.
2. Upcasters são determinísticos, versionados e preservam `eventId`, `aggregateVersion`, `causationId` e auditoria.
3. Migração de domínio usa roll-forward transacional, pré-condições, contagem/hash antes e depois, abort criteria e plano de retorno; não altera silenciosamente documento assinado ou ledger.
4. Versões mistas só são permitidas quando `supportedReadVersions`/`supportedWriteVersions` e a janela de compatibilidade estiverem registradas; caso contrário, o produtor é bloqueado.
5. Um restore valida, nesta ordem: versão do backup, migrações, ACL/escopo, invariantes, referências de objetos/vetores, outbox/inbox congelados, ledger/auditoria e replay de sessão. Falha em qualquer etapa mantém o ambiente em quarentena.
6. Para o DeepSeek Harness, a combinação `engineCommit + profileDigest + pluginDigests + SESSION_FORMAT_VERSION` é o identificador mínimo de replay. Como o motor está em `SESSION_FORMAT_VERSION=0` e pré-release, upgrade sem replay aprovado é `DENIED`.

O gate `VER-01` só poderá mudar de `NOT_RUN` após fixture de versões mistas, migração, restore e rollback ser executada no artifact exato.
