> **SUPERSEDED em 2026-09-20 pelo [roadmap CVG-AUD25](roadmap-melhorias-cvg-aud25-2026-09-20.md).** As tarefas 001 e 002 permanecem progresso histórico; 003 foi reaberta porque a autoridade é validada em uma conexão diferente daquela que executa `BEGIN`/DML. Este arquivo não controla mais a próxima ação.

# Roadmap de melhorias — CVG-AUD24

**Data-base:** 2026-09-20  
**Origem:** [auditoria de CVG-AUD23-004](auditoria-entrega-cvg-aud23-004-2026-09-20.md)  
**Estado inicial:** `FAIL / REJECT / AAA_NOT_PROVEN`  
**Promoção:** `BLOCKED`

## Objetivo

Transformar o progresso de restore em uma fronteira realmente selada e em evidência reproduzível. O ciclo começa corrigindo a verdade do control plane, fecha os bypasses de recovery, constrói um oracle PostgreSQL independente e só então retoma qualidade local, qualificação dupla, provas externas e decisão humana.

O roadmap não autoriza commit, push, deploy, uso de credenciais ou dados reais. Dependências externas permanecem bloqueadas até existir candidato local congelado.

## Princípios de execução

- Um tipo TypeScript não é uma fronteira de segurança: todo input de runtime é validado ou reconstruído.
- `DONE` exige known-bad, known-good, receipt current e fingerprint recalculado do sujeito exato.
- O oracle não pode depender somente da mesma função de produção que está sendo testada.
- Harnesses não ampliam grants para fabricar sucesso.
- Falha, ausência e bloqueio externo preservam exit/status distintos; nenhum deles vira `PASS`.
- Histórico `.agent` é append-only: correções usam eventos e receipts superseding.
- Cada tarefa pronta por dependência muda para `READY`; o verificador examina todo o DAG, não apenas a ação ativa.
- Críticos finais são frescos, somente leitura e usam mutation sentinel.

## W0 — verdade do sujeito e do controle

**Tarefa:** 001  
**Saída:** o worktree auditado é reproduzível e o falso fechamento de AUD23-004 está reconciliado.

- Manifestar HEAD, index, tracked diff, untracked relevante, modos, lockfile e configurações com regras de inclusão/exclusão fechadas.
- Recalcular o digest no verificador; não aceitar um hash apenas porque ele foi repetido em state/item/receipt.
- Acrescentar reabertura de AUD23-004 e ponte para AUD24 sem alterar receipts ou eventos anteriores.
- Validar `current_audit_addendum`, todos os status derivados das dependências e todos os ponteiros correntes.

**Gate:** mutar um byte, modo, arquivo relevante ou dependência invalida o receipt; o snapshot atual falha antes da reconciliação e passa depois.

## W1 — restore selado e autoridade efetiva

**Tarefas:** 002–004  
**Saída:** existe uma única fronteira de restore, sem caminho alternativo por `commit()`.

- Reconstruir/allowlistar o comando normal e rejeitar qualquer chave de recovery antes de conexão.
- Tornar a capacidade interna de restore não forjável por dados de input; vincular a operação ao principal do banco e ao fingerprint lido do destino.
- Passar todo o corpus semântico pelo entrypoint publicado, medindo chamadas a `connect`, BEGIN, DML e estado do destino.
- Adicionar teste de contrato runtime e, quando aplicável, compile-negative para arrays crus.

**Gate:** a contraprova `commit({...recoveredAgent*})` falha antes de conexão; restore sem membership, com fingerprint divergente ou bundle inválido não produz DML.

## W2 — oracle PostgreSQL independente

**Tarefas:** 005–008  
**Saída:** conhecido-bom, origem, rollback, privilégios e retries são provados sem oracle circular.

- Capturar origem antes de qualquer mutação do verifier ou preparar fixture fora da janela auditada.
- Injetar falha pelo `restore()` depois de projeções reais e antes do commit.
- Consultar diretamente snapshots, journal, audit/ledger, receipts/ledger, outbox, usage, inbox, efeitos, jobs, sessions, turns, checkpoints, leases e sequências.
- Remover grants amplos dos harnesses; migrations/default privileges são a única autoridade.
- Definir retries, conflito de destino, replay do mesmo bundle, perda de conexão e outcome unknown.

**Gate:** duas rodadas em PostgreSQL 16 limpo, hashes diretos antes/depois, inventário de recursos idêntico e zero ampliação de grants.

## W3 — evidência operacional reproduzível

**Tarefas:** 009–011  
**Saída:** static, receipts, exits e control plane representam fielmente o candidato.

- Separar candidate root de evidence root; renovar snapshots promovíveis e manter snapshots históricos explicitamente fora do gate corrente.
- Preservar comando, tempos, exit, stdout/stderr digest, ambiente permitido e artifact digest por procedimento.
- Integrar manifesto, receipts, eventos, plano, backlog e dependências num gate obrigatório de CI.

