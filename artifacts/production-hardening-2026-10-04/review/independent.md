# Revisão independente delimitada — production hardening

Data: 2026-10-04. Repositório: `/home/ricardo/Área de trabalho/cvg-corp`.
HEAD: `9aab406b164497978b05dd3aa431db49ad11677a`.

**Resultado: FAIL delimitado ao oráculo de zero resíduo, com um achado P2.**
As correções de API, cancelamento/recibo final, materialização da auditoria e inventário não apresentaram outra regressão concreta nesta revisão. Isso não aprova o sistema inteiro nem sua implantação.

## Escopo, critérios e independência

Inspeção dos diffs de `apps/api/src/app.ts`, `packages/integrations/src/index.ts`, `packages/persistence/src/index.ts`, novo `recovery-audit.ts`, três verificadores PostgreSQL e três testes `production-hardening-*.test.ts`. A extensão solicitada inclui somente o diff de `scripts/subject-manifest.ts` e `tests/unit/subject-manifest.test.ts`. Chamadas de exportação, restauração, validação de cadeia, transações e classificação de efeitos foram consultadas apenas para avaliar esses limites.

Modo direto, sem subagentes e sem implementação pelo revisor. A separação é em relação às frentes implementadoras; não foi demonstrada diversidade de modelo nem independência I2/I3. Esta é a continuação do mesmo contexto de revisão, não uma segunda crítica independente.

Critérios derivados do pedido e do plano `.agent/plans/2026-10-04-production-hardening.md`, mantidos sem redução de exigência:

| Critério | Evidência e resultado delimitado |
| --- | --- |
| Entrada HTTP mantém status/contrato e não devolve payload privado | Inspeção e testes HTTP focais: PASS. |
| Cancelamento anterior ao envio não despacha; envio incerto não vira entrega final | Inspeção de `send`, `httpAttempt`, resolver e consumidores; testes com servidor loopback: PASS nos cenários executados. |
| Backup inclui auditoria durável posterior ao snapshot, preservando conteúdo, organização e encadeamento | Inspeção e testes positivos/negativos com cliente SQL simulado: PASS; isolamento concorrente PostgreSQL não foi executado pelo revisor. |
| Digest do snapshot materializado é vinculado ao bundle e manifesto | Inspeção de exportação/validação/restauração e teste focal: PASS. |
| Fixtures RLS ficam em rollback e marcador distingue ausência de linhas de invisibilidade | Helpers têm rollback em `finally`; marcador: **FAIL**, achado PH-REV-01. |
| Diagnóstico de restore não imprime payloads | Diff inspecionado: somente digests, contagens e nomes de campos no novo diagnóstico; nenhum vazamento concreto identificado nesse diff. |
| Inventário aceita exclusão Git sem perder vínculo com index/status/diffs | Diff e cinco testes focais: PASS. |

## PH-REV-01 — P2 / média — marcador de zero resíduo pode aprovar linhas ocultas pela RLS

**Confiança: alta para o defeito de fluxo/escopo; reprodução executável em memória, sem PostgreSQL nesta revisão.**

Local principal: `scripts/verify-postgres.ts:881-886`, especialmente a contagem na linha 883. Origem do escopo incorreto: linha 870. Consumidor do resultado: `scripts/verify-ephemeral-postgres.ts:285-290`.

O cliente usado na contagem é criado com `databaseUrl` na linha 644; essa URL é a conexão de runtime, distinta de `migrationDatabaseUrl` nas linhas 71-75. Antes da verificação de resíduos, a linha 870 muda `cvg.organization_id` para um UUID de outra organização a fim de testar invisibilidade. A linha 881 executa apenas `reset role`. O bloco seguinte consulta os IDs das fixtures sem restaurar organização, unidade e workspace.

Com a conexão de runtime sujeita a RLS, `reset role` não concede bypass nem redefine os parâmetros `cvg.*`. Portanto, uma fixture que tenha escapado do rollback pode continuar fisicamente presente e retornar contagem zero sob a organização estrangeira. O script emite `POSTGRES_RLS_FIXTURE_ROLLBACK_VERIFIED tables=3 rows_remaining=0` mesmo nessa condição. A exigência literal desse marcador pelo wrapper não elimina o falso positivo.

