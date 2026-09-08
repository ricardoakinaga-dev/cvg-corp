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

`ServiceCatalogItem`, `Provider`, `Resource`, `Appointment`, `QueueEntry`, `Triage`, `Encounter`, `ClinicalDocument`, `ClinicalAddendum`, `ClinicalSignature`, `Attachment`, `CarePlan`, `Order`, `MedicationOrder`, `Dispensation`, `AdministrationOccurrence`, `DischargePlan` e `FollowUpTask`.

`ClinicalDocument` distingue conteúdo rascunhado, revisado e assinado. A fonte canônica é o documento clínico transacional; a sessão do agente e o prompt são referências de produção, não substitutos.

### Diagnóstico e procedimentos

`DiagnosticRequest`, `Specimen`, `Result`, `ResultReview`, `Procedure`, `AnesthesiaRecord`, `RecoveryRecord`, `HospitalEpisode`, `Bed`, `CareTask`, `Handoff` e `Outcome`.

Cada resultado deve apontar para pedido, paciente, amostra, origem, versão e revisão. Um resultado incompatível ou fora de ordem fica em `QUARANTINED` até decisão autorizada.

### Estoque e financeiro

`Product`, `Lot`, `StockLocation`, `StockMovement`, `Supplier`, `Purchase`, `Estimate`, `Charge`, `Payment`, `Refund`, `LedgerEntry`, `Reconciliation` e `BudgetReservation`.

O saldo é uma projeção do conjunto de movimentos válidos ou um snapshot verificável; não é um número que uma tool pode sobrescrever. O financeiro mantém seu próprio ledger e reconcilia o efeito externo.

### Conhecimento e IA

`KnowledgeCollection`, `KnowledgeDocument`, `KnowledgeVersion`, `KnowledgeChunk`, `EmbeddingReference`, `AgentProfile`, `AgentSessionLink`, `PromptContextSnapshot`, `ToolPolicy`, `ToolExecution`, `ApprovalRequest`, `UsageRecord`, `UsageAttempt`, `UsageLedgerEntry`, `ProviderUsageEvent`, `Automation`, `AutomationRun` e `AiDraft`.

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

### Ordem, dispensação e administração

Ordem, dispensação e cada ocorrência de administração são agregados/fatos separados. Não existe uma única máquina de estados que transforme uma prescrição diretamente em administração:

```text
Ordem:
ORDEM_RASCUNHO -> PRESCRITA -> VERIFICADA -> SUSPENSA/CANCELADA

Dispensação:
SOLICITADA -> RESERVADA -> DISPENSADA -> DEVOLVIDA
                         |             |
                      CANCELADA     QUARENTENA

Ocorrência de administração:
PLANEJADA -> ELEGÍVEL -> ADMINISTRADA (fato concluído)
                 |\
                 +--> OMITIDA
                 +--> RECUSADA
```

`OMITIDA` e `RECUSADA` são resultados alternativos da ocorrência planejada, antes de `ADMINISTRADA`; não são transições posteriores a uma administração já concluída. Uma `MedicationOrder` pode possuir zero ou mais `Dispensation` e zero ou mais `AdministrationOccurrence`, cada ocorrência com horário/janela, dose, executor, motivo e vínculo à ordem. Repetir a mesma chave da ocorrência retorna o mesmo resultado; parâmetros incompatíveis geram conflito. Uma correção posterior cria novo fato/adendo auditável e nunca reescreve a ocorrência original.

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
| INV-06 | Ordem, dispensação e cada ocorrência de administração são fatos distintos e correlacionados; `OMITIDA`/`RECUSADA` são resultados da ocorrência, não estados posteriores a `ADMINISTRADA`. | Módulo de terapêutica/farmácia. |
| INV-07 | Saldo por item/lote/local nunca fica negativo; qualquer movimento que produziria saldo negativo é rejeitado atomicamente. Ajuste autorizado só pode corrigir a discrepância por movimento compensatório sem criar saldo negativo. | Módulo de estoque, caso de uso transacional e constraint/serialização do saldo. |
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
| `RecordMedicationAdministration` | ocorrência planejada, ordem, lote, executor, horário, resultado e idempotency key | administração, omissão ou recusa com motivo | crítico |
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

