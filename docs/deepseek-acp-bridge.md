# DeepSeek Harness ACP bridge

O bridge ACP é uma integração opcional com o processo real do DeepSeek Harness. Ele só é criado quando a configuração operacional está completa; sem ela, `/v1/health` permanece `UNAVAILABLE` e nenhum processo filho ou egress é iniciado.

## Contrato de ativação

O deploy precisa fornecer todos estes valores:

```text
CVG_DEEPSEEK_ACP_COMMAND
CVG_DEEPSEEK_ACP_ARGS_JSON
CVG_DEEPSEEK_ACP_ENGINE_ROOT
CVG_DEEPSEEK_ACP_WORKSPACE_ROOT
CVG_DEEPSEEK_ACP_MANIFEST_PATH
CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT
CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION
```

`CVG_DEEPSEEK_ACP_ARGS_JSON` é uma lista JSON, por exemplo `["--import","tsx/esm","apps/cli/src/bin.ts","--profile","acp"]`. O comando é executado sem shell. `ENGINE_ROOT`, `WORKSPACE_ROOT` e `MANIFEST_PATH` devem ser absolutos.

O commit esperado é obtido por `git rev-parse --verify HEAD` no `ENGINE_ROOT`. O manifesto esperado é o digest SHA-256 dos bytes do manifesto, com prefixo `sha256:`; o arquivo também precisa declarar o bundle `@deepseek-ai/dsh-acp-app`. Isso impede que um processo ACP diferente seja tratado como o profile aprovado.

Para o profile local do Harness, a preparação deve ocorrer na imagem/volume de deploy antes de ligar o bridge. Depois de materializar o profile, registre os fatos:

```bash
git -C /srv/deepseek-harness rev-parse --verify HEAD
sha256sum /srv/cvg-dsh-home/profiles/acp/package.json
```

O valor do segundo comando deve ser configurado como `sha256:<digest>`. `CVG_DEEPSEEK_ACP_DSH_HOME` pode apontar para o `DSH_HOME` materializado e `DEEPSEEK_API_KEY` deve chegar ao processo por um provedor de secrets do deploy; ele nunca é escrito no contrato, logs ou telemetria do bridge.

## Garantias e limites atuais

- O transporte é ACP v1 sobre stdio, usando o SDK oficial do protocolo.
- `initialize` e `session/new` são reais; cada sessão CVG fica vinculada ao `sessionId` ACP, contexto autenticado, commit e digest do profile.
- Cancelamento propaga `AbortSignal` para o request ACP. A chave de idempotência é protegida em memória durante o processo e continua sendo governada pela idempotência persistente da aplicação.
- A callback `session/request_permission` responde sempre `cancelled`. O ACP não é uma ponte de decisão CVG: aprovações, promoção de drafts e replay permanecem `CAPABILITY_DISABLED`.
- O ACP atual não expõe o catálogo de tools CVG nem provenance de fontes; por isso o adapter anuncia `tools: []`, não anuncia approvals/replay e não fabrica referências.
- Usage é calculado como delta quando o Harness fornece contadores cumulativos; quando não fornece, fica zero e não é apresentado como medição observada.

O probe local sem API key comprova somente o limite de processo (`initialize`/`session/new`). Ele não comprova chamada real ao modelo, provider veterinário, staging, SLO, recuperação ou AAA. Esses gates continuam bloqueando qualquer veredito `PASS`.
