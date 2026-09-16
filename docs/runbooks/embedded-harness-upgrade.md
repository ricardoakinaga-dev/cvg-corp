# Runbook — upgrade do runtime embarcado

**Estado:** fluxo documentado; nenhum upgrade real executado `NOT_RUN`. Nenhum arquivo do upstream foi incorporado (`npm run verify:embedded-harness` → `embeddedFiles=0`).
**Owner:** AI runtime + segurança. **Abortar se:** o commit upstream não estiver identificado, o diff não tiver sido lido ou o novo commit não tiver sido exercitado contra a ponte.

Objetivo: promover mudanças do runtime embarcado e acompanhar o upstream externo sem *blind update*. O CVG decide `HYBRID` (`docs/adr/ADR-agent-runtime-embedding-decision.md`): o runtime do produto é CVG-owned e o upstream DeepSeek permanece processo externo via contrato `/v1`.

## 1. Escopo de cada tipo de mudança

| Mudança | O que revisar |
| --- | --- |
| Pacotes CVG (`agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`, `agent-skills`, `model-runtime`, `model-adapters`, `embedded-agent-runtime`) | invariantes de arquitetura, testes focados, gates locais |
| Upstream DeepSeek (produto externo) | contrato `/v1`, adapter `DeepSeekHarnessAdapter`, correções de segurança ao operar o processo |
| Ponte CVG (`apps/deepseek-bridge`, `packages/deepseek-bridge`) | schema v1 e envelope; mudança exige ADR |

Referências obrigatórias: `docs/third-party/deepseek-harness-upstream.md` (registro de importação, procedimento de diff, política de atualização) e `docs/embedded-harness-audit.md` (mapa de componentes e limitações).

## 2. Fluxo (nunca *blind update*)

```text
upstream update
  → diff + release notes
  → revisão de licença (só se houver intenção de incorporar código)
  → revisão de segurança
  → compatibilidade do contrato /v1
  → atualizar expectedEngineCommit / expectedManifestVersion
  → testes focados (deepseek-bridge, deepseek-acp, harness-adapters)
  → regressão completa + shadow (quando aplicável)
  → promoção explícita
```

Passos:

1. **Triagem**: identificar release/commit e escopo. Registrar `5dda764ed3aa172535a7967b06ff95d9cbfe536a` como baseline atual (`docs/third-party/deepseek-harness-upstream.md`).
2. **Diff**: `git -C /home/ricardo/deepseek-harness fetch deepseek-official`; `git log --oneline 5dda764ed3..deepseek-official/main`; `git diff --stat 5dda764ed3..deepseek-official/main`. Como não há código embarcado, o diff informa apenas impacto no contrato `/v1`, segurança operacional do processo externo e breaking changes.
3. **Licença**: se (e somente se) houver intenção de incorporar código, revisar licença e NOTICE. A decisão vigente é não incorporar.
4. **Segurança**: revisar CVEs/dependências nativas e release notes de segurança. O scanner de CVE do upstream ainda não foi executado (limitação registrada em `docs/embedded-harness-audit.md` §1): executá-lo é pré-requisito de qualquer promoção que dependa do upstream.
5. **Compatibilidade**: verificar schema v1 da ponte, `adapterId: deepseek-harness-http`, campos de provenance e ACP `read-only` (`CVG_DEEPSEEK_ACP_*`).
6. **Config esperada**: só atualizar `CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT`/`CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION` **depois** de exercitar o novo commit contra a ponte. Nunca antes; nunca com placeholder (`^0{40}$` é rejeitado, `packages/config/src/index.ts:121`).
7. **Testes focados**: `scripts/verify-deepseek-acp.ts`, `tests/unit/deepseek-bridge.test.ts`, `tests/unit/deepseek-acp*.test.ts`, `tests/unit/agent-*`, `tests/unit/embedded-runtime.test.ts`, `tests/unit/model-*`.
8. **Gates locais**: `npm run verify:agent-runtime`, `npm run verify:embedded-harness`, `npm run verify:agent-security`, `npm run verify:architecture`, `npm run verify:ai-disabled`, `npm run verify:claims`.
9. **Shadow**: comparar respostas/replay entre runtime embarcado e externo em ambiente sintético (`replay`/`replayDigest`, `packages/agent-runtime/src/replay-digest.ts`), sem efeitos externos.
10. **Promoção**: registrar evidência, limites conhecidos e plano de rollback (`docs/runbooks/agent-runtime-rollback.md`). Promoção a staging/produção exige aprovação humana. O modelo de fases (LAB → SHADOW → STAGING → CANARY → PRODUCTION) está em `docs/embedded-runtime-rollout.md`, que declara LAB local, SHADOW parcial sintético e STAGING em diante `BLOCKED_EXTERNAL`/`NOT_PROVEN`; enquanto esse bloqueio existir, a promoção não é autorizável.

## 3. Compatibilidade de contrato (checklist)

| Item CVG | Versão/identificador | Regra |
| --- | --- | --- |
| Ponte `/v1` (`packages/deepseek-bridge`) | schema v1 | estável; mudança exige ADR e versionamento de envelope |
| Adapter externo (`DeepSeekHarnessAdapter`) | `adapterId: deepseek-harness-http` | fail-closed; exige commit/manifest/capabilities idênticos aos esperados |
| ACP (`DeepSeekAcpGovernance`) | `CVG_DEEPSEEK_ACP_*` | opt-in explícito; permission mode `read-only` |
| Manifest do runtime embarcado | `embedded-agent-runtime/1.0.0`, `AgentRuntimeContract/v1` | `runtimeManifest()`/`runtimeManifestDigest()` determinísticos |
| Checkpoint de sessão | `schemaVersion: 1` | leitura tolerante a v1 (`db/migrations/038_agent_runtime_session_state.sql`) |

## Evidência

- commit/release diffados, release notes e classificação de impacto;
- resultado de cada gate local com contagem de testes;
- manifest do runtime (`runtimeManifest()`: `runtimeVersion`, `runtimeCommit`, `agentContractVersion`, `toolRegistryDigest`, `policyRevision`);
- relatório de shadow/replay e quaisquer divergências;
- aprovação explícita da promoção e plano de rollback.

## O que NÃO fazer

- Nunca copiar "latest upstream" por cima de qualquer camada CVG.
- Nunca atualizar `expectedEngineCommit`/`expectedManifestVersion` sem exercitar a ponte.
- Nunca instalar dependências nativas/toolchain do upstream no repositório ou na imagem.
- Nunca promover sem revisão de segurança e sem rollback documentado.
- Nunca declarar paridade com o upstream: só os mecanismos necessários entram, e as limitações da auditoria continuam válidas.
