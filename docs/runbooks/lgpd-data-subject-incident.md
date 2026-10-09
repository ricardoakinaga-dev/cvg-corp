# Runbook — incidente com dados pessoais / titular (LGPD)

**Estado:** procedimento `PROPOSED`; canal de comunicação, prazos, base legal e papel de DPO dependem de decisão humana (`BLOCKED_HUMAN`). Exercício real `NOT_RUN`.  
**Owner:** privacidade/DPO (papel a designar — `PROPOSED`) + segurança/ops. **Abortar se:** o escopo de titulares e classes de dados ainda for desconhecido, ou se a evidência de auditoria não estiver preservada.

Objetivo: conter uma exposição ou uso indevido de dados pessoais (tutor, contato, consentimento, dado clínico vinculável, financeiro), preservar a cadeia de custódia, identificar os titulares afetados pela trilha de auditoria e decidir, com autoridade humana, se há dever de comunicação à ANPD e/ou ao titular.

O repositório declara explicitamente que retenção, finalidade, consentimento, compartilhamento e descarte ainda precisam de validação formal do responsável ([segurança e privacidade](../05-seguranca-privacidade.md)) e que ninguém deve apresentar “LGPD compliant” como fato antes de base, controles e evidência. Este runbook não cria política de privacidade: ele operacionaliza a resposta e marca cada lacuna.

## 1. Classes de dados e gatilhos

| Classe | Exemplos no CVG | Gatilho típico de incidente |
| --- | --- | --- |
| D2 pessoal | identidade do tutor, contatos, consentimentos (`Guardian`) | export indevido, log com telefone/e-mail, mensagem para destinatário errado |
| D2 financeiro | ledger, pagamento, orçamento, refund | extrato/cobrança expostos ao paciente ou tutor errado |
| D3 clínico/relacional | prontuário, prescrição, diagnóstico, internação | acesso fora de escopo, documento em contexto de IA exposto, paciente errado |
| D4 segredo | tokens, chaves, contas integradas | vazamento de credencial que dá acesso a dados pessoais |
| D5 controle | auditoria, policy, bundle | adulteração/indisponibilidade que impede investigação |
| D2–D5 | backup e artefatos de restore | cópia restaurada/exportada sem ACL ou escopo |

Gatilhos de abertura: finding `SECRET_MATERIAL` ou exposição de contexto tratada em [prompt-injection-incident](prompt-injection-incident.md); export governado com escopo errado ou destinatário incorreto no canal de comunicação `POST /api/v1/communications` (`apps/api/src/app.ts:1940`); vazamento de credencial com acesso a dados pessoais ([credential-rotation](credential-rotation.md)); restore que reative dados/roles revogados ([restore](restore.md)); incidente de segurança sem escopo conhecido ([security-incident](security-incident.md)).

## 2. Contenção (sem apagar evidência)

1. Parar a superfície sem destruir estado: `docker compose --env-file "$CVG_ENV_FILE" stop worker api proxy` (mesmo padrão de [rollback](rollback.md)). Não use `down -v`, não remova volume, não altere registros para “limpar” o incidente.
2. Quarentenar o documento de conhecimento envolvido: `POST /api/v1/knowledge/:id/quarantine` (`apps/api/src/app.ts:2103`) — a origem fica fora da seleção até revisão humana ([quarantine](quarantine.md)).
3. Encerrar acessos potencialmente comprometidos: `POST /api/v1/auth/password/rotate` revoga todas as sessões antigas e cria uma nova ([credential-rotation](credential-rotation.md)); revogar atribuições em `DELETE /api/v1/role-assignments/:id` (`apps/api/src/app.ts:1300`).
4. Restringir o recurso/quando o titular pede cessação de tratamento: `POST /api/v1/patients/:id/disable` (`apps/api/src/app.ts:1382`) preserva o registro e altera apenas o status — não há exclusão destrutiva suportada. A decisão de restrição também existe no restore como `RESTRICT_PATIENT` (`packages/persistence/src/recovery-reconciliation.ts:43`).
5. Reduzir a superfície de IA se o vetor for contexto: `CVG_AI_SAFE_MODE=true` e `CVG_AI_DISABLED_TOOLS`; incidente recorrente usa `CVG_AGENT_RUNTIME=disabled` (`docs/runbooks/prompt-injection-incident.md`).
6. Bloquear efeitos externos ambíguos: nenhuma comunicação nova, nenhum retry cego de `OUTCOME_UNKNOWN` ([worker-backlog](worker-backlog.md)).

