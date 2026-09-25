# Runbook — incidente clínico e administrativo

**Estado:** procedimento `PROPOSED`; protocolo de comunicação ao tutor, autoridade clínica e prazos internos dependem de decisão humana (`BLOCKED_HUMAN`). Exercício real `NOT_RUN`.  
**Owner:** clínica (veterinário responsável) + operações. **Abortar se:** a identidade do paciente/atendimento não puder ser confirmada, ou se a correção proposta exigir editar/apagar registro assinado, auditoria ou ledger.

Objetivo: conter e corrigir erro clínico ou administrativo — medicação duplicada, atendimento/cobrança no paciente errado, cobrança indevida — preservando o registro, identificando todos os afetados pela trilha de auditoria e registrando a correção por um caminho auditável.

**Princípio fixo (ADR 012):** o domínio transacional é a fonte de verdade clínica, financeira e de autorização. A IA pode resumir, sugerir e criar rascunho governado; ela **nunca** é fonte de verdade e nunca escreve diretamente no banco, assina prontuário, libera medicação, cobra ou envia comunicação ([ADR 012](../adr/012-ai-source-of-truth.md)). Conteúdo gerado por IA (`ai_drafts`, turnos, digests) é evidência de contexto, não substitui o fato transacional.

## 1. Severidade e gatilhos

| Caso | Sinais | Severidade inicial |
| --- | --- | --- |
| Medicação duplicada / dose errada | ocorrência `ADMINISTERED` repetida, dispensação a mais, alerta de cuidador | alta se houve administração; média se só houve dispensa |
| Paciente errado | documento em `encounter`/`patient` errado, exame ou cobrança vinculados ao animal errado | alta — envolve prontuário e possível conduta |
| Cobrança indevida | cobrança sem serviço, valor errado, pagamento/estorno em paciente errado | média; alta se houver impacto financeiro relevante ou dado exposto |
| Documento clínico incorreto | evolução/laudo/prescrição com erro após assinatura | alta quando orienta conduta |
| Outros (internação, diagnóstico, estoque) | lote/quantidade, vínculo de amostra, alta com pendência | avaliar por impacto clínico |

## 2. Contenção imediata

1. Interromper a fonte do erro sem apagar histórico. Para prescrição, o caminho suportado é suspender: `POST /api/v1/medications/orders/:id/status` com `{"status":"SUSPENDED"}` (`apps/api/src/app.ts:1857`). O schema aceita apenas `ACTIVE`, `SUSPENDED` e `COMPLETED` (`apps/api/src/app.ts:1031`); após suspensa, a dispensa é recusada porque exige `order.status === "ACTIVE"` (`packages/domain/src/index.ts:1657`). `COMPLETED` é terminal (`packages/domain/src/index.ts:1697`).
2. Não executar nem reenviar administração/dispensa para “corrigir”: qualquer repetição precisa de decisão do veterinário responsável e registro.
3. Isolar o atendimento/paciente: não iniciar novos atos clínicos sobre o registro errado além do necessário para contenção; marcar o caso no dossiê do incidente (ID opaco, sem dados clínicos em canais abertos).
4. Se houver comunicação externa pendente/duplicada, bloquear novo envio e tratar efeitos ambíguos como `OUTCOME_UNKNOWN` ([worker-backlog](worker-backlog.md)); não repetir cegamente ([provider-outage](provider-outage.md)).
5. Se houver suspeita de exposição de dados pessoais, abrir também [lgpd-data-subject-incident](lgpd-data-subject-incident.md).

## 3. Identificar pacientes e atos afetados (trilha de auditoria)

