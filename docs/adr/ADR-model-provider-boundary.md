# ADR 036 — Boundary de ModelProvider

**Status:** accepted.
**Relacionados:** [ADR 009](009-deepseek-harness-external-runtime.md) · itens 10–12, 68–72 do prompt.

## Contexto

O CVG possui hoje `AgentRuntime` como porta e adapters que falam com o harness externo. Não
existe abstração tipada de *provider de modelo*. O programa exige separar definitivamente
Harness de modelo e provar `Harness != DeepSeek`.

## Decisão

1. Criar `packages/model-runtime` com o contrato:

   ```ts
   interface ModelProvider {
     readonly providerId: string;
     health(signal?: AbortSignal): Promise<ModelProviderHealth>;
     capabilities(): ModelProviderCapabilities;
     dataPolicy(): ModelProviderDataPolicy;
     complete(request: ModelRequest, options): Promise<ModelResponse>;
     stream(request: ModelRequest, options): AsyncIterable<ModelStreamEvent>;
     cancel(requestId: string): boolean;
   }
   ```

2. Capabilities declaradas: `toolCalling`, `structuredOutput`, `streaming`, `reasoning`, `vision`,
   `contextWindow`, `maxOutput`. O kernel **falha fechado** quando uma capability obrigatória não
   existir.
3. `ModelRouter` decide o provider por política declarada (task, risco, classe de dados,
   capability, orçamento, disponibilidade). Nunca escolhe provider não autorizado para a classe
   de dados; fallback só com `policy.allowsFallback` + capabilities + data policy compatíveis.
4. Providers implementados pelo CVG: `MockModelProvider` (determinístico, CI), `DeepSeekModelProvider`
   (HTTP chat-completions, SSE, tool calls, usage), `LocalModelProvider` (endpoint OpenAI-compatible
   local; prova de substituição).
5. Regras absolutas:
   - nenhuma regra de negócio nos adapters (apenas mapeamento);
   - credencial pertence ao adapter/provider, nunca ao agente, skill, plugin ou Context Builder;
   - `providerId` entra em provenance; troca de provider não altera domínio nem tools;
   - o harness externo continua acessível **apenas** pelo `DeepSeekHarnessAdapter` (`AgentRuntime`),
     como runtime, e não como provider de modelo do kernel embarcado.
6. `dataPolicy` declara `allowedDataClasses`, `region`, `retention`, `training`, sem inventar
   garantias: valores desconhecidos são `UNKNOWN` e restringem o roteamento.

## Consequências

- Trocar DeepSeek por Mock/Local é um teste arquitetural executável.
- O PDP governa ações; a data policy governa o que pode ser enviado ao modelo — os dois são
  verificados antes do envio (firewall de contexto).
- Nenhum SDK de fornecedor entra nas camadas de domínio/aplicação.
