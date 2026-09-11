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
CVG_DEEPSEEK_BEARER_TOKEN_REF
CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF
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
- O bridge HTTP exige bearer de serviço e assinatura HMAC do contexto em produção; o segredo de assinatura é resolvido por SecretProvider e nunca é transportado no payload.
- Cancelamento propaga `AbortSignal` para o request ACP. A chave de idempotência do turno e das tools precisa ser resolvida pelo `DeepSeekAcpGovernance`; o port mantém somente locks transitórios por sessão e nunca promove seu mapa em memória a ledger de produção.
- Se o prompt já começou quando o cliente cancela ou o canal cai, o port tenta registrar `OUTCOME_UNKNOWN` antes de devolver `CANCELLED`; a reconciliação continua obrigatória e não há retry cego.
- O port ACP exige um `DeepSeekAcpGovernance` injetado para anunciar `approvals`, `replay` e qualquer tool. Esse contrato é a autoridade CVG para catálogo, autorização, registro durável de turnos/uso, aprovação, promoção e replay; o processo ACP nunca recebe essas decisões.
- Sem `governance`, o port continua em `CAPABILITY_DISABLED` para turnos, approval, promoção e replay. Com `governance`, cada turno revalida o engine/profile da sessão e é autorizado antes do prompt; resultados concluídos ou desconhecidos são registrados pelo ledger fornecido e o port revalida policy, sessão e correlation antes de responder.
- Se o processo ACP emitir `tool_call` ou `tool_call_update` sem um executor CVG explícito, o turno é registrado como `OUTCOME_UNKNOWN` com reconciliação obrigatória; uma notificação ACP não pode ser tratada como execução autorizada.
- `DeepSeekAcpGovernance` ainda é uma seam de composição: o processo do bridge não cria automaticamente um ledger PostgreSQL nem um ToolGateway. A implementação production-like precisa ser injetada pelo deploy e deve usar os adapters duráveis do CVG; não há promoção implícita de um adapter sintético.
- A callback `session/request_permission` responde sempre `cancelled`. Permissão ACP não substitui approval CVG; nenhuma ferramenta ou egress é liberado por essa callback.
- O catálogo anunciado vem exclusivamente de `governance.toolNames`; sem ele o adapter anuncia `tools: []`. Provenance de fontes e usage só são aceitos quando o governance retorna o turno persistido com vínculo ao commit, manifest, policy e correlation atuais.
- O wire de `AiTurn` é validado por um schema compartilhado entre contracts, bridge e adapter e preserva `turn.provenance`/`turn.usage` através do processo HTTP. Usage é calculado como delta quando o Harness fornece contadores cumulativos; ausência, regressão ou delta zero do contador produz `OUTCOME_UNKNOWN` (`ACP_USAGE_UNAVAILABLE`, `ACP_USAGE_COUNTER_REGRESSION` ou `ACP_USAGE_ZERO`) e usage em reconciliação, nunca `SETTLED` com `0/0`.
- O `turn.usage.settlement` tipado vincula modelo, tokens, digest da resposta, custo estimado/efetivo e discrepância. Pricing ausente é `UNAVAILABLE`/`NOT_EVALUATED`, nunca custo zero implícito; o fixture local usa `LOCAL_SYNTHETIC` explicitamente.
- Após crash, disconnect ou erro do prompt, os bindings ACP transitórios são invalidados antes de qualquer reuso. O próximo turno carrega a sessão CVG durável e cria um novo `sessionId` protocolar. A fila por sessão e o buffer de texto têm limites; excesso vira `OUTCOME_UNKNOWN`.

O probe local sem API key comprova somente o limite de processo (`initialize`/`session/new`). Ele não comprova chamada real ao modelo, provider veterinário, staging, SLO, recuperação ou AAA. Esses gates continuam bloqueando qualquer veredito `PASS`.