**Impacto:** o novo gate não demonstra aquilo que afirma. Uma regressão futura de rollback pode ser aprovada por esse marcador; a comparação SQL de restore continua sendo uma prova separada. Não foi observado resíduo real nem perda de histórico na execução fornecida, e os helpers atuais efetivamente contêm rollback em `finally`. O achado é sobre a validade do novo oráculo, não uma afirmação de que o banco dos logs foi contaminado.

**Reprodução executada:** o comando abaixo executa o bloco atual de contagem, extraído diretamente do arquivo, com um cliente em memória que aplica a visibilidade por organização. Não conecta a banco, não modifica código e não grava fixtures. Primeiro mantém três linhas existentes sob outra organização; depois usa o escopo correto como controle discriminante; por último verifica o caso sem resíduos.

```bash
GIT_OPTIONAL_LOCKS=0 TSX_DISABLE_CACHE=1 node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const source = readFileSync('scripts/verify-postgres.ts', 'utf8');
const foreignScope = source.split('\n')[869];
assert.match(foreignScope, /set_config\('cvg\.organization_id'.*randomUUID/);
const start = source.indexOf('    await client.query("reset role");\n    for (const fixture of scopedReadFixtures)');
const markerLine = '    process.stdout.write("POSTGRES_RLS_FIXTURE_ROLLBACK_VERIFIED tables=3 rows_remaining=0\\n");';
const end = source.indexOf(markerLine, start);
assert.ok(start > 0 && end > start);
const block = source.slice(start, end + markerLine.length);
const executable = ts.transpileModule(block, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const check = new AsyncFunction('client', 'scopedReadFixtures', 'process', executable);
const changeScope = new AsyncFunction('client', 'randomUUID', foreignScope);
const organizationId = '00000000-0000-4000-8000-000000000001';
const fixtures = ['audit_records', 'command_receipts', 'role_assignments']
  .map((table, index) => ({ table, values: [String(index + 1)], organizationId }));
let scope = organizationId;
let rowsRemaining = fixtures.length;
let marker = '';
const client = { async query(sql, values) {
  if (sql.startsWith("select set_config('cvg.organization_id'")) {
    scope = values[0]; return { rows: [] };
  }
  if (sql === 'reset role') return { rows: [] };
  if (sql.startsWith('select count(*)::int as count from ')) {
    const table = sql.match(/from ([a-z_]+)/)[1];
    const found = fixtures.some(f => f.table === table && f.values[0] === values[0]);
    return { rows: [{ count: found && rowsRemaining > 0 && scope === organizationId ? 1 : 0 }] };
  }
  throw new Error('Unexpected query in isolated RLS witness');
}};
const output = { stdout: { write(value) { marker += value; } } };
await changeScope(client, randomUUID);
await check(client, fixtures, output);
assert.equal(rowsRemaining, 3);
assert.match(marker, /rows_remaining=0/);
console.log('RLS_SCOPE_WITNESS known_bad_rows=3 existing_check=ACCEPTED marker_zero=true transport=IN_MEMORY');
scope = organizationId;
await assert.rejects(() => check(client, fixtures, output), /escaped its rollback transaction/);
console.log('RLS_SCOPE_WITNESS same_scope_control=REJECTED transport=IN_MEMORY');
rowsRemaining = 0;
await check(client, fixtures, output);
console.log('RLS_SCOPE_WITNESS empty_control=ACCEPTED transport=IN_MEMORY');
JS
```

Resultado observado: as três linhas `RLS_SCOPE_WITNESS` acima; processo terminou com exit 0. Esse exit confirma a reprodução do falso positivo, não aprovação do gate. O teste em memória não substitui a execução de RLS pelo PostgreSQL.

**Correção recomendada:** restabelecer explicitamente o escopo completo de cada fixture antes de contar seus resíduos, ou usar uma conexão independente com visibilidade comprovada desses IDs. Validar que uma fixture presente é visível e rejeitada e que a ausência após rollback é aceita. Preservar os históricos e o oráculo SQL de restore. Nenhuma correção foi aplicada pelo revisor.

## Verificações executadas

