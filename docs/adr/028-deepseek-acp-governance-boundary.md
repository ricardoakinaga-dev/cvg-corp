# ADR-028 — Governança explícita do port ACP DeepSeek

## Decisão

O processo ACP não recebe autoridade para escolher tools, aprovar operações, persistir turnos ou liberar egress. `DeepSeekAcpNativeHarnessPort` só anuncia `approvals`, `replay` e o catálogo de tools quando recebe uma implementação explícita de `DeepSeekAcpGovernance`.

O contrato de governança deve:

- carregar ou criar a sessão CVG vinculada ao ator, organização, unidade, workspace, finalidade, commit e digest do profile;
- autorizar o turno exato antes do prompt, incluindo tool solicitada, approval, policy revision e idempotência;
- registrar turnos concluídos, negados ou `OUTCOME_UNKNOWN` com usage, provenance e correlation;
- decidir approvals, promover drafts e retornar replay de um ledger durável;
- manter ToolGateway/PDP e egress fora do processo ACP.

Depois de um restart do filho ACP, o port recria somente a sessão protocolar e religa-a a uma sessão CVG carregada pelo governance. Ele não cria uma nova sessão de negócio silenciosamente.

Se o filho emitir `tool_call` sem um executor CVG explicitamente ligado, o port registra `OUTCOME_UNKNOWN` e exige reconciliação. O texto parcial não é convertido em sucesso.

Cancelamento depois do início do prompt segue a mesma regra: o port tenta registrar `OUTCOME_UNKNOWN` antes de devolver `CANCELLED`, preservando a obrigação de reconciliação sem repetir o efeito.

O contrato wire de `AiTurn` é compartilhado por `@cvg/contracts`, bridge e adapter HTTP. Ele valida e transporta provenance e usage persistidos; um resultado ACP não pode ser aceito se esses campos forem descartados no salto de processo. Usage ausente, regressivo ou sem delta positivo também é fail-closed: o port registra `OUTCOME_UNKNOWN`/`RECONCILIATION_REQUIRED` com a razão correspondente.

Bindings ACP são somente da geração atual do processo. Um crash, disconnect ou falha do prompt limpa a associação transitória; o próximo turno religa a sessão CVG durável e não reutiliza o `sessionId` morto. A fila de prompts e o buffer de chunks possuem limites explícitos.

## Consequências

Sem esse adapter, o bridge permanece `UNAVAILABLE` e nenhuma chamada ao modelo é aceita pela fronteira pública. Uma implementação de teste pode satisfazer a interface para verificar protocolo, mas não pode ser promovida: produção exige o ledger PostgreSQL, ToolGateway/PDP, authority de secrets e evidência externa no mesmo artifact.

O contrato evita duas fontes de verdade: o ACP produz apenas texto/usage observado; CVG continua dono de autorização, efeitos, aprovação, auditoria, custo e replay.

## Evidência

- `packages/deepseek-bridge/src/acp.ts`
- `apps/deepseek-bridge/src/server.ts`
- `tests/unit/deepseek-acp.test.ts`
- `docs/deepseek-acp-bridge.md`
