# Critique final fresh — arquitetura, segurança, autorização/PDP e domínio

Data: 2026-09-11  
Escopo: `docs/prompt-final-operational-proof-2026-09-10.txt` contra `.gauntlet/bar-v4.json`  
Modo: audit-only; nenhum código, migration, configuração ou teste foi alterado intencionalmente. A criação deste relatório foi a única escrita autorizada.

## Conclusão

**FAIL** para a barra global/Triplo AAA. O recorte local de arquitetura, PDP e invariantes é **PASS_WITH_LIMITATIONS**, mas a barra v4 exige evidência atual de todos os gates; seus hard blockers continuam sem prova. Não há staging autorizado, endpoints externos, credenciais/Secret Authority, sink real, modelo DeepSeek real ou aprovação humana criptograficamente atestada neste workspace.

## Critérios e checks executados

- Arquitetura/PDP: rota catalogada, policy de application/tool/worker, fail-closed e ausência de route-to-persistence direta.
- Segurança/autorização: sessão, CSRF, revisão de policy, organização/unidade/workspace, aprovação independente, MFA/WebAuthn e rejeição de contexto forjado.
- Domínio: invariantes authoritative de 32 coleções, relações pai/filho, organização e quarentena diagnóstica.
- Comandos executados: `npm run verify:pdp-universal` (PASS, 68 operações/70 regras/6 tools; 26 testes de catálogo), `npm run verify:authoritative-writes` (PASS, 32 domínios), `npm run test:security` (PASS, 28/28) e testes focados PDP/domínio/auth/security (PASS, 46/46).
- A evidência de `docs/pdp-universal-proof.md:13,19,21-26` declara que o analisador é estrutural, não resolve o call graph completo e que `requestContext` não prova dominância sobre todos os efeitos. `docs/authoritative-write-proof.md:3,13` e `docs/final-operational-proof-audit.md:17-18,21,39-42` limitam as provas ao boundary/local e deixam staging/multi-instância externos.

## Findings

### CRITICAL

**C-01 — gates de promoção e operação real continuam ausentes.**  `.gauntlet/bar-v4.json:55-65` torna blockers obrigatórios: DeepSeek/provider/secret authority reais, PostgreSQL/load/chaos/recovery/RTO/RPO production-like, container/observabilidade/headers staging, provenance same-SHA, critic independente e aprovação humana. A reauditoria atual confirma `BLOCKED_EXTERNAL`, `NOT_RUN` ou `PARTIAL` em `docs/final-operational-proof-audit.md:19-35`. Qualquer declaração de `STATE_OF_THE_ART_CANDIDATE`, `TRIPLE_AAA_CANDIDATE` ou `PRODUCTION_READY` seria overclaim.

**C-02 — integridade do julgamento read-only foi invalidada pelo mutation sentinel.**  Fingerprint pré-check: `07a84cbf95ba070224bc6c8fb2a915c411ff907ba3c03d2323f40b30b1129228`; pós-check: `f1079a5eabb5ed8bd8d34a838f0a20bea2c0c9aa64838dfb9faee6fb92a96232`. O diff identificou regravação de `artifacts/operational-proof/resource-pressure-local.json`, `runbook-execution-local.json`, `security-red-team-local.json`, `docs/final-operational-proof-audit.md`, `docs/triple-aaa-final-scorecard.md` e `docs/verification-2026-09-10-local-closure.md`. Como o protocolo exige invalidar a crítica quando o sentinel diverge, este relatório não pode ser tratado como aprovação independente do artifact.

### HIGH

**H-01 — PDP universal prova admissão/padrões locais, não dominância de autorização em todos os efeitos.** O gate verde é útil, porém o próprio proof registra limitações de wrappers, reexports, aliases/mutação dinâmica e data-flow (`docs/pdp-universal-proof.md:13,19`). Um novo caminho indireto pode alcançar persistence sem ser rejeitado pelo analisador. Aceite pendente: evidência de call graph/data-flow cobrindo wrappers/reexports e execução em artifact same-SHA; manter o gate externo bloqueado até lá.

**H-02 — authoritative writes e RLS não têm evidência production-like/staging.** A prova de 32 coleções é local (`docs/final-operational-proof-audit.md:18`); PostgreSQL efêmero local não demonstra multi-instância, takeover, carga, chaos, RTO/RPO ou promoção (`docs/final-operational-proof-audit.md:21,40`). O risco abrange divergência de tenant/unit/workspace, replay e efeitos duplicados sob operação real. Aceite pendente: PostgreSQL autorizado em staging multi-instância, testes de concorrência/restart e evidência vinculada ao mesmo SHA.

**H-03 — a superfície canônica do domínio é mutável por qualquer consumidor interno.** `CvgStore` expõe `public readonly Map` para usuários, relações, receipts, pacientes, diagnósticos, finanças e IA (`packages/domain/src/index.ts:225-267`); `AgentApplicationService.persistRuntimeResult` grava diretamente em `aiSessions`, `aiTurns`, `aiDrafts` e `aiApprovals` (`apps/api/src/application/agent-service.ts:121-126`). `readonly` impede apenas reatribuição da propriedade, não `.set`/mutação dos registros. Isso deixa um bypass arquitetural possível das invariantes/PDP se qualquer novo consumidor interno usar os mapas, contrariando a soberania do domínio. Aceite pendente: encapsular escrita atrás de ports/commands authoritative e teste que rejeite mutation direta.

**H-04 — autenticação forte e aprovação humana só têm boundary local.** Os testes criptográficos locais passaram, mas a própria matriz marca secrets/WebAuthn como `PARTIAL` e red-team como `VERIFIED_LOCAL / BLOCKED_EXTERNAL` (`docs/final-operational-proof-audit.md:23,29`). Não há authority externa, passkey independente, execução operacional de aprovação humana ou prova de promoção. Isso impede afirmar que autorização, break-glass e release approval têm uma raiz de confiança operacional.

## Limitações explícitas

Não foi possível executar staging, rede/egress autorizado, credenciais reais, Secret Authority, provider externo, turno/modelo DeepSeek real, collector/alert delivery/SLO, carga/chaos/recovery production-like, container smoke live, CI same-SHA do worktree atual, revisão assistiva independente ou aceite humano. Os testes locais exercitados são sintéticos/efêmeros e não substituem esses gates.

## Veredicto do critic

Independência: I1, fresh-context nesta tarefa, leitura contra o prompt e a barra v4.  
Mutation sentinel: **MISMATCH — julgamento de integridade INVALIDATED**; preservar o worktree para inspeção do Lead.  
Resultado global: **FAIL**. O caminho seguro seguinte é repetir os checks sem gerar artifacts no checkout, depois obter as provas externas same-SHA e a revisão/aprovação independente exigidas pela barra.
