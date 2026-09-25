# Auditoria da entrega — CVG-AUD24-003

**Data:** 2026-09-20  
**Objeto:** autoridade e fingerprint do restore PostgreSQL  
**Veredito:** `FAIL / REJECT / AAA_NOT_PROVEN`  
**Estado corrigido:** `CVG-AUD24-003 = PARTIAL / REOPEN`  
**Promoção:** `BLOCKED`

## Resumo executivo

A entrega tem progresso material e preservável. O caminho normal de `commit()` agora rejeita campos de recovery; `restore()` valida bundle e fingerprint antes de DML; o exact-subject foi recalculado; state, backlog, plano e receipt estavam coerentes no sujeito auditado. O conhecido-bom passou em PostgreSQL 16 descartável com 44 migrations, revision `1`, snapshot e sessões em quarentena, fences e histórico preservados, leases descartados, login/readiness bloqueados e cleanup confirmado.

O fechamento como `DONE` é rejeitado por uma falha de fronteira. `readRestoreDestinationAuthority()` abre um client, verifica principal, owner, membership e migrations e o libera. Em seguida, `commitInternal()` abre um segundo client e executa `BEGIN` e DML sem repetir essas verificações. Uma contraprova pelo método público `restore()` observou `connects=2`, uma checagem no preflight, zero na conexão de commit, `BEGIN=true` e `insert into organizations=true`. Logo, a identidade registrada não está vinculada ao executor efetivo da transação e um pool trocado/heterogêneo pode levar um principal não verificado a DML.

A evidência também não satisfaz o próprio aceite da tarefa. Os known-bads de identidade, owner, atributos/membership da role, membership do runtime e migration drift são testes de fake pool; o drill PostgreSQL real executa somente o conhecido-bom. O contrato da role não consulta `rolcreatedb`, `rolcreaterole` e `rolreplication`. A alegação de rollback continua fora do entrypoint: a falha tardia chama `commit()`, não `restore()`, e usa `exportRecoveryBundle()` como oracle circular. Portanto, o estado global `AAA_NOT_PROVEN` reportado pelo agente está correto, mas o `DONE` local de 003 não está.

## Método e barra congelada

- Inspeção da API pública/interna, migration 044, testes de persistência, verifier PostgreSQL, manifesto do sujeito e control plane.
- Reexecução de regressão, database, fault, typecheck, lint, control plane, static, integridade JSON/JSONL e diff.
- PostgreSQL 16 descartável com uma rodada real do conhecido-bom e inventário/cleanup.
- Dois críticos frescos, independentes e somente leitura: fronteira de autoridade e oracle PostgreSQL.
- Contraprova split-client pelo método público `restore()`.
- Mutation sentinel antes de editar documentação: `0146dd5714a8699d190466fc6f6a0d2e56fff77b29bc21d2fd000d93ab2e4625`, idêntico após as críticas.

Critérios congelados: identidade/fingerprint do executor real; rejeição antes de `BEGIN`/DML; ausência de bypass; known-bads comportamentais; matriz PostgreSQL real; verifier sem grants fabricados; rollback pelo entrypoint com SQL direto; saídas/exits honestos; fingerprint recalculável; histórico append-only e control plane coerente.

## Entrega confirmada

1. O bypass anterior por `commit({...recoveredAgent*})` foi fechado por validação runtime antes de conexão.
2. `restore()` rejeita autoridade ausente/malformada, bundle inválido e fingerprint de input divergente antes da transação.
3. O manifesto recalcula HEAD, index, diff, arquivos relevantes, modos e configurações; o digest `sha256:5963cc8cf9652bc786953696b5a03fc861a1421e4acf26698565b8db1a0d0c5a` coincidiu com a recomputação no sujeito pré-auditoria documental.
4. O control plane passou com 248 itens e ação ativa `CVG-AUD24-004:PRE-CONNECTION-CORPUS`; state rev 401, receipt `VER-CVG-AUD24-003-003` e evento corrente estavam alinhados naquele sujeito.
5. O conhecido-bom real restaurou revision `1` em quarentena, preservou runtime/fences/histórico, descartou leases, bloqueou login/readiness e limpou o PostgreSQL descartável.
6. A migration 044 define `cvg_restore_authority` como `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB` e `NOCREATEROLE`, revogando membership do runtime.

