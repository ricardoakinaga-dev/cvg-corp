# Tentativa de crítica fresh — jobs duráveis e heartbeats — 2026-09-10

**Alvo:** `c3c18de9282159fa25022d7f8ce591889b73445d` (`feat: add durable worker jobs and heartbeats`).
**Critic:** Planck, agent `01a08a06-e3d2-7960-813e-7579d6af42c4`, contexto não herdado, somente leitura.
**Bar:** `.gauntlet/bar-v3.json` e prompt v2 preservado.

## Protocolo e resultado

O sentinela inicial foi `HEAD=c3c18de9282159fa25022d7f8ce591889b73445d` com worktree limpo. O critic recebeu instruções para inspecionar somente migration 031, persistência, worker, recovery, invariantes, testes e limites de evidência, sem editar arquivos ou criar relatório. Uma espera bounded de 60 segundos não produziu parecer; uma solicitação única de encerramento seguida por nova espera de 30 segundos também não produziu relatório. O agent foi encerrado enquanto ainda constava `running`.

Após o encerramento, o sentinela permaneceu `HEAD=c3c18de9282159fa25022d7f8ce591889b73445d` e o worktree continuou limpo. Não foi observada mutação atribuível ao critic.

**Status:** `NOT_COMPLETED`.
**Decisão:** nenhuma decisão `READY_FOR_INTEGRATION`, `NEEDS_CHANGES` ou `BLOCKED` foi inferida pela ausência de resposta; não é aprovação independente.

## Evidência que ainda controla o veredito

Os gates locais do integrador passaram, incluindo `npm test` 135 (`134 pass`, `1 skip`), `test:database` 25/25, typecheck, lint, build, static, PDP, produção estrutural e diff check. A integração nova usa fake pools e handlers sintéticos. PostgreSQL concorrente/RLS executado, worker/container production-like, handlers de negócio, dead-letter operacional, heartbeat observado em staging, CI do SHA, carga/SLO, provider/DeepSeek, recovery operacional e aceite humano continuam sem prova. O resultado global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.
