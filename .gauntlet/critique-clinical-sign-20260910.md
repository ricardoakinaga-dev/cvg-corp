# Gauntlet — crítica fresh de `clinical.sign`

Data: 2026-09-10  
Agente: Nash (`01a08b07-45c3-7863-aea2-c58fc7519ed2`)  
Contexto: não herdado, somente leitura, sem autoridade de edição  
Sentinel: nenhuma mutação atribuível ao crítico

## Parecer selado

O crítico confirmou, no caminho estático, sessão/CSRF/contexto/
`Idempotency-Key`, PDP na rota e no serviço, role de veterinário, validação de
`expectedVersion`, transição `version N -> N+1`, `signedAt`/`signedBy`, CAS SQL,
rollback e exclusão do documento-alvo no replay. O status foi revisão com
achados; não foi aprovação de produção nem declaração AAA.

Achados originais:

- **HIGH:** o receipt era somente memória-local até o `onSend`, não garantindo
  admissão idempotente entre instâncias;
- **MEDIUM:** o domínio não conferia explicitamente organização e paciente do
  encounter associado ao documento;
- **MEDIUM:** o serviço retornava antes da persistência final, cuja fronteira
  estava no hook de request;
- **LOW:** replay não produzia auditoria explícita.

## Reparos após a crítica

- `PostgresPersistence.claimCommandReceipt` agora faz `INSERT ... ON CONFLICT
  (idempotency_lookup) DO NOTHING` em transação própria. A linha `IN_FLIGHT`
  é confirmada antes da mutação; concorrentes recebem `IN_FLIGHT`, `REPLAY`,
  `FAILED` ou conflito de digest, em vez de executar uma segunda intenção.
- `settleCommandReceipt` grava `FAILED`/`OUTCOME_UNKNOWN` duravelmente quando a
  execução falha antes do commit autoritativo; falha no settlement também
  bloqueia a operação, sem inferir sucesso.
- O domínio agora exige `encounter.organizationId === context.organizationId`
  e `encounter.patientId === document.patientId`.
- O replay produz audit record marcado `idempotency replay`, sem alterar o
  `auditRecordId` original do receipt.
- A fronteira final de snapshot/journal/auditoria/receipt/linha clínica segue
  no commit de request; isso permanece uma limitação arquitetural explícita,
  não uma aprovação isolada do application service.

## Reteste

- testes focados API/persistência/domínio: **64/64 pass**;
- `npm test`: **147 testes; 146 pass, 1 skip**;
- `npm run test:e2e`: **64 pass, 4 skips intencionais**;
- typecheck, lint (127 fontes), build, static (51 artefatos/129 fontes), PDP,
  produção estrutural e `git diff --check`: **pass**;
- `verify:triplo-aaa`: **AAA_NOT_PROVEN**, exit 2;
- `verify:staging`: **STAGING_EVIDENCE_INCOMPLETE**, exit 2, sem request;
- `verify:deepseek-acp`: **BLOCKED**, exit 2, sem configuração/atestado
  completo.

## Limites remanescentes

Não foram executados PostgreSQL concorrente real, replay após restart em banco
real, RLS cross-tenant, staging, provider/DeepSeek real, autoridade de
segredos, Collector/SLO operacional, carga/chaos/recovery production-like,
WebKit/assistive-tech/zoom real ou aceite humano. O veredito global permanece
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