1. Testes anteriores desta mesma revisão, cujos dez arquivos de escopo mantiveram os hashes registrados:

   ```text
   OTEL_SDK_DISABLED=true TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 tests/integration/production-hardening-api.test.ts tests/integration/production-hardening-integrations.test.ts tests/integration/production-hardening-recovery.test.ts
   exit=0 tests=23 pass=23 fail=0 cancelled=0 skipped=0 duration_ms=3295.303862
   ```

   API: erros de JSON, tipo, tamanho, comprimento e schema, sessão e inbox indisponível. Integrações: cancelamento durante credenciais e após dispatch, dependência pendente, recibo ACCEPTED e configuração/credenciais indisponíveis. Recovery: auditoria posterior, digest, histórico truncado, organização estrangeira, cadeia desconectada e metadados divergentes.

2. Extensão do inventário executada nesta continuação:

   ```text
   GIT_OPTIONAL_LOCKS=0 OTEL_SDK_DISABLED=true TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 tests/unit/subject-manifest.test.ts
   exit=0 tests=5 pass=5 fail=0 cancelled=0 skipped=0 duration_ms=974.025784
   ```

   A nova regressão cobre exclusão sem staging, exclusão staged e reaparecimento como arquivo não rastreado. O diff subtrai somente os paths informados por `git ls-files --deleted`; index, status e diffs completos continuam participando do fingerprint. Não foi executada outra suíte geral.

3. Witness PH-REV-01: bloco de código atual com cliente em memória; conhecido inválido foi aceito sob escopo estrangeiro e rejeitado sob escopo correto; controle vazio aceito. Exit 0. Fonte vinculada pelo SHA-256 de `scripts/verify-postgres.ts` abaixo.

Runtime observado nesta continuação: Node `v24.20.0`. Os testes de inventário criam e removem seus próprios repositórios temporários; não alteram o index ou histórico do projeto revisado.

## Evidências recebidas e inspecionadas, sem reexecutar banco

Os três logs foram lidos e tiveram os bytes vinculados por hash. Seus resultados são evidência fornecida pela frente de implementação; o revisor não iniciou Docker, migrations, restore nem conexões PostgreSQL. Os trechos examinados não incluem um manifesto que vincule a execução a todos os hashes atuais; não se atribui a esses logs uma nova execução independente.

| Arquivo em `artifacts/production-hardening-2026-10-04/database/` | Resultado registrado |
| --- | --- |
| `restore-final.log` | PostgreSQL real, 49 migrations, behavior/restore PASS; 18 casos inválidos antes de conexão/DML; 10 relações SQL exatas; quarentena e revogações registradas; cleanup registrado. O marcador de rollback está sujeito a PH-REV-01. |
| `migration-normalized.log` | Migration e normalized writes PASS; cleanup registrado; demais gates NOT_RUN nessa execução. |
| `all-24-slices.log` | 24/24 slices com paridade de linhas e contagens; replay e rollback PASS; entradas inválidas rejeitadas; autoridade SNAPSHOT_PRIMARY, sem alegação de cutover. |

```text
69870b7086515a212e6819447e0796db169cd4efca018d1491f2fa546948fabb  database/restore-final.log
833b07a44ce5a595f06ff84069bdd3635a64f425a4e9334af646e74bdc394a1c  database/migration-normalized.log
07f038d5ebbc9574b748f205769699d3958aed9b3f925373c0a47e499ec40eb5  database/all-24-slices.log
```

## Hashes do código revisado

SHA-256 dos bytes dos arquivos, incluindo arquivos não rastreados. O HEAD sozinho não identifica este candidato modificado.