1. Ler a auditoria sem alterá-la: `GET /api/v1/audit` (`apps/api/src/app.ts:1315`), paginando com `limit` (máximo 100) e `cursor`. Cada `AuditRecord` traz `actorId`, `action`, `resourceType`, `resourceId`, `result`, `reason`, `correlationId`, `createdAt` e a cadeia `previousHash`/`recordHash` (`packages/contracts/src/index.ts:655`).
2. Ações relevantes já emitidas pelo domínio: `medication.prescribe`, `medication.dispense`, `medication.administer`, `medication.update`, `clinical.sign`, `clinical.addendum`, `finance.charge`, `finance.payment`, `finance.refund`, `patients.disable`, `patients.merge` (rotas em `apps/api/src/app.ts`; encadeamento em `docs/runbooks/session-stuck.md` para IA).
3. Para medicação, listar o histórico do paciente: `GET /api/v1/medications/orders`, `GET /api/v1/medications/dispensations`, `GET /api/v1/medications/administrations` (`apps/api/src/app.ts:1806,1792,1799`). Cada ocorrência guarda `medicationOrderId`, `administeredBy`, `administeredAt`, `status` e `note` (`packages/domain/src/index.ts:1664`).
4. Para paciente errado, conferir vínculos em `GET /api/v1/patients/:id`, `GET /api/v1/clinical/documents/:id`, `GET /api/v1/diagnostics/results`, `GET /api/v1/finance/ledger` (`apps/api/src/app.ts:1358,1575,1691,1915`).
5. Para cobrança, reconstruir `GET /api/v1/finance/charges` e `GET /api/v1/finance/payments` (`apps/api/src/app.ts:1880,1908`) e cruzar com o ledger — o ledger é append-only; não se corrige apagando lançamento.
6. Validar a cadeia de auditoria: `npm run verify:audit-chain`. Se a cadeia não validar, tratar como incidente de segurança e parar a correção até preservar a prova.

## 4. Comunicação ao profissional responsável

1. A autoria é explícita no registro: `ClinicalDocument.authorId`, `MedicationOrder.prescribedBy`, `Dispensation.dispensedBy`, `AdministrationOccurrence.administeredBy` (`packages/domain/src/index.ts:1494,1643,1659,1673`).
2. Somente `veterinario` pode prescrever, administrar/registrar ocorrência e assinar/emendar documento (`packages/domain/src/index.ts:1638,1665,1500,1524`). O responsável clínico precisa avaliar o paciente e decidir a conduta antes de qualquer correção de conteúdo.
3. Comunicar o profissional responsável com: janela, paciente/atendimento, ato afetado, evidência e o que já foi contido. Não incluir dado clínico desnecessário na mensagem; usar o canal aprovado.
4. Registro de comunicação e decisão do profissional entram no dossiê do incidente (quem, quando, o quê). O dossiê não substitui o registro no prontuário.

## 5. Correção e registro

### 5.1 Prontuário/documento clínico

- Documento assinado **não** é sobrescrito: `updateClinicalDraft` recusa documento fora de `DRAFT`/`REVIEW` com a mensagem “Documento assinado não é sobrescrito; use adendo” (`packages/domain/src/index.ts:1462`).
- A correção é um adendo auditável: `POST /api/v1/clinical/documents/:id/addenda` (`apps/api/src/app.ts:1563`) com `reason` e conteúdo. O domínio só aceita adendo para documento `SIGNED` (`packages/domain/src/index.ts:1523`).
- Documento em rascunho pode ser corrigido por `POST /api/v1/clinical/documents/:id/update` (`apps/api/src/app.ts:1585`) com `expectedVersion`; a revisão volta a `DRAFT` e incrementa versão.

### 5.2 Medicação duplicada

- Existe proteção anti-duplo-envio de 60 segundos para `ADMINISTERED` na mesma prescrição (`packages/domain/src/index.ts:1670`). Fora dessa janela a duplicata é aceita pelo domínio: a correção depende de avaliação clínica e registro — não de apagar a ocorrência.
- Registrar a avaliação do veterinário e a conduta (monitoramento, antídoto, observação) como adendo/evolução do atendimento.
- Suspender a prescrição quando a continuidade for indevida (`SUSPENDED`) e não reabrir `COMPLETED`.
- O que já foi administrado não se “desfaz” por API: registrar o ocorrido e o plano de acompanhamento.