## 3. Preservação e cadeia de custódia

1. Registrar horário, `correlationId`, `auditId`, ator, organização, recurso e origem do achado; nunca copiar o dado pessoal em si para tickets ou chat.
2. Ler a trilha sem alterá-la: `GET /api/v1/audit` (`apps/api/src/app.ts:1315`), paginando com `limit` (máximo 100) e `cursor`. O `AuditRecord` carrega `actorId`, `resourceType`, `resourceId`, `action`, `result`, `reason`, `correlationId`, `metadata`, `previousHash`, `recordHash` e `createdAt` (`packages/contracts/src/index.ts:655`).
3. Validar a cadeia: `npm run verify:audit-chain` (rejeita adulteração). A auditoria é append-only; `UPDATE`/`DELETE` não é caminho suportado.
4. Capturar logs redigidos para arquivo protegido, com `umask` restrito e digest, no padrão de [backup-incidente](backup-incidente.md). A redaction de `packages/ops` remove `prompt`, `content`, `payload`, `body`, URL/URI, credenciais e tokens ([observability-logs](observability-logs.md)).
5. Se for necessária uma cópia sob custódia, usar o export governado: `POST /api/v1/ops/export` (`apps/api/src/app.ts:2338`) com `purpose` em `LEGAL_HOLD` ou `AUDIT_REVIEW` (`packages/contracts/src/index.ts:348`), `ttlSeconds` entre 60 e 86.400 (`packages/contracts/src/index.ts:356`) e `Idempotency-Key`. O export é por organização e cifrado; destino e chave fora do repositório.
6. Registrar quem copiou, quando, para onde e com qual propósito; guardar o digest do artefato. Não liberar a cópia para leitura ampla.

## 4. Identificar titulares e escopo afetado

1. Delimitar janela temporal, organização, unidade/workspace, ator e tipo de recurso antes de varrer.
2. Varrer `GET /api/v1/audit` por `action` e `resourceType` (ex.: `guardians.*`, `patients.*`, `clinical.*`, `finance.*`, `communication.*`, `ops.export`, `knowledge.*`, `ai.turn`) e reconstruir os `resourceId` tocados.
3. Para exposição de mensagem, conferir `GET /api/v1/communications` (`apps/api/src/app.ts:1933`) e o ledger de efeitos; para financeiro, `GET /api/v1/finance/ledger` (`apps/api/src/app.ts:1915`).
4. Para dados que possam estar em cópias, cruzar com restore/export: decisões pós-watermark como `RESTRICT_PATIENT`, `REVOKE_SESSION`, `REVOKE_ROLE` e `QUARANTINE_DOCUMENT` precisam ser reaplicadas antes de qualquer liberação ([restore](restore.md)).
5. Classificar cada titular afetado por: dado exposto, sensibilidade, volume, possibilidade de inferência e reversibilidade. Registrar a lista de forma pseudonimizada no dossiê (ID opaco do recurso + digest), mantendo os identificadores apenas no ambiente autorizado.

## 5. Avaliação de notificação (PROPOSED — decisão humana)

Não existe política de notificação no repositório; os campos abaixo são `PROPOSED` e exigem jurídico + DPO + owner.

| Campo | Estado | Observação |
| --- | --- | --- |
| Prazo interno de triagem/contensão | `PROPOSED` | Definir SLA por severidade com o DPO |
| Prazo regulatório (ANPD) e prazo ao titular | `PROPOSED/UNKNOWN` | Confirmar na LGPD e em norma vigente com o jurídico; não inventar valor |
| Canal oficial de comunicação ao titular | `PROPOSED` | Definir canal aprovado, sem usar dados de contato do incidente como atalho |
| Conteúdo mínimo da comunicação | `PROPOSED` | Descrição, dados envolvidos, riscos, medidas, contato do encarregado |
| Critério de “risco relevante” | `PROPOSED` | Combinar sensibilidade (D3 clínico, D4 segredo), volume e reidentificabilidade |
| Registro da decisão de não notificar | `PROPOSED` | Justificativa, autoridade, data e revisão |