**Gate:** `verify:static` e `verify:control-plane` passam; stale SHA, mtime, observedAt, receipt composto enganoso e status impossível falham isoladamente.

## W4 — qualidade web e operação local

**Tarefas:** 012–015  
**Saída:** toolchain, browsers, alertas e logs possuem provas locais executáveis.

- Adotar ESLint TypeScript/React Hooks/jsx-a11y como autoridade e impor splitting, budgets e cenário CWV declarado.
- Executar Chromium, Firefox e WebKit sem retries, incluindo axe, teclado, foco, reduced motion e zoom automatizável.
- Executar drill Prometheus→Alertmanager→receiver para `firing` e `resolved`.
- Implementar logs duráveis com restart, retenção, correlação, acesso auditado e redaction por valor.

**Gate:** cada propriedade tem known-bad, known-good e evidência fora do candidate root.

## W5 — convergência e candidato local

**Tarefas:** 016–017  
**Saída:** schema final, gates não mutantes e duas qualificações completas no mesmo fingerprint.

- Reexecutar clean install, upgrade, N-2/N-1/N, readiness, restore e matriz de privilégios após todas as migrations finais.
- Executar build, browsers, PostgreSQL, worker, recovery, alertas, logs, diff, proveniência e control plane sem modificar o sujeito.
- Rodar duas matrizes independentes, sem retry e sem skip relevante.

**Gate:** 2× `PASS`, zero P0/P1 local, zero drift, zero warning de budget e inventário antes/depois idêntico.

## W6 — quatro autoridades externas

**Tarefas:** 018–021  
**Saída:** o mesmo candidato recebe provas independentes de ambiente, acessibilidade, resiliência e supply chain.

- 018: staging, providers reais, secret authority, collector e SLO.
- 019: leitor de tela/AT e zoom manual por especialista.
- 020: carga production-like, chaos, backup/restore gerenciado e RTO/RPO.
- 021: CI same-digest, imagens, SBOM, scans, assinatura, provenance e container smoke.

**Gate:** cada lane referencia o fingerprint de W5. Se a autoridade continuar ausente depois de W5, usar `BLOCKED_EXTERNAL`, nunca `PASS`.

## W7 — encerramento técnico

**Tarefa:** 022  
**Saída:** F0–F37 em `PASS` no mesmo candidato.

- Críticos frescos para API/segurança, PostgreSQL, evidência/release e frontend/operabilidade.
- Red teams F23/F24 independentes.
- Qualquer repair invalida e reexecuta todos os receipts afetados.

**Gate:** zero achado alto/crítico e 38/38 fases técnicas atuais.

## W8 — decisão humana

**Tarefa:** 023  
**Saída:** F38 recebe `APPROVE`, `REJECT` ou `DEFER` de autoridade nomeada, vinculada ao fingerprint, riscos e rollback.

**Gate final:** somente `APPROVE` humano verificável permite promoção. O agente não produz nem infere esse aceite.

## Marcos

| Marco | Tarefas | Critério de saída |
|---|---|---|
| M0 controle confiável | 001 | Exact-subject recalculado; histórico e DAG reconciliados. |
| M1 fronteira selada | 002–004 | Bypass runtime fechado; autoridade e corpus pré-DML provados. |
| M2 recovery real | 005–008 | Origem, rollback, privilégios e retries com oracle independente. |
| M3 evidência | 009–011 | Static, exits, receipts e control plane fail-closed. |
| M4 qualidade/operação | 012–015 | Web, browsers, alertas e logs com known-bads. |
| M5 convergência | 016 | Schema final e gates não mutantes. |
| M6 candidato local | 017 | Duas matrizes no mesmo fingerprint. |
| M7 evidência externa | 018–021 | Quatro autoridades independentes no candidato. |
| M8 fechamento técnico | 022 | F0–F37 e zero alto/crítico. |
| M9 decisão | 023 | F38 humano verificável. |

## Regras de parada

- Um bypass conhecido ou um receipt sem sujeito exato impede `DONE`.
- Qualquer mutação do candidate torna receipts anteriores `STALE`.
- Um verifier que concede privilégios além das migrations reprova a tarefa.
- `NOT_RUN`, `FAIL`, `BLOCKED_BY_DEPENDENCIES`, `BLOCKED_EXTERNAL` e `BLOCKED_HUMAN` nunca contam como `PASS`.
- Um alto/crítico reabre a tarefa dona e tudo que depende de sua evidência.
- Nenhuma promoção ocorre enquanto `AAA_NOT_PROVEN` estiver vigente.

## Próxima ação única

`CVG-AUD24-001:EXACT-SUBJECT-CONTROL-RECONCILIATION` — implementar o manifesto recalculável, fazer o snapshot atual reprovar por fingerprint opaco/incoerências globais e acrescentar a reabertura de AUD23-004 mais a transição para AUD24 sem editar o histórico.
