# Runbook — falha de plugin do agente

**Estado:** plugin runtime implementado e exercitado apenas localmente (`npm run verify:embedded-harness` PASS, 43 testes focados); nenhum plugin de produção carregado `NOT_RUN`.
**Owner:** AI runtime. **Abortar se:** o digest/allowlist não corresponder ao manifesto, ou se uma capability estiver exposta por plugin em `FAILED`/`DISABLED`.

Objetivo: responder a plugin `FAILED`/`DEGRADED` sem criar autoridade paralela e sem manter capability degradada ativa.

## 1. Ciclo de vida e o que cada estado significa

`PluginLifecycleState` (`packages/agent-plugins/src/index.ts:71`): `DISCOVERED` → `VALIDATED` → `LOADED` → `INITIALIZED` → `READY`, com desvios `DEGRADED`, `DISABLED`, `FAILED`.

| Estado | Significado operacional |
| --- | --- |
| `VALIDATED` | manifesto/digest/allowlist/permissões aceitos; ainda não inicializou |
| `LOADED` | dependências resolvidas; inicialização em andamento |
| `READY` | capabilidades e hooks ativos |
| `DEGRADED` | ainda expõe capabilidades/hooks (`availableCapabilities()` inclui `DEGRADED`) |
| `DISABLED` | desligado; capabilidades zeradas |
| `FAILED` | **nunca** expõe capabilidade (`availableCapabilities()` filtra `packages/agent-plugins/src/index.ts:250`) |

Nota: o tipo prevê `DEGRADED` e os filtros de capability/hook o tratam como ativo, mas no código atual nenhuma transição atribui esse estado — trate uma ocorrência observada como sinal a investigar, não como estado esperado.

## 2. Classificar a falha de registro

`PluginRuntime.register` falha fechado com `reason` explícito (`packages/agent-plugins/src/index.ts:140-153`):

- `INVALID_MANIFEST_NAME` / `INVALID_MANIFEST_VERSION` / `INCOMPATIBLE_API_VERSION`;
- `FORBIDDEN_PERMISSION:<permissão>` — as permissões válidas são apenas `logger`, `metrics`, `scoped-config`, `approved-tools`, `clock` (`AGENT_PLUGIN_PERMISSIONS`, linha 15);
- `MANIFEST_DIGEST_MISMATCH` / `ALLOWLIST_DIGEST_MISMATCH` — o digest fixa o manifesto efetivo;
- `NOT_ALLOWLISTED` — nome+versão fora da allowlist;
- `RISKY_PLUGIN_NOT_APPROVED` — risco `HIGH`/`UNTRUSTED` exige aprovação explícita (`approvedRiskyPlugins`).

## 3. Falha de inicialização, dependências e ciclos

- `initializeAll()` resolve dependências antes de inicializar. Se `resolveDependencies().ok` for falso, todo plugin `VALIDATED` vira `FAILED` com `DEPENDENCY_RESOLUTION_FAILED` (`packages/agent-plugins/src/index.ts:205-212`).
- Falha de `initialize()` marca o plugin como `FAILED` com a mensagem e incrementa `failures` (linhas 226-228).
- `resolveDependencies()` retorna `order`, `cycles`, `missing` (`{plugin, capability}`), `conflicts` (`{capability, providers}`) e `ok` (linhas 160-203). Conflito de versão de capability é falha de startup, não warning.
- Plugin `FAILED` não oferece capabilidades e seus hooks nunca são executados (`hooks(phase)` filtra por `READY`/`DEGRADED`, linhas 259-264).

## 4. Kill switch

- API do runtime: `await pluginRuntime.disable(name, reason)` — executa `shutdown()` (best-effort), remove todos os hooks e zera `capabilities` (`packages/agent-plugins/src/index.ts:233-248`). É o caminho suportado de contenção.
- `EmbeddedRuntimeControls.disabledPlugins` existe no contrato (`packages/embedded-agent-runtime/src/index.ts:149`) e o adapter da API o envia como lista vazia (`apps/api/src/app.ts:142`). Não existe variável de ambiente `CVG_AI_DISABLED_PLUGINS` no schema de config, e o runtime embarcado ainda não consulta `disabledPlugins` — declarar isso como lacuna conhecida, não como capacidade.
- Desabilitar não reabilita automaticamente: só um novo registro com digest/allowlist revisados.

## 5. Auditoria

- `PluginRecord` (`failures`, `reason`, `updatedAt`, `capabilities`) e `snapshot()` ordenado por nome (`packages/agent-plugins/src/index.ts:266`).
- Logger do plugin redige metadados com aparência de segredo (`secret|token|password|credential`, linhas 286-293).
- Permissões ausentes viram no-ops: sem `logger`/`metrics`/`approved-tools`, o contexto entrega implementações vazias (`buildContext`, linhas 283-303).

## Evidência

- `snapshot()` do `PluginRuntime` antes/depois com `state`, `reason` e `failures`;
- `resolveDependencies()` completo (ordem, ciclos, ausentes, conflitos);
- resultado de `npm run verify:embedded-harness` (inclui `tests/unit/agent-plugins.test.ts`);
- registro de auditoria/deploy do momento da mudança de allowlist ou do disable.

## O que NÃO fazer

- Nunca editar allowlist/digest em runtime para "destravar" um plugin; o digest é o contrato de integridade.
- Nunca reabilitar plugin `FAILED` sem nova versão, novo digest e revisão registrada.
- Nunca conceder permissões fora de `AGENT_PLUGIN_PERMISSIONS` (ex.: `database`, filesystem, HTTP irrestrito): o contrato não as oferece (`packages/agent-plugins/src/index.ts:143-145`).
- Nunca ignorar `cycles`/`conflicts`: o startup é fail-closed por desenho.
- Nunca remover evidência de falha (`reason`/`failures`) nem apagar registros de auditoria.
