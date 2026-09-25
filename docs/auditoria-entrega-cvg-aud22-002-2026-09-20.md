# Auditoria da entrega — CVG-AUD22-002

**Data:** 2026-09-20
**Objeto:** correção do guard SQL de `usageRecordId` e tentativa de prova de restore PostgreSQL
**Veredito:** `PARTIAL / REJECT / AAA_NOT_PROVEN`
**Promoção:** `BLOCKED`

## Resumo executivo

A correção declarada existe e está coberta por regressão estática: o guard de `usageRecordId` usa `$10`, o campo de proveniência permanece em `$11` e o vetor de parâmetros respeita essa ordem. A suíte geral passou com 567 testes (`566` pass, `0` fail, `1` skip), assim como os 18 testes focados, typecheck, lint, manifesto de schema, verificação de diff e build informado pelo agente.

O fechamento não é aceito. A regressão focada inspeciona texto SQL e posições, mas o executor falso não avalia a relação de usage; portanto não prova no PostgreSQL que uma referência ausente ou de outro tenant é rejeitada sem DML. A tentativa de restore terminou antes da conexão, com exit `2`, por ausência de `DATABASE_URL` e `MIGRATION_DATABASE_URL`. Além disso, o control plane retorna verde mesmo com dependência não satisfeita, receipt com exit contraditório e ação ativa semanticamente inválida.

O estado correto é: implementação local parcial preservada, prova PostgreSQL `NOT_RUN`, controle da rodada rejeitado e promoção bloqueada. Nenhum banco, container, credencial ou dado real foi alterado nesta auditoria.

## Escopo e método

- Inspeção do diff e dos contratos de recovery, persistência, harnesses PostgreSQL e control plane.
- Reexecução da suíte geral e dos 18 testes focados.
- Reexecução de typecheck, lint, manifesto de schema, control plane e diff.
- Execução fail-closed do restore com as duas URLs explicitamente ausentes.
- Duas críticas independentes, frescas e somente leitura: control plane/evidência e recovery/PostgreSQL.
- O build não foi reexecutado nesta auditoria por escrever artefatos no worktree; seu `PASS` é evidência reportada pelo agente, não observação nova desta revisão.

## Entrega confirmada

1. `packages/agent-session/src/index.ts` associa `usageRecordId` ao parâmetro `$10`, valida o tenant na subconsulta e mantém `provenanceEventId` em `$11`.
2. `tests/unit/agent-session.test.ts` rejeita a regressão textual para `$11` e valida os índices de `usageRecordId` e proveniência.
3. A validação semântica de recovery é chamada antes do DML das projeções no caminho corrente de persistência.
4. Os testes em memória cobrem um bundle conhecido-bom e mutantes re-hashados conhecidos-ruins.
5. O registro append-only preservou o resultado como `PARTIAL`; não houve alegação de `DONE` ou de AAA.

Esses pontos são progresso válido, mas não substituem a prova comportamental no banco.

## Achados

