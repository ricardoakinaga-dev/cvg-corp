# Auditoria da entrega — CVG-AUD23-004

**Data:** 2026-09-20  
**Objeto:** entrypoint selado de restore PostgreSQL e respectiva evidência  
**Veredito:** `FAIL / REJECT / AAA_NOT_PROVEN`  
**Promoção:** `BLOCKED`

## Resumo executivo

A entrega contém progresso real. O método `PostgresPersistence.restore(...)` existe, valida autoridade declarada, bundle e migration fingerprint antes de abrir a conexão no caminho direto; o restore conhecido-bom chegou a `revision=1` e `QUARANTINED` em PostgreSQL 16 descartável; sessões de agente foram restauradas em quarentena e leases ativos não foram reativados. A regressão geral passou com 570 testes (`569` pass, `0` fail, `1` skip), e os 59 testes de persistência, typecheck, lint e diff também passaram.

O fechamento de `CVG-AUD23-004` como `DONE` é rejeitado. Uma contraprova pela API exportada demonstrou que `commit()` ainda aceita propriedades `recoveredAgent*` extras em runtime, encaminha o objeto sem filtragem ao método interno, assume `cvg_restore_authority` e projeta recovery sem passar pelas validações de bundle, fingerprint e autoridade de `restore()`. A remoção desses campos da interface TypeScript é somente estática, não uma fronteira de runtime.

A prova operacional também não fecha atomicidade: o conhecido-ruim chamado de “late restore” executa `commit()`, não `restore()`, e compara um bundle exportado pela mesma implementação em vez de consultar diretamente todas as relações. O harness amplia privilégios de sequences, alega origem inalterada usando uma linha de base capturada depois de inserir fixtures e não encaminha todo o corpus semântico pelo entrypoint selado.

Por fim, o fingerprint registrado como exact-subject não é recalculado a partir do worktree: o control plane apenas compara strings. O gate `verify:static` permanece vermelho por snapshots operacionais antigos. O estado correto é `CVG-AUD23-004 = PARTIAL / REOPEN`, `CVG-AUD23-005 = BLOCKED_BY_DEPENDENCIES` até selar novamente a fronteira, e programa global `AAA_NOT_PROVEN`.

## Escopo e método

- Inspeção da API pública e interna de persistência, migrations 042–044, verifier PostgreSQL, control plane e registros append-only.
- Contraprova runtime pela API exportada de `PostgresPersistence.commit()` com propriedades `recoveredAgent*` extras.
- Reexecução da regressão geral, testes de persistência, typecheck, lint, diff, static, control plane e integridade JSON/JSONL.
- Reexecução do restore em PostgreSQL 16 descartável com inventário Docker antes/depois.
- Três críticas frescas, independentes e somente leitura: API/restore, oracle PostgreSQL e evidência/control plane.
- Mutation sentinel antes/depois das críticas: digest idêntico `c07811dc5b4e0f2fc7df0dd8e0777ae2a9bc3e572b1f4bafa8d63bfa1eb904ab`.

Esta auditoria atualiza somente documentação. Não reescreve `.agent`, código, banco, container ou histórico de receipts.

## Entrega confirmada

1. `PostgresPersistence.restore()` é um entrypoint público separado e, no caminho direto, checa a forma da autoridade, valida o bundle e compara o fingerprint antes de `commitInternal()` abrir conexão.
2. `DurableCommitInput` não expõe mais os campos `recoveredAgent*` no contrato TypeScript.
3. O caminho direto cria snapshot `QUARANTINED`; sessões restauradas ficam `QUARANTINED_RESTORE`, preservam fence/histórico e não restauram leases ativos.
4. A migration 044 cria `cvg_restore_authority` como `NOLOGIN`, `NOINHERIT`, sem superuser/BYPASSRLS, e limita suas grants declaradas a tabelas de runtime do agente.
5. O PostgreSQL 16 descartável aplicou 44 migrations e o caminho conhecido-bom passou; a execução auditada confirmou cleanup e inventário Docker inalterado.
6. Os testes existentes rejeitam bundle inválido, autoridade ausente e fingerprint divergente no método `restore()`.
7. O receipt e o evento de AUD23-004 foram acrescentados aos ledgers; não houve reescrita dos registros anteriores.

