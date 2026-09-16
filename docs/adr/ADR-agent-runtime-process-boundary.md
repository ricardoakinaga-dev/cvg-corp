# ADR 035 — Process boundary do Agent Runtime

**Status:** accepted (in-process library + portas explícitas; processo standalone deferido para staging).
**Relacionados:** [ADR 034](ADR-agent-runtime-embedding-decision.md) · [ADR 001](001-agent-runtime-boundary.md) · item 50–51 do prompt.

## Contexto

Mesmo com o runtime embarcado no mesmo repositório, `CODE OWNERSHIP ≠ PROCESS BOUNDARY`. É
preciso decidir formalmente onde cada componente executa: in-process, worker-thread,
child-process, sidecar ou processo standalone.

## Opções

| Opção | Segurança | Latência | Operabilidade | Blast radius | Complexidade |
| --- | --- | --- | --- | --- | --- |
| In-process (biblioteca) | Depende de portas e PDP; sem isolamento de memória | Mínima | Uma stack, um release | Falha do kernel pode afetar o processo da API se não for fail-closed | Baixa |
| Worker-thread | Isolamento parcial de CPU; shared memory | Baixa | Debug mais difícil | Médio | Média |
| Child-process/sidecar | Isolamento de processo; requer contrato IPC + auth | Média | Duas unidades de deploy, health próprio | Baixo | Alta |
| Processo standalone (`apps/agent-runtime`) | Isolamento real; rede + auth + TLS internos | Média/alta | Pipeline próprio, image própria | Baixo | Alta |

## Decisão

1. **Fase 1 (este programa): biblioteca in-process com portas explícitas.** O runtime embarcado
   executa no processo da API/worker, mas:
   - não recebe acesso ambiente (nada de fs/rede/secrets/DB direto): todo I/O passa por portas
     tipadas (`ModelProvider`, `AgentSessionStore`, `ToolGateway`, `BudgetPort`, `Clock`);
   - é **fail-closed**: indisponibilidade resulta em `AI_DEGRADED`, nunca em queda do sistema;
   - readiness de IA é separada da readiness geral (`/api/v1/ai/ready` vs `/api/v1/ready`);
   - kill switches e safe mode podem desligá-lo sem tocar no domínio.
2. **Fase 2 (staging): processo standalone opcional.** O contrato entre API e runtime já é
   tipado e serializável por desenho (nenhum objeto de domínio cru atravessa a porta), então a
   extração para `apps/agent-runtime` é uma mudança de transporte, não de arquitetura. A
   implementação do processo é deferida até haver ambiente de staging autorizado, porque:
   - não há prova local de isolamento de processo (Docker indisponível neste ambiente);
   - adicionar IPC/rede/auth/TLS internos sem staging aumenta superfície sem evidência;
   - o princípio de simplicidade (item 616) prefere a arquitetura mais simples que satisfaça os
     invariantes, e os invariantes de blast radius são satisfeitos por fail-closed + readiness
     separada + kill switches.

## Invariantes obrigatórios (verificados por testes)

- `packages/agent-kernel` não importa `@cvg/domain`, `@cvg/persistence`, `pg`, `node:fs`,
  `node:net` nem `@cvg/agent-tools` diretamente; conhece apenas contratos abstratos.
- O runtime embarcado nunca executa SQL, HTTP de negócio ou acesso a filesystem.
- Nenhuma sessão é executada por duas instâncias: lease + fencing token no
  `AgentSessionStore` (`docs/adr/ADR-agent-session-persistence.md`).
- Domínio não conhece runtime nem provider (teste de dependência `verify:architecture`).

## Consequências

- O mesmo repositório, release e governança cobrem o runtime (sem segundo produto).
- Latência local para fluxos de recepção/hospitalização.
- Promoção a processo separado é reavaliada com evidência de staging; se aprovada, nenhum caller
  muda (apenas o binding da porta).
