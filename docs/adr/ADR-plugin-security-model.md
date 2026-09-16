# ADR 037 — Modelo de segurança de plugins

**Status:** accepted (allowlist + digest + capabilities; sem hot reload em produção).
**Relacionados:** itens 13–14, 58–61 do prompt · [threat model](../agent-runtime-threat-model.md).

## Contexto

Plugins são código potencialmente perigoso. O harness upstream carrega plugins como pacotes npm
in-process (autoridade total) e o runner dinâmico declara explicitamente que `node:vm` **não é
boundary de segurança**. O CVG não pode reproduzir esse modelo.

## Decisão

1. **Contrato mínimo** (`packages/agent-plugins`):

   ```ts
   interface AgentPlugin {
     manifest: AgentPluginManifest;
     initialize(context: AgentPluginContext): Promise<void>;
     capabilities(): readonly string[];
     hooks(): readonly AgentPluginHook[];
     shutdown(): Promise<void>;
   }
   ```

2. **Manifesto obrigatório**: `name`, `version`, `publisher`, `digest` (sha256 do conteúdo
   registrado), `permissions[]`, `capabilities[]`, `dependencies[]`, `apiVersion`, `risk`
   (`LOW|MEDIUM|HIGH|UNTRUSTED`).
3. **Sem autoridade ambiente**: `initialize` recebe apenas capabilities concedidas pelo runtime
   — `logger`, `metrics`, `scopedConfig`, `approvedToolClient` (que passa pelo Tool Gateway),
   `clock`. Nunca `database`, `filesystem`, `secrets` ou `httpClient`.
   Princípio: *no ambient authority*.
4. **Verificação antes de carregar**: allowlist explícita por nome+versão, digest conferido,
   `apiVersion` compatível, dependências resolvidas (grafo entre *capabilities*, não entre
   plugins), detecção de ciclos, conflitos de versão/capability. Falha ⇒ startup fail-closed
   para o plugin; plugin `FAILED` não oferece capabilities.
5. **Lifecycle**: `DISCOVERED → VALIDATED → LOADED → INITIALIZED → READY`, com `DEGRADED`,
   `DISABLED`, `FAILED`. Transições auditadas.
6. **Sem hot reload em produção**; a única forma de mudar o conjunto é deploy validado.
7. **Isolamento adicional por risco**: plugins `HIGH`/`UNTRUSTED` exigem aprovação de carregamento
   e são desabilitáveis por kill switch; sandbox pesado (worker/VM/WASM) só será considerado se
   um plugin real de risco justificar — não é adicionado preventivamente.

## Consequências

- Nenhum plugin pode executar efeito de domínio diretamente; a única ponte é o Tool Gateway.
- Manifestos e digests são registrados no runtime manifest e na provenance.
- O gate `verify:plugins` cobre manifesto inválido, digest errado, capability ausente, permissão
  proibida, ciclo de dependência, crash de inicialização e falha de shutdown.
