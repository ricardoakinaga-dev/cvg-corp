# Error taxonomy vNext

As respostas HTTP usam envelope versionado, correlation ID e os códigos estáveis de `packages/contracts`. Mensagens são seguras para o cliente; stack trace, segredo, prompt e payload clínico não atravessam a fronteira.

| Família | Código CVG | Comportamento |
|---|---|---|
| validação | `INVALID_INPUT` | rejeita schema/campos desconhecidos |
| autenticação | `UNAUTHENTICATED` | exige nova sessão sem revelar existência |
| autorização | `FORBIDDEN`, `POLICY_DENIED` | nega escopo, role, finalidade ou policy |
| recurso/concorrência | `NOT_FOUND`, `CONFLICT`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` | não repete ou sobrescreve silenciosamente |
| limite | `RATE_LIMITED`, `BUDGET_EXCEEDED` | aplica janela/hard stop |
| dependência | `DEPENDENCY_UNAVAILABLE`, `CREDENTIAL_UNAVAILABLE`, `EGRESS_DENIED` | falha fechada |
| integração | `OUTCOME_UNKNOWN`, `DUPLICATE_DELIVERY`, `CLAIM_ABANDONED` | reconcilia por receipt; não faz retry cego |
| governança | `APPROVAL_REQUIRED`, `APPROVAL_REPLAY`, `POLICY_STALE`, `CAPABILITY_DISABLED` | mantém operação bloqueada |
| integridade | `QUARANTINED`, `INVALID_STATE`, `COMPOSER_CONTEXT_LOST` | preserva evidência e impede exposição/efeito |
| interno | `INTERNAL_ERROR` | mensagem genérica e diagnóstico somente em telemetria redigida |

Aliases narrativos da especificação (`VALIDATION_ERROR`, `AUTHENTICATION_FAILED`, `AUTHORIZATION_DENIED`, `RESOURCE_NOT_FOUND`, `CORRUPTED_STATE`) devem ser mapeados para os códigos CVG acima no contrato público, sem alterar o significado ou vazar detalhes internos.
