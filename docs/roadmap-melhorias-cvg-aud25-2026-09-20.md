# Roadmap de melhorias — CVG-AUD25

**Data-base:** 2026-09-20  
**Origem:** [auditoria de CVG-AUD24-003](auditoria-entrega-cvg-aud24-003-2026-09-20.md)  
**Estado inicial:** `FAIL / REJECT / AAA_NOT_PROVEN`  
**Promoção:** `BLOCKED`

## Objetivo

Transformar o restore em uma única fronteira de autoridade: a mesma conexão PostgreSQL cuja identidade, owner, role contract, memberships e schema foram validados deve executar a transação. Depois, substituir provas simuladas/circulares por known-bads reais e SQL direto, retomar o corpus pré-conexão, least privilege, resiliência, evidência e as qualificações local, externa e humana.

O plano não autoriza commit, push, deploy, credenciais ou dados reais. Mudanças no histórico `.agent` são exclusivamente append-only.

## Regras invariantes

- Nenhum client executa `BEGIN` ou DML de restore sem ter sido o próprio objeto validado.
- Atributos da role são allowlist fechada; poder não declarado reprova.
- Known-bad de PostgreSQL é executado no PostgreSQL e observado por oracle independente.
- Verifier não cria grants para fabricar a propriedade que pretende provar.
- `DONE` exige known-bad, known-good, fingerprint recalculado e receipt current.
- `FAIL`, `NOT_RUN`, `BLOCKED_*`, skip relevante e output descartado nunca equivalem a `PASS`.
- Qualquer mutação do candidato torna stale toda evidência afetada.

## W0 — verdade do controle

**Tarefa:** 001  
**Saída:** AUD24-003 reaberta sem reescrever histórico, dependentes invalidados e sujeito pós-documentação recalculado.

- Acrescentar evento/receipt superseding para o falso `DONE`.
- Ativar AUD25 com uma única próxima ação e status derivados de todo o DAG.
- Preservar AUD24-001/002 como progresso local comprovado.

**Gate:** snapshot antigo falha; ledger append-only, ponteiros e fingerprint novo passam.

## W1 — autoridade vinculada à transação

**Tarefas:** 002–003  
**Saída:** conexão, principal, schema e DML formam uma única unidade verificável.

- Manter o client validado até COMMIT/ROLLBACK e impedir handoff implícito.
- Validar todos os atributos restritivos da role, owner e memberships no mesmo client.
- Registrar no journal somente identidade/fingerprint lidos desse client.
- Executar matriz PostgreSQL negativa de executor, owner, atributos, memberships e migration drift, com zero BEGIN/DML/mutação.

**Gate:** contraprova split-client e cada variante real falham antes de BEGIN; conhecido-bom continua passando.

## W2 — corpus e oracle de recovery

**Tarefas:** 004–008  
**Saída:** input, origem, destino, rollback, privilégios e retries são provados por fronteiras públicas e oracles independentes.

- Encaminhar todo o corpus semântico pelo `restore()` publicado e medir connect/BEGIN/DML.
- Fotografar origem antes da janela auditada; comparar origem e destino por SQL canônico.
- Injetar falha tardia dentro de `restore()` e conferir todas as relações e sequências.
- Remover auto-provisionamento e grants amplos dos harnesses.
- Definir replay, conflito, disconnect e outcome unknown.

**Gate:** duas rodadas PostgreSQL 16 limpas, hashes diretos idênticos onde exigido, zero grant auxiliar e cleanup integral.

## W3 — evidência reproduzível

**Tarefas:** 009–011  
**Saída:** static, transcripts, exits, receipts e control plane representam o candidato real.

- Separar candidate root de evidence root e renovar/classificar snapshots.
- Preservar stdout/stderr, exit, tempos, ambiente permitido e digest por subcomando.
- Tornar manifesto, receipts, eventos, DAG e exits gate obrigatório de CI.

**Gate:** mutantes de SHA/freshness/exit/status/transcript falham; `verify:static` e control plane passam sem alterar o sujeito.

## W4 — qualidade web e operação local

**Tarefas:** 012–015  
**Saída:** lint/budgets/CWV, três engines, acessibilidade automatizável, alertas e logs duráveis têm provas locais.

**Gate:** Chromium, Firefox e WebKit sem retries; known-bads de budget/a11y/alert/log falham e conhecidos-bons passam.

## W5 — convergência local

**Tarefas:** 016–017  
**Saída:** schema final requalificado e duas matrizes completas no mesmo fingerprint.

- Clean install, upgrades N-2/N-1/N, readiness, restore, privilégios e recovery.
- Duas qualificações independentes, sem retry/skip relevante e sem mutar o candidato.

**Gate:** 2× `PASS`, zero P0/P1 local, zero drift/resíduo.

## W6 — autoridades externas

**Tarefas:** 018–021  
**Saída:** staging/providers, especialista de acessibilidade, carga/chaos/DR e CI/supply chain atestam o mesmo candidato.

**Gate:** receipts externos same-fingerprint; autoridade ausente após W5 vira `BLOCKED_EXTERNAL`, nunca sucesso.

## W7 — encerramento

**Tarefas:** 022–023  
**Saída:** gauntlet técnico fresco sem alto/crítico e decisão humana verificável.

**Gate:** F0–F37 técnicos em PASS; somente depois F38 recebe `APPROVE`, `REJECT` ou `DEFER` de autoridade nomeada.

## Marcos

| Marco | Tarefas | Critério de saída |
|---|---|---|
| M0 reconciliação | 001 | Reabertura append-only e novo sujeito coerente. |
| M1 autoridade real | 002–003 | Mesmo client validado/transacional e matriz negativa PostgreSQL. |
| M2 recovery provado | 004–008 | Corpus, origem, rollback, privilégio e retries independentes. |
| M3 evidência | 009–011 | Static/control/receipts fail-closed e reproduzíveis. |
| M4 qualidade/operação | 012–015 | Web, browsers, alertas e logs com known-bads. |
| M5 candidato local | 016–017 | Schema final e qualificação 2× same-fingerprint. |
| M6 externo | 018–021 | Quatro autoridades externas. |
| M7 técnico | 022 | F0–F37, zero alto/crítico. |
| M8 humano | 023 | F38 verificável. |

## Regras de parada

- Qualquer conexão não validada alcançando BEGIN/DML reabre 002 e todos os dependentes.
- Qualquer known-bad somente simulado não fecha uma propriedade PostgreSQL.
- Oracle que reutiliza a implementação sob teste não encerra atomicidade.
- Grant auxiliar amplo reprova a lane de banco.
- `verify:static` vermelho impede qualificação local.
- Mudança após a primeira qualificação invalida ambas as rodadas.
- O agente nunca produz nem infere aceite humano.

## Próxima ação única

`CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL` — acrescentar a reabertura de AUD24-003, bloquear AUD24-004/007 e dependentes, ativar AUD25-002 como sucessora e recalcular o exact-subject após as mudanças documentais, sem editar eventos ou receipts históricos.