### 5.3 Cobrança indevida

- Correção financeira é por estorno rastreável: `POST /api/v1/finance/refunds` (`apps/api/src/app.ts:1922`) com `reason`; o domínio marca pagamento/cobrança como `REFUNDED` e grava lançamento compensatório `kind: "REFUND"` no ledger (`packages/domain/src/index.ts:1823`).
- O ledger é append-only: proibido editar ou apagar cobrança/pagamento/lançamento. Ajuste por novo lançamento é o mecanismo.
- Registrar no dossiê: cobrança original, valor, motivo, autorização e recibo do estorno.

### 5.4 Paciente/atendimento errado

- Não mover o registro por edição direta no banco. Corrigir pelo fluxo suportado do domínio (novo documento/prescrição no atendimento correto; desabilitar vínculos indevidos) e registrar a explicação.
- `POST /api/v1/patients/merge` (`apps/api/src/app.ts:1393`) preserva histórico e exige confirmação humana explícita (`reason` do domínio registra “confirmação humana explícita; histórico preservado”); usar somente com decisão registrada.

## 6. Evidências

- `AuditRecord` da janela do incidente (`apps/api/src/app.ts:1315`) e recibo de `npm run verify:audit-chain`;
- IDs opacos de paciente/atendimento/prescrição/dispensação/administração/documento/cobrança/pagamento;
- status, digests e `correlationId` das operações envolvidas;
- adendo assinado com `reason`, autor e horário;
- estorno com `reason`, recibo e lançamento compensatório;
- registro da decisão do profissional responsável e da comunicação;
- quando houver IA no fluxo, `ai.turn` de auditoria (`apps/api/src/app.ts:2018`), `input_digest`/`context_digest` do turno e o rascunho/caso de uso — lembrando que o turno é evidência, não verdade clínica.

## Critérios de encerramento

- [ ] fonte do erro interrompida pelo caminho suportado (suspender, estornar, bloquear envio);
- [ ] nenhum registro assinado, lançamento de ledger ou trilha de auditoria editado/apagado;
- [ ] todos os pacientes/atendimentos afetados identificados por auditoria, com ID opaco no dossiê;
- [ ] veterinário responsável avaliou o paciente e registrou a conduta;
- [ ] correção registrada por adendo/estorno/novo ato, com autor, horário e motivo;
- [ ] cobrança ajustada com lançamento compensatório reconciliado;
- [ ] causa raiz classificada (processo, UI, dado, integração ou uso de IA) e ação preventiva com owner;
- [ ] dossiê revisado pelo owner clínico e pelo owner de operações.

## Aprovações pendentes (PROPOSED/UNKNOWN)

- protocolo de comunicação ao tutor e prazo de ciência (não definido no repositório);
- matriz de gravidade e alçada de decisão clínica por tipo de incidente;
- fluxo formal de notificação a conselho/seguro, se aplicável;
- política de retenção/revisão dos dossiês de incidente clínico.

## O que NÃO fazer

- Nunca usar a saída da IA como fonte de verdade, prova de conduta ou substituto do registro transacional ([ADR 012](../adr/012-ai-source-of-truth.md)).
- Nunca editar ou apagar documento clínico assinado: use adendo (`packages/domain/src/index.ts:1462,1523`).
- Nunca apagar ocorrência de administração, dispensa, cobrança, pagamento, lançamento de ledger ou registro de auditoria para “corrigir”.
- Nunca reenviar/dose duplicada “para compensar”, nem repetir efeito `OUTCOME_UNKNOWN`.
- Nunca promover rascunho de IA, assinar, liberar medicação ou cobrar com base apenas na sugestão do modelo.
- Nunca registrar dado clínico/pessoal em ticket, chat ou log não redigido.
- Nunca fechar o caso sem registrar a decisão do profissional responsável.