Exemplos: `patient.created`, `appointment.confirmed`, `encounter.opened`, `clinical.document.signed`, `diagnostic.result.received`, `diagnostic.result.reviewed`, `medication.dispensed`, `medication.administered`, `medication.omitted`, `medication.refused`, `stock.movement.posted`, `charge.created`, `payment.reconciled`, `ai.draft.created`, `ai.action.approved`, `integration.delivery.failed` e `audit.exception.granted`.

O domínio grava o fato e o outbox na mesma transação e publica somente depois do commit. Consumers gravam inbox/deduplicação e o efeito local na mesma transação, confirmando o recebimento somente depois dela. Eles não assumem ordem global; usam `aggregateVersion`, `causationId` e regras de estado. Um evento de integração duplicado, atrasado ou desconhecido vai para retry/quarentena, não para escrita silenciosa.

## 9. Relação com a sessão do DeepSeek Harness

| Dado | Fonte canônica | Relação com DSH |
|---|---|---|
| Prompt e resposta | session log do agent | model-visible, replayável e sujeito a redaction de cópia; não é prontuário. |
| Tool call/result | session log + auditoria de tool | registra tentativa, resultado e referências; efeito fica no domínio. |
| Aprovação de tool | approval events + `ApprovalRequest` | prova decisão one-shot da sessão; ainda precisa alçada/consentimento CVG. |
| Patient context snapshot | `PromptContextSnapshot` + evento de origem | mostra exatamente o contexto enviado; não altera registro por si só. |
| Rascunho IA | `AiDraft` | estado de produto ligado à sessão e ao recurso; pode ser rejeitado/editado. |
| Prontuário assinado | `ClinicalDocument` + signature | somente caso de uso clínico autorizado o cria; sessão guarda referência. |
| Uso/custo | `UsageRecord` como projeção + `UsageAttempt`/`UsageLedgerEntry`/`ProviderUsageEvent` | consumo pode ser derivado da sessão, mas tentativa, postings, deduplicação e reconciliação são CVG. |
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
| Backup/replica/export | cópia das classes de origem | dados/ops + privacidade | somente job autorizado gera manifest com schema, policy, escopo e watermark do registro de lifecycle; export cria `ExportAuthorization` durável | backup segue TTL/tier/hold próprios; exclusão corrente cria tombstone/ledger e aguarda expiração da cópia conforme decisão formal; export é cópia independente com prazo e tentativas de entrega rastreáveis | criptografia, acesso separado, restore isolado, replay do journal pós-backup, scan de escopo e reconciliação sem reenvio automático (`PROPOSED/NOT_RUN`) |

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
  lifecycleId, operation: RESTRICT|EXPORT|ERASE|RECTIFY|REVOKE,
  dataRefIds, targetStores, purpose, requester,
  policyRevision, policyHash, decisionDigest, approvalId?, idempotencyKey,
  decisionId?, transitionEventId?, exportId?, deadline, legalHold?,
  status: REQUESTED|AUTHORIZED|DURABILITY_PENDING|ENFORCEMENT_PENDING|
          PROPAGATING|PARTIAL|COMPLETED|HELD|FAILED|UNKNOWN
}

LifecycleReceipt {
  lifecycleId, store, result,
  storeVersion?, providerReference?, observedAt, reasonCode, auditId
}
```

`LifecycleCommand` é o envelope de coordenação. Para `RESTRICT`, `ERASE`,
`RECTIFY` e `REVOKE`, ele aponta para uma decisão de enforcement e para seus
eventos no journal. `EXPORT` é uma operação de cópia e segue o contrato
durável separado abaixo; portanto, não precisa aparecer como um evento de
enforcement no `LifecycleJournal`.

### Contrato durável de exportação

Exportação precisa separar a autorização do arquivo e cada tentativa de
entrega. Assim, recuperar uma resposta perdida não reautoriza nem reenvia o
arquivo, enquanto um novo envio fica explicitamente visível e sujeito a nova
validação:

```text
ExportAuthorization {
  authorizationId, exportId, operationId, authorizationDigest,
  scopeManifestDigest, dataRefIds, requester, approver?, purpose,
  destinationRef, destinationPolicyDigest,
  policyRevision, policyHash, approvalId?,
  status: REQUESTED|AUTHORIZED|REVOKED|EXPIRED|DENIED,
  createdAt, expiresAt, auditId
}