Esses fatos permanecem progresso local. Eles não provam que a mesma conexão validada executa a transação nem fecham rollback, least privilege ou qualificação.

## Achados

| ID | Sev. | Achado | Consequência | Fechamento exigido |
|---|---|---|---|---|
| AUD25-F01 | Crítica | O preflight libera o client validado; `commitInternal()` adquire outro client e chega a `BEGIN`/DML sem verificar identidade, owner, membership ou schema. | A autoridade e o fingerprint não estão vinculados ao executor real; uma conexão trocada pode escrever antes de falhar. | Manter o mesmo client do preflight até COMMIT/ROLLBACK e provar com split-client known-bad. |
| AUD25-F02 | Alta | Identidade/owner/role/membership/runtime membership/migration drift negativos são fake-pool; o PostgreSQL descartável cobre só o conhecido-bom. | Não existe a matriz PostgreSQL direta exigida pelo aceite, nem prova independente de zero `BEGIN`, zero DML e destino idêntico. | Criar alvos reais isolados e observá-los por SQL/telemetria independente. |
| AUD25-F03 | Alta | A query verifica login, superuser, bypass RLS e inherit, mas omite `CREATEDB`, `CREATEROLE` e `REPLICATION`. | Uma role mais poderosa que a migration 044 pode ser aceita. | Comparar todos os atributos fechados e criar known-bad real por atributo. |
| AUD25-F04 | Alta | A falha “late restore” chama `commit()`, não `restore()`; o oracle usa `exportRecoveryBundle()` da própria implementação. | `destinationUnchangedAfterRollback=true` não prova atomicidade do restore. | Falha tardia no entrypoint real e SQL direto sobre todas as relações/sequências. |
| AUD25-F05 | Alta | Harnesses criam/alteram roles e concedem privilégios que depois verificam; há `GRANT ... ON ALL SEQUENCES`. | O verifier fabrica parte da propriedade e não prova least privilege. | Remover auto-provisionamento/grants amplos e testar clean install/upgrade. |
| AUD25-F06 | Média | O wrapper descarta stdout de filhos bem-sucedidos e resume como `restore_behavior=PASS`; `migrationMismatchRejected` é validação em memória, não drift do destino. | O receipt torna resultados distintos indistinguíveis e superestima cobertura. | Preservar transcript/digest/exit por subcomando e nomear só propriedades observadas. |
| AUD25-F07 | Média | `verify:static` falha em 15 checks de source SHA/freshness de sete snapshots antigos. | O gate promovível continua vermelho. | Separar evidence root e renovar/classificar snapshots sem afrouxar o gate. |
| AUD25-F08 | Alta | WebKit/AT, alert delivery, logs duráveis, qualificação 2×, staging/providers, carga/chaos/DR, supply chain e aceite humano seguem ausentes. | `AAA_NOT_PROVEN` e promoção bloqueada são obrigatórios. | Executar as lanes locais, externas e humana, mantendo ausência como não-PASS. |

## Resultado por critério