Esses pontos são preservados como implementação parcial. Eles não neutralizam o bypass de runtime nem provam rollback integral.

## Achados

| ID | Sev. | Achado | Consequência | Fechamento exigido |
|---|---|---|---|---|
| AUD24-F01 | Crítica | `commit()` encaminha o objeto do chamador sem reconstruí-lo. Campos `recoveredAgent*` extras, embora ausentes da interface, são detectados internamente, causam `SET LOCAL ROLE cvg_restore_authority` e são projetados. A contraprova exportada terminou em revision 1. | JavaScript, dados desserializados ou cast podem contornar bundle, fingerprint e autoridade. O restore não está selado em runtime. | Rejeitar propriedades de recovery no caminho normal antes de conexão; separar os comandos por uma capacidade interna não forjável; provar o known-bad pela API publicada. |
| AUD24-F02 | Alta | A autoridade pré-conexão é uma string fornecida pelo chamador e o fingerprint esperado também vem do chamador. A capacidade real aparece apenas no `SET ROLE` da conexão de owner. | O contrato de classe não vincula sozinho a operação a um principal dedicado nem ao schema efetivamente conectado. | Obter/validar identidade e fingerprint do destino por fonte confiável; provar runtime sem membership negado e restore autorizado auditável. |
| AUD24-F03 | Alta | O “late restore rejected” do verifier chama `targetPersistence.commit()`, não `restore()`. O oracle usa `exportRecoveryBundle()` da mesma implementação e não consulta todas as relações. | `CVG-AUD23-005` continua aberto; linhas órfãs ou projeções omitidas pelo exporter podem escapar. | Injetar falha tardia pelo entrypoint real e comparar, por SQL independente, contagens e digests de todas as tabelas e sequências afetadas. |
| AUD24-F04 | Alta | O helper do restore executa `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public` para runtime. | O teste altera a autoridade que deveria verificar e não prova least privilege derivado das migrations. | Remover grants auxiliares amplos; executar matriz negativa em clean install e upgrade somente com grants versionados. |
| AUD24-F05 | Alta | A saída `sourceUnchanged: true` usa baseline capturada depois de criar sessão, turns, checkpoint e lease na origem. | A afirmação não significa “origem igual ao estado anterior ao verifier”. | Capturar oracle antes de qualquer DML ou criar a fixture antes da fotografia auditada; verificar diretamente origem antes/depois. |
| AUD24-F06 | Alta | Os doze known-bads semânticos chamam diretamente `validateRecoveryBundle()`. O teste fake checa `statements=[]`, mas não contabiliza chamadas a `pool.connect()`. | O corpus anunciado não prova rejeição pela fronteira publicada nem a garantia “antes de conexão”. | Encaminhar cada mutante por `restore()` e medir separadamente conexões, BEGIN/DML e destino. |
| AUD24-F07 | Alta | O fingerprint `2de932…f94a` é apenas repetido em state/item/receipt. O verificador não recalcula HEAD, index, diff, untracked, modos e configurações. AUD23-007 ainda está bloqueado. | O receipt não prova o sujeito exato e não pode sustentar `DONE`. | Implementar manifesto reproduzível e comparação independente; tornar qualquer mutação relevante invalidante. |
| AUD24-F08 | Média | `state.current_audit_addendum` ainda aponta AUD23-002/003; itens 006, 007, 010, 012 e 013 permanecem bloqueados apesar de suas dependências declaradas estarem `DONE`. O verificador só checa dependências do item ativo. | O control plane está internamente incoerente embora retorne verde. | Validar todos os itens e todas as superfícies correntes; reconciliar por novos registros append-only. |
| AUD24-F09 | Média | `verify:static` falha em 15 checks de proveniência/freshness: source SHA e `modifiedAt`/`observedAt` de sete snapshots antigos. | A limitação foi descrita corretamente, mas o gate global continua vermelho; evidência antiga não pode promover o candidato. | Renovar evidências contra o sujeito atual ou classificá-las como históricas fora do conjunto promovível, sem afrouxar o known-bad. |
| AUD24-F10 | Média | O receipt resume o run PostgreSQL, mas não preserva transcript bruto, digest de stdout/stderr e timing por comando. | A execução não é reproduzível apenas pelo ledger. | Implementar receipts por comando e evidence root externo ao candidate root. |
| AUD24-F11 | Alta | Qualificação 2×, WebKit/AT, alert delivery, logs duráveis, staging/providers, carga/chaos/DR, supply chain e aceite humano permanecem ausentes. | `AAA_NOT_PROVEN` e promoção bloqueada são obrigatórios. | Executar as lanes locais, externas e humana do roadmap AUD24 sem converter ausência em sucesso. |

