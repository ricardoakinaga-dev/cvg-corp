# Integração DeepSeek em produção

Status em 2026-09-09: `CURRENT/PARTIAL`, com contrato local verificável e integração nativa real `BLOCKED/NOT_RUN`. Este documento não transforma o port injetado de testes em provider conectado.

## Boundary implementado

O fluxo autorizado é:

```text
CVG AgentRuntime
  -> DeepSeekHarnessAdapter (cliente provider-neutral)
  -> /v1 do apps/deepseek-bridge
  -> DeepSeekNativeHarnessPort
  -> adapter nativo do DeepSeek Harness (ainda não disponível/provado)
```

`packages/deepseek-bridge` contém somente adaptação de protocolo, validação de manifest/commit/catalogo de tools, correlação, deadline, cancelamento, approval, replay, provenance e envelopes de erro. Não contém regra clínica, PDP, execução de tool ou fallback. Sem `nativePort` explícito, o health é `UNAVAILABLE` e qualquer operação é recusada.

Endpoints do contrato CVG:

- `GET /v1/health`
- `POST /v1/sessions`
- `POST /v1/sessions/:id/turns`
- `POST /v1/approvals/:id`
- `POST /v1/drafts/:id/promote`
- `GET /v1/sessions/:id/replay`
- `POST /v1/shutdown`

Falhas retornam `{ schemaVersion, correlationId, error: { code, message, retryable } }`. Em produção, o bridge exige bearer de serviço e assinatura HMAC do contexto, resolvida por `CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF`, antes de aceitar qualquer rota que receba `CvgContext`; isso impede trocar ator, organização, sessão ou escopo somente alterando o JSON. O bridge não registra bearer token, prompt, resposta, segredo ou stack bruto.

## Matriz de contrato

| Caso | Evidência local | Estado de produção |
|---|---|---|
| Port nativo ausente | `UNAVAILABLE`; nenhum Mock implícito | `BLOCKED` |
| Health conhecido-good | teste com port controlado | `NOT_RUN` com Harness real |
| Commit, manifest ou tools divergentes | rejeitado antes de turn | `NOT_RUN` com Harness real |
| JSON/schema de resposta inválido | `INVALID_RESPONSE` | `NOT_RUN` |
| Timeout | `TIMEOUT`, signal abortado, sem retry cego | `NOT_RUN` |
| Cancelamento do cliente | `CANCELLED`, correlation preservada | `NOT_RUN` |
| Approval/replay/provenance | round-trip sintético e validação de vínculo | `NOT_RUN` com dados e modelo reais |
| Modelo/engine real e uso/custo | não executado | `BLOCKED` por adapter nativo, credencial e ambiente |

## Verificação reproduzível

```bash
npm run typecheck
node --import tsx --test tests/unit/deepseek-bridge.test.ts
```

O teste conhecido-good usa uma implementação injetada e explicitamente sintética de `DeepSeekNativeHarnessPort`. Ele prova a fronteira CVG, não disponibilidade do Harness, qualidade do modelo, latência, custo ou segurança de produção.

## Ativação controlada

Antes de habilitar `CVG_DEEPSEEK_RUNTIME_ENABLED=true`, ainda são obrigatórios:

1. adapter nativo compatível com a interface `DeepSeekNativeHarnessPort`, acompanhado de commit, manifest, catálogo de tools, perfil e digest aprovados; o port ACP atual permanece bloqueado para turnos até o ToolGateway governar tools, approval, replay, provenance e egress;
2. URL HTTPS de staging, token entregue por SecretProvider autorizado, rotação e revogação testadas;
3. execução do contrato completo em staging com resposta redigida, correlation, replay, cancel, timeout, refusal, partial, approval e provenance;
4. evidência de OTel, SLO, carga, recovery e revisão independente para o mesmo commit;
5. aprovação humana registrada. Sem esses artefatos, o estado correto permanece `UNAVAILABLE`/`BLOCKED`.

O `/home/ricardo/deepseek-harness` foi inspecionado somente como dependência externa. O commit observado foi `5dda764ed3aa172535a7967b06ff95d9cbfe536a`; não foi encontrado nele um endpoint CVG `/v1` equivalente ao contrato acima e nenhum arquivo externo foi editado.