ExportOperation {
  exportId, operationId, authorizationId, idempotencyKey,
  artifactRef?, artifactDigest?, artifactVersion?,
  status: REQUESTED|PACKAGING|READY|REVOKED|EXPIRED|UNKNOWN,
  createdAt, updatedAt
}

ExportDeliveryAttempt {
  deliveryAttemptId, exportId, deliveryIdempotencyKey,
  artifactRef, artifactDigest, destinationRef,
  status: PREPARED|SENT|RECEIPTED|UNKNOWN|CANCELLED,
  externalRequestId?, receiptRef?, createdAt, updatedAt
}

ExportDurableReceipt {
  authorizationId, exportId, deliveryAttemptId?,
  recordDigest, durability: QUORUM_DURABLE, durableAt
}
```

`ExportAuthorization` é a fonte durável da autorização, com unicidade por
`operationId + authorizationDigest`; uma reentrega compatível recupera a
autorização e seu receipt sem consumir uma nova approval. O artefato é
preparado uma vez e referenciado pelo `artifactDigest`. Cada
`ExportDeliveryAttempt` tem sua própria chave estável: repetir a mesma chave
consulta `RECEIPTED`, `SENT` ou `UNKNOWN` e reconcilia o destino, sem enviar
cegamente de novo. Um novo envio exige um novo `deliveryIdempotencyKey`,
revalida autorização vigente, escopo, destinatário, expiração e digest do
artefato, e cria uma nova tentativa; ele não reaproveita a autorização para
um escopo ou destinatário diferente. A unicidade mínima da entrega é
`(exportId, deliveryIdempotencyKey)`; se a mesma chave vier com artefato,
destino ou digest diferente, retorna `EXPORT_DELIVERY_CONFLICT`.

O protocolo de `EXPORT` é: (1) canonizar escopo, finalidade, destinatário e
política; (2) persistir `ExportAuthorization` e aguardar
`ExportDurableReceipt`; (3) criar ou recuperar `ExportOperation` e preparar o
artefato de forma idempotente; (4) persistir `ExportDeliveryAttempt` antes de
qualquer envio externo; (5) enviar somente essa tentativa e gravar receipt ou
`UNKNOWN`. No restore, autorização, artefato e tentativa são recuperados como
estado; uma tentativa `UNKNOWN` é reconciliada, nunca reenviada
automaticamente. A recuperação da autorização e a criação de uma nova
tentativa são comandos distintos e auditáveis.

### Registro independente de lifecycle e revogação

Backup não pode ser a única fonte para saber se um dado, uma policy ou uma autorização continuava válida depois do instante do snapshot. O domínio deve manter, em armazenamento durável independente do payload restaurável, um journal append-only com sequência verificável:

```text
LifecycleDecision {
  decisionId, operationId,
  kind: RESTRICT|ERASE|RECTIFY|REVOKE,
  dataRefIds, targetStores, subjectRef?, scope,
  purpose, requester, legalHold?, deadline?,
  policyRevision, policyHash, decisionDigest, reasonCode,
  idempotencyKey?, decisionRecordRef, decisionRecordDigest,
  decisionVersion, occurredAt, actorId, auditId
}

LifecycleDecisionDurableReceipt {
  decisionId, operationId, decisionDigest,
  decisionRecordRef, decisionRecordDigest,
  durability: QUORUM_DURABLE, durableAt, journalGeneration
}

LifecycleTransitionIntent {
  transitionEventId, decisionId, operationId, eventSequence,
  decisionDigest, decisionRecordRef, decisionRecordDigest,
  eventType, eventDigest,
  status: INTENT_DURABLE|APPEND_CONFIRMED|PROJECTION_PENDING|UNKNOWN,
  createdAt, updatedAt
}