| Critério | Resultado | Evidência resumida |
|---|---|---|
| A1 identidade/schema do destino real | `FAIL` | Lidos do PostgreSQL, mas em conexão diferente da que escreve. |
| A2 principal/owner/role antes de DML | `FAIL` | Apenas o client descartado foi validado. |
| A3 known-bads antes de BEGIN/DML | `FAIL` | Split-client alcançou `BEGIN` e insert; negativos reais ausentes. |
| A4 sem bypass alternativo/quarentena | `PASS` | `commit()` normal rejeita recovery; sessões seguem quarentenadas e leases são descartados. |
| A5 gates comportamentais | `FAIL` | Fake pool único não detecta handoff de conexão. |
| P1 conhecido-bom PostgreSQL | `PASS` | PostgreSQL 16, 44 migrations, revision 1, quarentena e cleanup. |
| P2 matriz negativa PostgreSQL | `FAIL` | Não executada em banco real. |
| P3 verifier não fabrica autoridade | `FAIL` | Roles/grants auxiliares ainda são criados. |
| P4 rollback real e SQL direto | `FAIL` | Usa `commit()` e exporter circular. |
| P5 saídas/exits semanticamente fiéis | `FAIL` | Cleanup/exit foram fiéis, mas o resumo `PASS` overclaims cobertura. |
| E1 exact-subject recalculado | `PASS` no sujeito auditado | Digest recomputado coincidiu antes das edições documentais. |
| E2–E4 ledger/control plane | `PASS` no sujeito auditado | Receipt/evento/ação correntes e known-bads estruturais alinhados. |
| E5 checks reportados | `PASS` com ressalvas | Contagens foram reproduzidas; static permanece vermelho. |

## Verificações executadas

| Verificação | Resultado | Limite |
|---|---|---|
| `npm test` | `PASS`: 576 total, 575 pass, 0 fail, 1 skip | Skip continua não promovível sem classificação final. |
| `npm run test:database` | `PASS`: 71/71 | Testes fake não substituem matriz negativa real. |
| `npm run test:fault` | `PASS`: 34/34 | Local. |
| `npm run typecheck` | `PASS` | Não detecta troca de client em runtime. |
| `npm run lint` | `PASS`: 238 arquivos | Toolchain completo segue no backlog. |
| `npm run verify:control-plane` | `PASS`: 248 itens, ativo AUD24-004 | Válido no sujeito pré-documentação; precisa reconciliação após a reabertura. |
| Testes focados de control/manifest | `PASS`: 11/11 | Não cobrem a conexão transacional. |
| Contraprova split-client pública | **REPRODUZIDA** | Client de commit não validado chegou a BEGIN e insert. |
| `npm run verify:ephemeral-postgres -- --rounds=1 --run-restore` | Exit `0`; conhecido-bom e cleanup `PASS` | P2–P5 reprovados pelas limitações acima. |
| JSON/JSONL | `PASS`: 395 receipts, 444 eventos parseáveis | Parse não substitui semântica. |
| `git diff --check` | `PASS` | Pré-documentação. |
| `npm run verify:static` | `FAIL`: 15 checks | Sete snapshots com SHA/freshness antigos. |
| Mutation sentinel | `PASS`: `0146dd…4625` | Críticas não alteraram o sujeito. |

## Estado corrigido e decisão

| Escopo | Estado correto |
|---|---|
| Exact-subject/control plane AUD24-001 | `DONE_LOCAL` no sujeito auditado |
| Bypass público de commit AUD24-002 | `DONE_LOCAL` |
| Autoridade/fingerprint AUD24-003 | `PARTIAL / REOPEN` |
| AUD24-004 e dependentes da autoridade | `BLOCKED_BY_DEPENDENCIES` até reconciliação/fix |
| Known-good PostgreSQL | `LOCALLY_OBSERVED`, sem crédito para matriz negativa/rollback |
| Static/evidência promovível | `FAIL` |
| Programa | `FAIL / REJECT / AAA_NOT_PROVEN` |
| Promoção | `BLOCKED` |

Não promover nem aceitar `AUD24-003` como concluído. A primeira ação é `CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL`: registrar por append a reabertura, invalidar dependentes e recalcular o sujeito depois desta documentação. Em seguida, corrigir a fronteira same-connection e provar a matriz negativa em PostgreSQL real.

Roadmap: [roadmap CVG-AUD25](roadmap-melhorias-cvg-aud25-2026-09-20.md).  
Backlog: [backlog CVG-AUD25](backlog-melhorias-cvg-aud25-2026-09-20.md).
