# Verificação — assinatura clínica normalizada autoritativa

Data: 2026-09-10  
Escopo: `CVG-FULL-STATE-OF-THE-ART:AUTHORITATIVE-NORMALIZED-CLINICAL-SIGN`

## Contrato implementado

`POST /api/v1/clinical/documents/:id/sign` agora exige sessão, CSRF,
`Idempotency-Key` e `expectedVersion`. A rota atravessa
`ClinicalSignApplicationService` e um `ClinicalSignRepository` assíncrono.
O domínio valida o token de versão, impede nova assinatura de documento
`SIGNED`/`PUBLISHED` e aplica a transição `version N -> N+1`, preservando
`signedAt` e `signedBy` produzidos pelo ator autenticado.

Em PostgreSQL, a primeira execução passa o documento assinado como
`normalizedClinicalSignWrite` para o mesmo commit durável de snapshot,
journal, auditoria, receipt e outbox. A persistência executa um `UPDATE`
contextual com `RETURNING`, exigindo organização, unidade, workspace,
encounter, paciente, autor, conteúdo, estado draft/review, assinatura nula,
`version = versão nova - 1` e `created_at` idênticos. Zero linhas é corrupção
e falha fechado; não há inserção silenciosa de uma assinatura.

O documento command-owned é removido da projeção clínica genérica. No replay
da mesma chave, o receipt é devolvido sem executar o domínio; a sessão pode
ter seu `last_seen_at` persistido, mas o documento já assinado é excluído da
projeção genérica para não repetir DML clínico.

Após a crítica fresh, a chave de idempotência passou a ser admitida também na
autoridade PostgreSQL antes da mutação: `claimCommandReceipt` usa a restrição
única de `idempotency_lookup` e grava `IN_FLIGHT` em uma transação própria.
Concorrentes recebem estado durável (`IN_FLIGHT`, `REPLAY`, `FAILED` ou
conflito de digest) e não executam uma segunda intenção. Falhas antes do
commit são assentadas por `settleCommandReceipt`; falha nesse assentamento
mantém a operação bloqueada. O domínio também valida organização e paciente
do encounter associado. Replay gera auditoria explícita sem substituir o
`auditRecordId` original.

## Evidência local observada

- Testes focados de API, persistência e domínio: **64/64 pass**.
- `npm test`: **147 testes; 146 pass, 1 skip**.
- `npm run test:e2e`: **64 pass, 4 skips intencionais** para quick-open em
  viewport estreito, nos projetos Chromium/Firefox e stress.
- `npm run typecheck`: pass.
- `npm run build`: pass; bundle web produzido.
- `npm run lint`: pass, 127 fontes.
- `npm run verify:static`: pass, 51 artefatos/129 fontes.
- `npm run verify:pdp`: pass, 68 operações, 70 regras, 6 policies e 12
  domínios críticos.
- `npm run verify:production`: pass estrutural; nenhum serviço foi iniciado.
- `git diff --check`: pass.

Os testes de persistência usam pool sintético. Eles comprovam o contrato de
chamada, o `UPDATE` contextual, CAS, replay sem segundo DML e falha fechada,
mas não substituem PostgreSQL concorrente/RLS em ambiente real, staging,
carga ou recovery production-like.

## Crítica independente

O crítico fresh Nash (`01a08b07-45c3-7863-aea2-c58fc7519ed2`) concluiu uma
revisão estática somente leitura e selou achados HIGH/MEDIUM/LOW, sem editar o
workspace e sem declarar aprovação. O HIGH de idempotência foi reparado com
claim durável antes da mutação; a lacuna de integridade do encounter e a
auditoria de replay também foram corrigidas. A fronteira do commit final no
hook da requisição permanece uma limitação arquitetural explicitamente
registrada em `.gauntlet/critique-clinical-sign-20260910.md`.

## Observação remota relacionada

O commit integrado anterior `702d71f5e8137b324abd2d0d6a06760c7cf19375` teve
o run GitHub Actions `34468216169` concluído com `success`; o job principal
`102841721729` e o job de imagens `102843388525` passaram. Essa observação é
do SHA anterior à assinatura clínica e não substitui staging, provider,
DeepSeek, autoridade de segredos, observabilidade operacional, carga,
recovery ou aceite humano.

## Limitações e veredito

Esta fatia local é `PASS_WITH_LIMITATIONS` após o reteste; a publicação e o
CI do novo SHA ainda precisam ser observados. O programa global continua
`FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`. Provider externo, turno DeepSeek
real, autoridade de segredos, staging/TLS operacional, Collector/SLO medido,
carga/chaos/recovery production-like, WebKit/assistive-tech/zoom real, as
demais mutações normalizadas, replay seguro de `ops.restore` e aceite humano
continuam sem prova. Nenhuma promoção, credencial, dado real, egress ou
release foi acionado.