LifecycleTransitionEvent {
  transitionEventId, decisionId, operationId,
  journalSequence, eventSequence,
  eventType: ENFORCEMENT_REQUIRED|APPLIED|COMPLETED|FAILED|UNKNOWN|RECONCILED,
  decisionDigest, decisionRecordRef, decisionRecordDigest,
  dataRefIds, scope,
  eventDigest, causationId?,
  occurredAt, recordedAt, actorId, auditId,
  previousEventHash, eventHash
}

LifecycleStateProjection {
  decisionId, operationId, decisionDigest,
  decisionRecordRef, decisionRecordDigest,
  currentPhase: ENFORCEMENT_REQUIRED|APPLIED|COMPLETED|FAILED|UNKNOWN|RECONCILED,
  lastEventSequence, appliedStores?, stateVersion,
  updatedAt, projectionHash
}

LifecycleDurableReceipt {
  transitionEventId, decisionId, operationId, decisionDigest,
  journalSequence, eventSequence, eventDigest, eventHash,
  decisionReceiptRef, decisionRecordRef, decisionRecordDigest,
  decisionDurability: QUORUM_DURABLE, decisionDurableAt,
  eventDurability: QUORUM_DURABLE, durableAt, journalGeneration
}
```

`REVOKE` cobre usuário, role, device, credencial, sessão, policy e binding e atualiza o `revocationEpoch`; `RESTRICT`/`ERASE` cobrem tombstones e bloqueios de dados/cópias. `LifecycleDecision` é o registro imutável e completo necessário para reaplicar a decisão: inclui alvo, stores, sujeito, escopo, finalidade, requester, policy, motivo e restrições temporais. `decisionDigest` é calculado sobre esse payload completo; `decisionRecordDigest` é calculado sobre a serialização canônica do registro, excluindo o próprio campo de digest e receipts derivados. A identidade da decisão é a chave lógica `(operationId, decisionDigest)`: ela encontra ou cria exatamente uma decisão e seu registro durável.

Antes de qualquer evento, o registro completo é persistido em armazenamento de decisão independente do payload restaurável e precisa produzir um `LifecycleDecisionDurableReceipt` `QUORUM_DURABLE`. `decisionRecordRef` é uma referência imutável recuperável fora do snapshot; o `LifecycleTransitionEvent` e o `LifecycleDurableReceipt` repetem essa referência e seus digests. Um receipt do journal só é válido quando comprova simultaneamente a durabilidade da decisão completa e do evento; receipt sem decisão recuperável não autoriza replay nem conclusão.

A identidade de uma mudança de fase é `transitionEventId`, alocada uma vez em `LifecycleTransitionIntent` na transação local da intenção/outbox e reutilizada em toda reentrega ou recuperação. O journal append-only deduplica por `transitionEventId` e `eventDigest`: a mesma combinação retorna o evento e receipt existentes; o mesmo ID com digest diferente é `LIFECYCLE_EVENT_CONFLICT`. Uma transição legítima usa outro `transitionEventId` e outro `eventSequence`, mesmo apontando para a mesma decisão; `(decisionId, eventSequence)` também é único. Nunca se atualiza o evento anterior para mudar sua fase.

O journal corrente só emite `LifecycleDurableReceipt` após `fsync` e confirmação de uma política de durabilidade `QUORUM_DURABLE` fora do snapshot; armazenamento local isolado ou um `200 OK` sem receipt não é confirmação. `LifecycleStateProjection` é uma projeção materializada, monotônica e reconstruível, não a fonte append-only: o projetor aceita apenas o próximo `eventSequence` válido, ignora como no-op a reentrega já aplicada e mantém em espera/quarentena um evento futuro ou uma transição inválida. A decisão e a projeção podem ser consultadas sem alterar o journal.

A tabela mínima de transições permite `ENFORCEMENT_REQUIRED → COMPLETED` quando a coordenação não expõe uma fase intermediária, ou `ENFORCEMENT_REQUIRED → APPLIED → COMPLETED` quando há confirmação dos stores. `FAILED`/`UNKNOWN` não libera leitura e só pode ser sucedido por `RECONCILED` após reconciliação autorizada; daí a operação pode avançar para `APPLIED`/`COMPLETED` conforme a evidência. Não há retrocesso silencioso nem atualização de evento anterior.

O protocolo é obrigatório: (1) validar a operação, canonizar o payload completo, calcular `decisionDigest`/`decisionRecordDigest`, persistir ou recuperar a `LifecycleDecision` por `(operationId, decisionDigest)` e esperar seu `LifecycleDecisionDurableReceipt`; (2) alocar e persistir uma intenção de transição com `transitionEventId` estável e a referência/digest da decisão; (3) fazer append de `ENFORCEMENT_REQUIRED` com esse ID e só emitir `LifecycleDurableReceipt` após confirmar a decisão completa e o evento; (4) somente então, na transação ACID do domínio, registrar o tombstone/revogação, a referência ao evento e o outbox de propagação; (5) para cada avanço permitido pela tabela, criar um novo evento — `APPLIED` quando aplicável, `COMPLETED` após os stores obrigatórios ou um estado de falha —, esperar sua durabilidade e avançar a `LifecycleStateProjection`; (6) marcar `COMPLETED` somente após os stores obrigatórios confirmarem. Timeout no append ou na projeção deve consultar a decisão, o `decisionRecordRef`/digest e o `transitionEventId` original antes de qualquer nova tentativa. Se a situação continuar desconhecida, permanece `UNKNOWN`/bloqueada e não se cria uma segunda decisão nem um segundo efeito.

Para `REVOKE`/`RESTRICT`, o guard de leitura consulta também o journal corrente e trata `ENFORCEMENT_REQUIRED` como bloqueio; para `ERASE`, o bloqueio de leitura vem antes da remoção física. Se a durabilidade da decisão ou do evento não for confirmada, o sistema não responde conclusão, não limpa a pendência e mantém `DURABILITY_PENDING`/`UNKNOWN` para retry ou reconciliação. Se cair entre o registro da decisão, o journal e a transação local, o replayer encontra o evento durável, recupera `decisionRecordRef` fora do snapshot, verifica os digests e só então reaplica o comando; nenhuma decisão aceita fica dependente de uma lacuna silenciosa.

Cada backup registra no manifest um `journalWatermark` de checkpoint reconciliado — não apenas o maior número anexado — e o hash final da sequência de eventos incluída. O backup só pode avançar esse watermark depois de provar que os eventos até ele estão aplicados no domínio/stores exigidos ou marcados como parte do estado restaurável. A fonte corrente do journal e o armazenamento de decisões devem estar disponíveis fora do snapshot para recuperar todos os `LifecycleTransitionEvent` posteriores ao watermark e cada `LifecycleDecision` completa referenciada por `decisionRecordRef`, além das decisões cuja projeção anterior não esteja comprovadamente `COMPLETED` no snapshot; lacuna de sequência, hash inválido, referência ausente, digest divergente, fase pendente sem operação recuperável ou fonte indisponível mantém o restore em quarentena. Os eventos são reaplicados em ordem por `decisionId`/`eventSequence`, de forma idempotente, somente depois de validar e carregar a decisão completa, antes de liberar qualquer leitura, exportação ou sessão.

Estados: `REQUESTED → AUTHORIZED → DURABILITY_PENDING → ENFORCEMENT_PENDING → PROPAGATING → PARTIAL/COMPLETED`, com `HELD`, `FAILED` e `UNKNOWN` como estados explícitos. O coordinator lê o inventário de `DataRef`, confirma a decisão no journal independente, envia cada operação ao adapter do store, persiste receipts e repete somente operações idempotentes. Uma falha não libera a cópia restante; `PARTIAL`/`UNKNOWN` restringe nova leitura, alerta o owner e exige reconciliação. O provider não recebe solicitação de transferência se `ProviderTransferPolicy` estiver ausente; quando a retenção externa for desconhecida, o resultado é `DENIED` para o novo envio e `UNKNOWN` para a cópia já existente, até decisão contratual.

O mesmo comando gera manifest de exportação e marcação de expurgo para backup/replica; backup não é magicamente alterado, e a cópia só sai do escopo quando sua regra de expiração/tombstone for confirmada. Para `RESTRICT`, `ERASE`, `RECTIFY` e `REVOKE`, a decisão e cada evento de transição são confirmados no `LifecycleJournal` pelo protocolo de durabilidade acima e depois propagados aos stores. Para `EXPORT`, a confirmação durável é a `ExportAuthorization`/`ExportDurableReceipt`, seguida da tentativa de entrega própria; o restore recupera esse estado, mas não dispara envio. Assim, um restore consegue reaplicar decisões de enforcement posteriores ao snapshot sem confundir recuperação com novo efeito. Este contrato torna o lifecycle verificável sem inventar prazos legais; implementação e drill continuam `NOT_RUN`.

### Exportação e restauração

Um export inclui `exportId`, finalidade, requester, aprovação, filtro de escopo, classes, versões, hashes, destinatário, expiração e manifest de objetos. Restore nunca monta cópia diretamente em produção: cria ambiente isolado, aplica schema/migrations, restaura ACL e escopos, verifica vínculos, carrega o checkpoint reconciliado do manifest, recupera a sequência corrente de `LifecycleTransitionEvent` posterior ao watermark e as decisões anteriores não comprovadamente `COMPLETED`, valida hash/continuidade e a recuperação de cada `decisionRecordRef`, e reaplica de forma idempotente cada `RESTRICT`, `ERASE`, `RECTIFY` e `REVOKE` antes de qualquer leitura. Se o evento existir mas o armazenamento local da decisão tiver sido perdido, a decisão completa deve ser buscada no armazenamento independente; ausência ou digest divergente mantém o ambiente em quarentena. Também recupera `ExportAuthorization`, `ExportOperation` e `ExportDeliveryAttempt`; uma tentativa `UNKNOWN` fica para reconciliação e não é reenviada automaticamente. Em seguida reprocessa outbox de forma congelada, reconcilia ledger/auditoria/cache e só libera após revisão independente. Se o journal corrente ou o armazenamento de decisões não estiver disponível, houver lacuna ou existir operação pendente sem receipt/estado recuperável, o ambiente permanece em quarentena; não se aceita ressuscitar dado ou privilégio por falta de evidência. Estes mecanismos são `PROPOSED/NOT_RUN`.

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
5. Um restore valida, nesta ordem: versão do backup e `journalWatermark`, migrações, continuidade/hash do journal corrente, replay idempotente de exclusões/restrições/revogações, ACL/escopo, invariantes, referências de objetos/vetores, outbox/inbox congelados, ledger/auditoria e replay de sessão. Falha em qualquer etapa mantém o ambiente em quarentena e bloqueia leitura/exportação.
6. Para o DeepSeek Harness, a combinação `engineCommit + profileDigest + pluginDigests + SESSION_FORMAT_VERSION` é o identificador mínimo de replay. Como o motor está em `SESSION_FORMAT_VERSION=0` e pré-release, upgrade sem replay aprovado é `DENIED`.

O gate `VER-01` só poderá mudar de `NOT_RUN` após fixture de versões mistas, migração, restore e rollback ser executada no artifact exato. A fixture mínima deve criar um backup, aplicar depois dele uma exclusão, uma restrição e uma revogação, restaurar o snapshot e provar que nenhuma dessas três decisões foi perdida ou revertida. Também deve injetar crash antes do receipt durável, depois do receipt e antes da transação local, e depois da transação local; em todos os casos a operação precisa ser recuperável fora do snapshot ou permanecer bloqueada, sem conclusão falsa.

## 15. Proposta de contratos concretos para M1 local

**Estado:** contrato v1 aprovado para M1 local em DEC-M1-04; envelopes e schemas executáveis dos principais inputs existem no artifact, enquanto o catálogo completo de contratos de domínio e versões mistas ainda não. A política de sessão é canônica em 05, seção 14.

### Persistência e autoridade

Tabelas mínimas: `organizations`, `units`, `workspaces`, `users`, `credentials`, `sessions`, `role_assignments`, `authorization_state`, `audit_records`, `command_receipts` e `schema_migrations`. UUIDs identificam recursos; instantes são UTC em `timestamptz`. `organization_id` é a representação SQL de `organizationId`/limite tenant: não criar duas identidades independentes de tenant para o mesmo escopo.

Unidades e workspaces têm organização explícita; workspace de M1 pertence a uma unidade. Referências compostas garantem que usuário, vínculo, unidade e workspace não cruzem organizações. Vínculo tem papel de enum fechado e escopo tipado `ORGANIZATION`, `UNIT` ou `WORKSPACE`, com CHECK de campos obrigatórios/proibidos e unicidade que trate ausências como valor canônico conforme seção 6. Ausência de unidade/workspace não representa permissão global. Papel administrativo de organização vem do bootstrap; vínculos de trabalho são por unidade/workspace.

`authorization_state` tem uma linha por organização e revisão monotônica. Toda mutação protegida adquire lock dessa linha, revalida a sessão e a autorização atuais e executa mudança, incremento de revisão e auditoria na mesma transação/mesmo cliente `pg`. A revogação usa o mesmo lock: se ela confirmar primeiro, a mutação concorrente é negada; se a mutação confirmar primeiro, seu efeito precede a revogação. Locks têm ordem fixa antes dos locks de recurso. Leituras usam snapshot consistente para a decisão e dados; requisição iniciada após a confirmação da revogação não reutiliza autoridade antiga. Nenhuma promessa de desfazer bytes já entregues.

O lock serializa mutações dessa organização em M1: simplicidade deliberada, sem afirmação de performance de produção. Fundamentação: [locks PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html) e [transações em um mesmo cliente pg](https://node-postgres.com/features/transactions).

### Superfície HTTP v1

Prefixo `/api/v1`; sucesso `{ data, correlationId }`; erro `{ error: { code, message }, correlationId }`. IDs, enum, limites e campos desconhecidos são validados no servidor; campos de autoridade derivados não são aceitos do cliente.

| Método e rota | Entrada / resultado | Regra |
|---|---|---|
| POST `/auth/login` | `login`, `password`; identidade mínima e cookie | Política de 05; sem organização escolhida pelo cliente. |
| POST `/auth/logout` | Sem corpo; confirmação | Revoga sessão; repetir não reativa nada. |
| GET `/me` | Identidade, escopos autorizados, revisão e token CSRF | Não publica hashes/segredos; sessão válida. |
| GET `/contexts` | Unidades/workspaces permitidos | Filtro de escopo server-side. |
| GET `/context` | Seletores `unitId`, `workspaceId`; contexto resolvido | Seleção explícita por requisição evita troca silenciosa entre abas; servidor valida vínculo e hierarquia. |
| GET `/users` | Cursor e limite 1–100; usuários mínimos | Administrador, própria organização. |
| POST `/role-assignments` | `userId`, papel, escopo e IDs aplicáveis | Administrador concede somente papéis/escopos previstos em 05. |
| DELETE `/role-assignments/:id` | ID e chave idempotente | Mesmo limite; sem excluir auditoria ou histórico do vínculo. |
| GET `/audit` | Cursor e limite 1–100; metadados redigidos | Administrador; leitura auditada antes de liberação. |
| GET `/health` | Estado técnico mínimo | Público, sem versões, configuração ou dependências detalhadas. |

Códigos HTTP: `400` input inválido, `401` sessão ausente/inválida, `403` ação vedada, `404` recurso inexistente ou fora do escopo com mesma resposta, `409` conflito de versão/digest, `429` limite, `503` dependência/auditoria indisponível. Mapear aos códigos estáveis da seção 11, sem reutilizar `403` para revelar existência de alvo alheio.

Mutações de vínculos exigem `Idempotency-Key` e revisão esperada; seguem lookup, autorização atual para ler receipt, digest e chave canônica da seção 6. Receipt bem-sucedido devolve resultado original antes de rejeitar revisão antiga por retry; novo comando com revisão obsoleta gera conflito. Claim, efeito interno e resultado durável são atômicos; nenhuma chamada externa nessa transação. Crash antes de commit não confirma efeito. Ações administrativas não consomem orçamento/provider de IA; autorização e auditoria universais continuam obrigatórias.

### Restauração sem reativar autoridade antiga

Backup local é somente fixture sintética. Restauração entra em quarentena, invalida todas as sessões e bloqueia login/leituras até satisfazer o contrato de journal independente das seções 13–14. Invalidação de sessão sozinha não resolve vínculos antigos: novo login também permanece bloqueado sem reconciliação. Ausência de receipt durável ou journal corrente é caso negativo, não restore aprovado. M1 local pode demonstrar esse bloqueio; restore operacional bem-sucedido e `VER-01` continuam pendentes das provas completas.

### Implementação administrativa B4

As rotas de B4 estão implementadas para M1 local sintético. `GET /users` e `GET /audit` aceitam `cursor` UUID e `limit` entre 1 e 100 (padrão 25), devolvendo `data.items`, `data.nextCursor` e `data.revision`. A paginação usa UUID ascendente; não representa snapshot imutável entre requisições nem ordenação cronológica da auditoria. Cada leitura administrativa é auditada antes da liberação. Usuários incluem vínculos ativos minimizados para viabilizar a administração em B5; nunca incluem credenciais.

`POST /role-assignments` recebe `userId`, `role` (`recepcao` ou `veterinario`), `scopeType` (`UNIT` ou `WORKSPACE`), `unitId`, `workspaceId` quando aplicável e `expectedRevision`. `DELETE /role-assignments/:id` recebe `expectedRevision`. Revisões são strings decimais de até 18 dígitos, evitando perda de precisão no JavaScript. Ambas exigem JSON, origem permitida, `X-CSRF-Token` e `Idempotency-Key` de 1–128 caracteres.

A porta `cvg_admin_command` deriva ator e organização da sessão persistida, bloqueia a linha `authorization_state`, revalida sessão/alçada e executa alteração, revisão, auditoria e receipt em uma transação. Runtime recebe EXECUTE nessa porta, sem escrita direta em vínculos/revisão/receipts. `cvg_admin_read` aplica sessão/alçada/escopo e auditoria para leitura; helper de auditoria não é executável pelo runtime/PUBLIC. Funções SECURITY DEFINER têm SQL estático e search_path fixo; sua manutenção exige revisar o corpo e os grants, pois executam com autoridade do proprietário local.

A chave de lookup é SHA-256 da tupla JSONB versionada contendo organização, ator, operação, chave do cliente, recurso, unidade e workspace. JSON null representa ausência tipada, distinta de qualquer UUID; para revogação, o recurso é o ID imutável do vínculo e unidade/workspace ficam ausentes. O digest do corpo inclui a revisão esperada. Retry conserva chave e corpo originais: devolve o mesmo `assignmentId`, revisão, auditId e IDs originais, mesmo após a revisão avançar. Novo corpo com a mesma chave/escopo gera `IDEMPOTENCY_CONFLICT`; nova intenção usa nova chave e revisão atual. Leitura de receipt exige alçada atual e gera auditoria própria, sem repetir efeito ou incrementar revisão.

Novo comando com revisão obsoleta gera `REVISION_CONFLICT`; vínculo ativo duplicado gera `ASSIGNMENT_EXISTS`; revogação já concluída sob chave diferente gera `ALREADY_REVOKED`. Recurso estrangeiro e inexistente recebem o mesmo `NOT_FOUND`. Nenhuma operação altera administradores/operadores ou os próprios vínculos. DELETE preserva o histórico por `revoked_at`.

Timeout, falha de auditoria ou de receipt antes do commit desfazem a transação. Se a resposta for perdida após commit, repetir o comando original com autorização atual recupera seu resultado; não fabricar outra chave como tratamento automático de erro. A função de leitura não é mecanismo de exportação. Evidências e limites estão no checkpoint B4 de 07.