## Contraprova principal

O seguinte formato foi enviado ao `commit()` exportado, apesar de os campos não existirem mais em `DurableCommitInput`:

```ts
await persistence.commit({
  ...normalInput,
  recoveredAgentSessions: [],
  recoveredAgentTurns: [],
  recoveredAgentCheckpoints: [],
  recoveredAgentLeases: []
});
```

Resultado observado: sucesso em revision `1`, emissão de `SET LOCAL ROLE "cvg_restore_authority"`, `RESET ROLE` e projeção do journal. A falha de contrato é comportamental, não apenas teórica.

## Verificações

| Verificação | Resultado auditado | Limite |
|---|---|---|
| `npm test` | `PASS`: 570 total, 569 pass, 0 fail, 1 skip | O skip continua não promovível sem classificação. |
| `node --import tsx --test tests/integration/persistence.test.ts` | `PASS`: 59/59 | Não contém a contraprova runtime contra `commit()`. |
| Testes focados dos críticos | `PASS`: restore 3/3; control plane 6/6 | Suíte existente verde apesar dos known-bads. |
| Contraprova `commit(...recoveredAgent*)` | **ACEITA** | Invalida o fechamento da fronteira selada. |
| `npm run typecheck` | `PASS` | TypeScript não protege callers runtime. |
| `npm run lint` | `PASS`: 237 fontes | É o lint customizado; ESLint completo continua pendente. |
| `npm run verify:diff` | `PASS` | Local. |
| JSON/JSONL | `PASS`: 385 receipts e 434 eventos parseáveis | Parse não prova semântica nem exact-subject. |
| `npm run verify:control-plane` | Exit `0`: 225 itens, ativo AUD23-005 | **INVALIDADO** por fingerprint opaco, addendum stale e status de dependências. |
| `npm run verify:static` | Exit `1`: 15 falhas de snapshots antigos | Classificação reportada é correta; gate segue vermelho. |
| `npm run verify:ephemeral-postgres -- --rounds=1 --run-restore` | `PASS`: PostgreSQL 16, 44 migrations, behavior/restore PASS | Uma rodada; verifier contém os defeitos F03–F06. |
| Inventário Docker antes/depois | `PASS`: diff vazio | Nenhum container residual observado. |
| Mutation sentinel dos críticos | `PASS`: `c07811…904ab` antes/depois | Garante crítica read-only, não o candidate fingerprint declarado. |

O build não foi reexecutado nesta auditoria e não é usado como prova desta decisão.

## Estado corrigido

| Escopo | Estado correto |
|---|---|
| Implementação direta de `restore()` | `IMPLEMENTED_WITH_BYPASS` |
| Quarentena/leases no caminho conhecido-bom | `LOCALLY_OBSERVED` |
| `CVG-AUD23-004` | `PARTIAL / REOPEN`; o `DONE` atual deve ser superseded append-only |
| `CVG-AUD23-005` | `BLOCKED_BY_DEPENDENCIES`; oracle de rollback ainda não iniciado de forma válida |
| Control plane | `REJECT`; verde estrutural não prova subject nem coerência global |
| Static/evidência | `FAIL` por snapshots stale |
| Programa | `FAIL / REJECT / AAA_NOT_PROVEN` |
| Promoção | `BLOCKED` |

## Decisão

Não promover e não aceitar `CVG-AUD23-004` como concluído. A primeira ação do novo ciclo é `CVG-AUD24-001:EXACT-SUBJECT-CONTROL-RECONCILIATION`: tornar o sujeito reproduzível, registrar a reabertura de AUD23-004 sem editar histórico e corrigir as superfícies incoerentes do control plane. Em seguida, selar o bypass runtime e somente depois executar o oracle de rollback.

Roadmap: [roadmap CVG-AUD24](roadmap-melhorias-cvg-aud24-2026-09-20.md).  
Backlog: [backlog CVG-AUD24](backlog-melhorias-cvg-aud24-2026-09-20.md).