| ID | Sev. | Achado | Consequência | Fechamento exigido |
|---|---|---|---|---|
| AUD23-F01 | Crítica | `verify:control-plane` aceita uma ação cuja dependência permanece `PARTIAL`, aceita estado ativo bloqueado e não valida adequadamente task/action/result/freshness/tail do último receipt. | O verde atual (`items=204`) é falso e não pode governar execução ou promoção. | Adicionar known-bads para cada relação, reconciliar o histórico por novos eventos e provar o verificador vermelho antes/verde depois. |
| AUD23-F02 | Alta | A prova do guard `$10/$11` é estática. O executor falso não avalia a subconsulta de usage e devolve linha apenas pelo fence. | Referência órfã/cross-tenant e ausência de DML não foram demonstradas no PostgreSQL. | Rodar corpus comportamental em PostgreSQL 16 descartável com runtime e schema-owner separados. |
| AUD23-F03 | Alta | A ausência de URLs foi classificada como `BLOCKED_EXTERNAL`, embora Docker local e precedentes de PostgreSQL descartável existam. | Confunde falta de configuração/autoridade local com dependência realmente externa. | Classificar como `NOT_RUN` até provar indisponibilidade/autorização; criar runner descartável dedicado sem reutilizar containers existentes. |
| AUD23-F04 | Alta | O receipt `VER-CVG-AUD22-002-001` registra `exit_status=0` e `acceptance_exit_status=0`, embora o comando de restore incluído retorne `2`. | Evidência agregada representa sucesso incompatível com o subprocesso bloqueado. | Registrar exits por comando, agregar pelo pior resultado e emitir receipt corretivo append-only. |
| AUD23-F05 | Alta | O contrato público de commit ainda recebe arrays `recoveredAgent*` independentes e ativa a role de restore pela presença desses arrays. | Um chamador pode contornar a fronteira de bundle completo, fingerprint e autoridade explícita. | Expor um único entrypoint selado que receba `DurableRecoveryBundle`, fingerprint e autoridade e validar tudo antes do primeiro DML. |
| AUD23-F06 | Alta | Harnesses ainda contêm `GRANT USAGE, SELECT ON ALL SEQUENCES`. | Uma execução bem-sucedida não demonstraria least privilege derivado apenas das migrations. | Remover grants auxiliares e provar negativas em clean install e upgrade, inclusive objetos futuros. |
| AUD23-F07 | Média | Falha de referência de usage em `appendTurn` é colapsada no erro genérico de fence stale. | Operação e auditoria perdem causalidade; alertas e retries podem tratar defeitos distintos da mesma forma. | Adotar erro estável de integridade/escopo sem vazar dados e cobri-lo em memória e PostgreSQL. |
| AUD23-F08 | Alta | README, estado de implementação e pacote AUD22 apontavam para contagens e próxima ação antigas. | Operadores podem retomar pelo passo errado. | Corrigido por este pacote documental; o control plane `.agent` será reconciliado pela primeira tarefa AUD23. |
| AUD23-F09 | Alta | Fingerprint exact-subject, duas qualificações locais, WebKit/AT, logs duráveis, alert drill, staging/providers, carga/chaos/DR, supply chain e aceite humano continuam ausentes. | `AAA_NOT_PROVEN` permanece obrigatório. | Executar as lanes locais, externas e humana do roadmap AUD23, sem converter ausência em `PASS`. |

## Inconsistências do control plane

- `CVG-AUD22-001` permanece `PARTIAL`, mas `CVG-AUD22-002`, que depende dela, foi tornada ativa.
- O `next_action` de 001 aponta para uma ação de 002, atravessando a fronteira da tarefa.
- O verificador atual checa existência/ciclos de dependências, mas não que elas estejam satisfeitas.
- O receipt mais recente pode ter task/action/freshness/resultado divergentes sem reprovar o gate.
- O exit global `0` encobre o exit `2` do restore.

Por preservação append-only, esta auditoria não reescreve `.agent/backlog.json`, `.agent/state.json` ou JSONL antigos. A correção deve acrescentar eventos/receipts superseding e endurecer o verificador.

## Verificações

| Verificação | Resultado auditado | Limite |
|---|---|---|
| `npm test` | `PASS`: 567 total, 566 pass, 0 fail, 1 skip | O skip continua não promovível sem classificação. |
| 18 testes focados | `PASS`: 18/18 | Guard SQL apenas estático/fake executor. |
| `npm run typecheck` | `PASS` | Local. |
| `npm run lint` | `PASS` | É o lint customizado atual; ESLint real segue pendente. |
| `npm run build` | `PASS` reportado pelo agente | Não reexecutado nesta auditoria para não escrever artefatos. |
| `npm run verify:schema-manifest` | `PASS`: migration 044 | Não substitui restore real. |
| `npm run verify:diff` | `PASS` | Local. |
| `npm run verify:control-plane` | Exit `0`, mas **INVALIDADO** por known-bads aceitos | Não é evidência de fechamento. |
| `npm run verify:postgres:restore` | Exit `2`, `NOT_RUN` | URLs ausentes; nenhum banco foi tocado. |

## Estado corrigido

| Escopo | Estado correto |
|---|---|
| Correção `$10/$11` | `IMPLEMENTED_UNVERIFIED_PG` |
| `CVG-AUD22-001` | `PARTIAL / REOPEN` |
| `CVG-AUD22-002` | Progresso preservado, mas `BLOCKED_BY_DEPENDENCIES` e prova PG `NOT_RUN` |
| Control plane | `REJECT`; o exit verde não é confiável |
| Programa | `PARTIAL / REJECT / AAA_NOT_PROVEN` |
| Promoção | `BLOCKED` |

## Decisão

Não promover e não marcar `CVG-AUD22-002` como `DONE`. A próxima ação única é `CVG-AUD23-001:CONTROL-PLANE-SEMANTICS`. Depois dela, provisionar um PostgreSQL 16 descartável dedicado, sem tocar containers preexistentes, e executar a prova comportamental antes de selar o restore e fechar privilégios.

Roadmap: [roadmap CVG-AUD23](roadmap-melhorias-cvg-aud23-2026-09-20.md).
Backlog: [backlog CVG-AUD23](backlog-melhorias-cvg-aud23-2026-09-20.md).