```text
c583d63594e60a96daa0213d56267bd5b5b6d2b28789f85b0d21134d36d25e96  apps/api/src/app.ts
8010034d8880f11cae7d0756f08033c239099f11c7e7aecaaf1e64ceab99ec80  packages/integrations/src/index.ts
b4c7965d6a5116a8e7ea6af5380fca23e014acc72e6291c152078acdf2618ee9  packages/persistence/src/index.ts
4ef7965b1a4bc10e7babf9b7fe47612bf28667ccc643c75d857adf6f054b9b04  packages/persistence/src/recovery-audit.ts
319dddff17c5e1fcb2dfc5acb01b48df60872acd1010c30a0f4286fe73658838  scripts/verify-postgres.ts
d64190cd042793b9ca9a730e31890dd89d62ec5bb34d9cb9b6ea7f6f8eb35c02  scripts/verify-postgres-restore.ts
8cba48d268b27336f1854ef6eb85c8daf508382fd04bca41782af99e73f2b375  scripts/verify-ephemeral-postgres.ts
99e827fec3ae05106294974d89594fe7c8ef9e3f639396d04e93336c6318ac68  tests/integration/production-hardening-api.test.ts
b13cacf04291a6c2c5358f618292ab8cd59b3cba9adeb3f7004cef8afd79b3a2  tests/integration/production-hardening-integrations.test.ts
6d801bf01fb4b525b6feea241d54a145cf0109513771487fb04c621606f61797  tests/integration/production-hardening-recovery.test.ts
6d1013c054b6f14f7e04700f0bf2548cb410800a6a01754784ad9e7a112eccf3  scripts/subject-manifest.ts
ba027e80886f9ae3de17aae541138b8825a333fe3d3adf2aae0a2c5ea14fa8ec  tests/unit/subject-manifest.test.ts
```

Sentinela do candidato antes da gravação deste relatório, calculada com `buildSubjectManifest()`:

```text
sha256:9970a499e6ab53738da3eab27fef1cc95d61bd94c765c86a7d256856f91c0840
```

Hashes de preservação de arquivos preexistentes de outras frentes, sem julgamento sobre seu conteúdo:

```text
196f98042879c8da0a294db862cd9c8865df92f6e8457e9997e8c22c099cd3fd  apps/api/src/application/agent-service.ts
5a1b8a9e5291163c3960339b40b7e1efcd3d89f6b253781227f1b3ad5791c551  packages/agent-context/src/index.ts
9c1a135d23dbc14b277ebb3d03fe2aa318d131d21615ec79a25a2e04bc3e3107  packages/domain/src/index.ts
58ec1758a360dde6477f3e3b42bbc9fb1cae11df1a17e47ad1b9f43324ac22f4  packages/embedded-agent-runtime/src/index.ts
fd657de69eaba05756ebd5802b37b37439b2421942daceae2e4ec028813fc0ac  tests/unit/agent-context.test.ts
6fe69cd1416da9f6cec7ca53076c5dfb5e55a642f20552c05378a3404e159290  tests/unit/embedded-runtime.test.ts
```

## Limites e conclusão

Única escrita autorizada no projeto: este relatório. Não foram alterados código, migrations, controladores, históricos, index, MFA ou detector. Não foram criados subagentes. Não foram executados suíte total, build, Docker, banco ou provedores reais por este revisor; os testes HTTP usaram loopback e a recuperação usou cliente SQL simulado. O sentinela global exclui controles e artefatos por definição; não é uma alegação de imutabilidade de arquivos que outras frentes ainda estejam produzindo.

Uma leitura complementar de trechos do wrapper PostgreSQL e das políticas SQL foi bloqueada com a mensagem: “Esta chamada de ferramenta foi bloqueada pela OpenAI porque não foi possível determinar o status de segurança da solicitação.” Essa chamada não foi executada nem repetida por outra ferramenta. O achado usa o fluxo já lido, referências SQL já retornadas e o witness em memória, com esse limite explícito. Algumas buscas anteriores retornaram caminhos inexistentes; não foram tratadas como evidência de ausência de implementação.

A revisão está concluída no escopo solicitado. A ação necessária é corrigir e testar o oráculo PH-REV-01, atualizando a evidência para os novos hashes. Não há, nesta revisão, afirmação de perda/corrupção real de histórico ou liberação integral para produção.

## Conferência final após gravação

Os 12 hashes do escopo e os 6 hashes de preservação foram recalculados e permaneceram iguais; os 3 logs também permaneceram iguais. O fingerprint global após a gravação coincide com o sentinela acima. `git diff --check -- <12 arquivos do escopo>` terminou com exit 0. A única escrita realizada pelo revisor no projeto foi este relatório. A falha PH-REV-01 permanece aberta; nenhuma aprovação de produção foi emitida.
