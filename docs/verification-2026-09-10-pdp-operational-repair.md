# Verificação — reparo operacional de PDP

Estado global `AAA_NOT_PROVEN`; fase 1 `VERIFIED_LOCAL`. Base Git `e43b3b0032aafb9d17563b1fce00fbae88ee0d51` mais mudanças locais. Não há CI do artifact modificado nesta evidência.

## Resultado executável

- `npm test`: 216 testes, 215 passaram, 1 skip, zero falhas.
- `npm run typecheck`, `npm run lint`, `npm run verify:pdp`, `npm run verify:pdp-universal`, `npm run verify:authoritative-writes`, `npm run verify:audit-chain`, `npm run verify:static`, `npm run build`: exit 0. Lint: 144 fontes; static: 74 artifacts e 146 fontes; PDP: 68 operações, 70 regras e 6 policies de tools; runtime route inventory: 26/26; writes authoritative: 32 coleções e tamper rejeitado.
- Os testes focados cobrem application, inventário HTTP, callback assinado, metrics service, worker policy e tamper-evidence; cada grupo inclui fixtures adversariais independentes.
- `git diff --check`: passou após as mudanças de código.

Raw output e hashes de cada fonte/teste estão em `artifacts/operational-proof/pdp-regression-repaired.txt` e `artifacts/operational-proof/pdp-evidence.json`. Hashes identificam o artifact testado; o SHA base sozinho não representa o worktree modificado. Resultados anteriores (181/1 e 183/1) foram superados por reparos adicionais e não são a evidência final.

## Mudança e razão

O inventário global por regex aceitava uma operação de outro handler ou módulo omitido. O inventário AST recursivo agora compara método/path e operação local, sem aceitar callbacks inertes como vínculo. O inspector de services também aceitava presença sintática de PDP que não guardava a execução. Agora exige chamada inicial executável ou delegation síncrona verificada, inspeciona callable members e defaults e rejeita shadowing da importação de policy. O runtime Fastify foi selado por catálogo real; inbox assinado, métricas e idempotência de assinatura clínica foram movidos para services; jobs duráveis exigem registry de policy antes do handler.

Críticas fresh e read-only foram realizadas por /root/critic_http_inventory, /root/critic_application_guard e /root/critic_final_pdp_slice (I1, forks none). Seus FAILs e reparos estão em `.gauntlet/critique-pdp-operational-20260910.md`. O builder /root/pdp_route_audit não aprovou o próprio trabalho. Aceite restrito dos últimos reparos: /root/critic_pdp_repair_acceptance emitiu PASS, com foco 19/19 e 24 fixtures independentes de shadowing; sentinels inalterados conferidos. O resultado e seus limites estão no registro da crítica e não aprovam a fase universal.

## Limitações e próximo passo

Este é um fechamento local do boundary de autorização e da validação de writes normalizados, sem alegar DeepSeek/provider/staging. Browser completo, PostgreSQL multi-processo, observabilidade externa, carga, chaos, recovery operacional, secrets authority, WebAuthn operacional, CI do mesmo SHA e aprovação humana continuam bloqueadores das fases seguintes. `verify:deepseek-real` e `verify:provider-real` retornam `BLOCKED_EXTERNAL` sem credenciais/endpoints autorizados. O próximo passo depende de infraestrutura externa; o código local permanece fail-closed.
