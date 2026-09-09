# AI runtime vNext

## Boundary

O domínio CVG permanece a fonte de verdade. A cadeia pretendida é:

```text
HTTP → application service → AgentRuntime → HarnessAdapter → provider autorizado
                         ↘ ToolGateway/PDP → audit/receipt/outbox
```

`packages/agent-runtime` define lifecycle, health, turn, approval, promoção, replay e shutdown. `packages/harness-adapters` contém o Mock determinístico e o adapter DeepSeek opcional.

## Segurança operacional

O Mock exige contexto e policy, controla budget, põe prompt injection em quarentena e produz provenance/replay. O Tool Gateway registra seis tools com risco, capability, roles, classes de dados, aprovação, timeout, idempotência e audit action. Tools de impacto alto exigem aprovação independente.

O adapter DeepSeek falha fechado quando URL, commit, manifest, health ou conjunto de tools não correspondem ao contrato aprovado. A ponte CVG usa endpoints `/v1`; isso não deve ser descrito como protocolo nativo do repositório externo até existir uma prova de integração autorizada.

## Evidência e limites

Os testes locais cobrem lifecycle Mock, mismatch de health, digest determinístico, aprovação, timeout `OUTCOME_UNKNOWN`, secret references e catálogo. Não foram executados processo DeepSeek real, cancelamento entre instâncias, carga, provider externo, receipt real, reconciliação externa ou vertical Appointment → comunicação → aprovação → provider.

**Estado:** `PASS_WITH_LIMITATIONS` para runtime sintético; `NOT_RUN` para integração externa e produção.
