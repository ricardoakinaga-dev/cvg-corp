# Runbook — provider de modelo indisponível

**Estado:** circuit breaker, roteamento e classificação de erro implementados e exercitados localmente; provider real `NOT_PROVEN`.
**Owner:** AI runtime. **Abortar se:** houver suspeita de vazamento de contexto clínico para provider não autorizado ou divergência entre o provider observado e o aprovado.

Objetivo: diagnosticar indisponibilidade de DeepSeek/local/mock, conter e provar que nenhum contexto clínico cruzou para um provider não autorizado.

## 1. Diferenciar o erro (nem tudo é "provider fora")

`classifyModelError` (`packages/model-runtime/src/index.ts:137`) define a retryabilidade:

| Código | Origem típica | Classificação | Tratamento |
| --- | --- | --- | --- |
| `MODEL_TIMEOUT` | `AbortError`/`PROVIDER_TIMEOUT` (`packages/model-adapters/src/index.ts:292`) | retryable | retry com backoff; kernel para em `TIMEOUT`/`MODEL_TIMEOUT` |
| `MODEL_RATE_LIMITED` | HTTP 429 (`packages/model-adapters/src/index.ts:280`) | retryable | retry com backoff; kernel mapeia para `MODEL_UNAVAILABLE` retryable (`packages/embedded-agent-runtime/src/index.ts:721`) |
| `MODEL_POLICY_DENIED` | HTTP 401/403 (`packages/model-adapters/src/index.ts:279`) | não-retryable, **humanActionRequired** | investigar credencial/contrato; não re-tentar |
| `MODEL_INVALID_RESPONSE` | JSON malformado, tool-call inválido ou JSON pedido e não retornado (`packages/model-adapters/src/index.ts:184,261,271`) | retryable | retry dentro do budget de falhas; kernel reenvia instrução de correção (`packages/agent-kernel/src/index.ts:613-623`) |
| `MODEL_CONTEXT_TOO_LARGE` | HTTP 400 com context/token/length (`packages/model-adapters/src/index.ts:282`) | não-retryable | reduzir contexto/limits; nunca truncar às cegas |
| `MODEL_DEPENDENCY_UNAVAILABLE` | transporte ou credencial ausente (`packages/model-adapters/src/index.ts:168,294`) | retryable | inspecionar secret reference e conectividade |
| `MODEL_UNAVAILABLE` | HTTP >= 500 (`packages/model-adapters/src/index.ts:285`) | retryable | circuito e retry decidem; se persistir, tratar como outage |
| `MODEL_UNKNOWN` | status inesperado | não-retryable, `reconciliationRequired` | abrir investigação; o resultado pode ser desconhecido |

No kernel embarcado (`mapModelError`, `packages/embedded-agent-runtime/src/index.ts:707`), `MODEL_POLICY_DENIED` cai no `default` e vira `DEPENDENCY_UNAVAILABLE` não-retryable; por isso o `AiTurn.status` final pode ser `OUTCOME_UNKNOWN` (`mapTurnStatus`, `packages/embedded-agent-runtime/src/index.ts:1102`) sem revelar a causa. O código original deve ser lido em telemetria/log, não inferido do status do turno.

## 2. Circuit breaker

`ModelRouter` usa `CircuitBreaker` com `failureThreshold: 3`, `resetTimeoutMs: 30_000` e `halfOpenMaxAttempts: 1` (`packages/model-runtime/src/index.ts:291`).

- `OPEN`: `route()` pula o candidato com `CIRCUIT_OPEN` e tenta o próximo, se fallback permitido.
- `HALF_OPEN`: uma única tentativa probe; sucesso fecha (`recordSuccess`), falha reabre (`recordFailure`).
- `recordOutcome` é chamado após cada `complete` (`packages/embedded-agent-runtime/src/index.ts:684,702`).

## 3. Fallback exige policy explícita

- `allowProviderFallback` é `false` por padrão e só muda por opção do runtime (`packages/embedded-agent-runtime/src/index.ts:658`).
- Sem policy, o roteador recusa com `FALLBACK_NOT_ALLOWED` quando precisaria usar candidato secundário (`packages/model-runtime/src/index.ts:337-339`); a negação vira `KernelModelError("DEPENDENCY_UNAVAILABLE")` (`packages/embedded-agent-runtime/src/index.ts:662`).
- Mesmo com fallback permitido, a `dataPolicy` de cada provider limita as classes de dados: `DATA_CLASS_NOT_AUTHORIZED:<classe>` (`packages/model-runtime/src/index.ts:375`).
- O adapter da API hoje configura apenas o provider primário (`createEmbeddedRuntimeAdapter`, `apps/api/src/app.ts:139-145`).

## 4. Desabilitar um provider (kill switch)

`CVG_AI_DISABLED_PROVIDERS` (`packages/config/src/index.ts:78`) chega a `controls().disabledProviders` (`apps/api/src/app.ts:142`) e é avaliado a cada `route()` (`packages/embedded-agent-runtime/src/index.ts:256-257`).

- Provider desabilitado → `PROVIDER_DISABLED`; sem alternativa, `DEPENDENCY_UNAVAILABLE`.
- Exige reinício da API (configuração de boot).
- Nunca remover o provider primário esperando que outro seja escolhido sem decisão registrada.

## 5. Validar que nenhum contexto clínico vazou

1. Coletar `provider` e `model` do turno: `AiTurn.provenance.provider`/`AiTurn.model` (`packages/embedded-agent-runtime/src/index.ts:1162-1170`) e o registro de usage por turno.
2. Conferir as classes efetivamente enviadas: `runState.usedDataClasses` deriva dos itens de contexto (`packages/embedded-agent-runtime/src/index.ts:806`) e a rota usa `allowedFallback` + `dataPolicy`.
3. Conferir `references` e `referencesDigest` do turno; retrieval entra como `RETRIEVED_UNTRUSTED` com provenance e marcação delimitada (`packages/agent-context/src/index.ts:157-159`).
4. Comparar o provider efetivo com o aprovado para a finalidade. Divergência é incidente de segurança: acionar `docs/runbooks/security-incident.md`.
5. `MODEL_POLICY_DENIED` com 401/403 sugere credencial errada: verificar `CREDENTIAL_UNAVAILABLE` em `health()` (`packages/model-adapters/src/index.ts:147`) antes de girar chaves.

## Evidência

- razão da rota e estado do breaker (`PROVIDER_DISABLED`, `CIRCUIT_OPEN`, `FALLBACK_NOT_ALLOWED`, `DATA_CLASS_NOT_AUTHORIZED`);
- `ai_turns` afetados com provider, model, status e `usage.status`;
- classificação observada (`retryable`, `nonRetryable`, `humanActionRequired`) do código real;
- telemetria redigida (`packages/ops`) sem conteúdo clínico.

## O que NÃO fazer

- Nunca habilitar fallback, trocar provider ou relaxar `dataPolicy` para "fazer a IA voltar".
- Nunca re-tentar `MODEL_POLICY_DENIED` em loop: é ação humana.
- Nunca colocar chave em variável de texto, código ou arquivo versionado: usar `SecretProvider` e referência (ex.: `CVG_DEEPSEEK_BEARER_TOKEN_REF`).
- Nunca editar `ai_turns`/usage para esconder turno que chamou provider indevido.
- Nunca assumir custo zero: `costMicros` pode ser `null` e o kernel mantém `costKnown = false` (`packages/agent-kernel/src/index.ts:605`).