1. A classificação de severidade é registrada antes da decisão: dado pessoal simples (D2) × clínico (D3) × credencial (D4) × cópia em backup.
2. Se houver credencial exposta com acesso a dados pessoais, tratar primeiro como incidente de segurança e rotacionar por referência ([credential-rotation](credential-rotation.md)); a avaliação de notificação usa o escopo já contido.
3. A decisão (notificar, não notificar com justificativa, ou escalar) é registrada com autoridade, horário e evidência — o runbook não substitui o DPO nem o jurídico.
4. Comunicação externa só pelos canais aprovados e com conteúdo redigido; nenhum payload do incidente sai em claro.

## 6. Papéis

| Papel | Responsabilidade | Estado |
| --- | --- | --- |
| DPO/encarregado | decide e registra a avaliação de notificação; ponto de contato regulatório | `PROPOSED` — papel a designar |
| Owner de segurança | contenção técnica, cadeia de custódia, rotação | definido por [security-incident](security-incident.md) |
| Jurídico/compliance | prazo e forma da comunicação à ANPD/titular | `BLOCKED_HUMAN` |
| Operações/dados | export sob custódia, restore isolado, retenção | definido em [backup](backup.md) e [restore](restore.md) |
| Owner clínico | avalia impacto clínico e comunicação ao profissional | [clinical-incident](clinical-incident.md) |

## Evidência

- janela, `correlationId`, `auditId` e ator de cada evento examinado;
- `AuditRecord` da linha do tempo (`packages/contracts/src/index.ts:655`) e recibo de `npm run verify:audit-chain`;
- saída redigida de logs e o digest do arquivo capturado;
- export governado (purpose, TTL, `purposeDigest`, `payloadDigest`, `exportDigest`) quando houver custódia (`apps/api/src/app.ts:2338`);
- decisões de contenção (`quarantine`, `rotate`, `disable`, `RESTRICT_PATIENT`) com recibo/idempotency key;
- lista pseudonimizada de titulares/recursos afetados e a classificação de risco;
- decisão de notificação com autoridade, horário, justificativa e versão do texto comunicado.

## Critérios de encerramento

- [ ] superfície contida e nenhum efeito externo novo derivado do incidente;
- [ ] cadeia de auditoria validada e evidência copiada para custódia com digest;
- [ ] titulares e recursos afetados delimitados por trilha de auditoria, não por suposição;
- [ ] origem corrigida ou em quarentena e revisão humana registrada;
- [ ] decisão de notificação (ou de não notificação justificada) assinada pelo DPO/jurídico;
- [ ] medidas corretivas com owner, prazo e teste de regressão quando aplicável;
- [ ] dossiê fechado e lições registradas; nenhum dado pessoal residual em chat, ticket ou log.

## Aprovações pendentes (PROPOSED/UNKNOWN)

- designar DPO/encarregado e definir alçada de decisão;
- definir canal oficial, prazos internos e modelo de comunicação;
- definir política de retenção, expurgo e atendimento a requisição de titular (hoje inexistente no produto);
- definir base legal e finalidade por classe de dado ([segurança e privacidade](../05-seguranca-privacidade.md));
- decidir o destino de cópias de backup/export durante e depois do incidente.

## O que NÃO fazer

- Nunca apagar, editar ou “limpar” audit ledger, `ai_turns`, ledger financeiro ou documento clínico para reduzir o escopo.
- Nunca copiar dado pessoal (telefone, e-mail, prontuário, exame) para ticket, chat, e-mail comum ou nome de arquivo.
- Nunca notificar titular ou ANPD por iniciativa técnica sem autoridade jurídica/DPO — e nunca omitir a decisão.
- Nunca usar os contatos obtidos no próprio incidente como canal de comunicação.
- Nunca prometer exclusão definitiva quando o dado estiver em backup/export não reconciliado: registrar `UNKNOWN` e tratar como pendência.
- Nunca tratar restore/export como concluídos sem reaplicar as decisões registradas depois do watermark ([restore](restore.md)).
- Nunca declarar conformidade LGPD por causa deste runbook; ele é resposta operacional, não certificação.
