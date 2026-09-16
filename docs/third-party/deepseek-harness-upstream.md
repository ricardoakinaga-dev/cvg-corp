# Upstream tracking — DeepSeek Harness

**Status:** ativo. Nenhum arquivo incorporado.

## Registro de importação

| Campo | Valor |
| --- | --- |
| Upstream repository | `https://github.com/deepseek-ai/deepseek-harness.git` |
| Upstream commit de referência | `5dda764ed3aa172535a7967b06ff95d9cbfe536a` |
| Release | `dsh 0.1.5-alpha.1` |
| Import date | 2026-09-16 (auditoria; sem importação de arquivos) |
| Local modifications | N/A (nenhum arquivo incorporado) |
| CVG patches | N/A (nenhum arquivo incorporado) |
| License | MIT (root `LICENSE`, "Copyright (c) 2026 DeepSeek") |
| Security review | `docs/embedded-harness-audit.md` §5 e `docs/agent-runtime-security-review.md` |
| Decisão | `HYBRID` — `docs/adr/ADR-agent-runtime-embedding-decision.md` |

## O que o CVG mantém do upstream

Apenas **conceitos e contratos públicos de interoperabilidade**:

- o contrato `/v1` da ponte CVG (`apps/deepseek-bridge`) e o adapter
  `DeepSeekHarnessAdapter`, ambos implementações CVG, permanecem como caminho `external`;
- nenhuma estrutura interna, schema de sessão, vocabulário de evento ou código do `dsh` é
  interpretado pelo CVG.

## Procedimento de diff (upstream → CVG)

Não há sincronização automática. Para avaliar qualquer mudança upstream:

```bash
git -C /home/ricardo/deepseek-harness fetch deepseek-official
git -C /home/ricardo/deepseek-harness log --oneline 5dda764ed3..deepseek-official/main
git -C /home/ricardo/deepseek-harness diff --stat 5dda764ed3..deepseek-official/main
```

Como não há código embarcado, o diff informa apenas:

1. mudanças no contrato `/v1` ou no comportamento do produto externo que afetem o adapter
   `DeepSeekHarnessAdapter`;
2. correções de segurança relevantes para operar o harness como processo externo;
3. breaking changes que exijam atualizar `expectedEngineCommit`/`expectedManifestVersion`.

## Política de atualização (nunca *blind update*)

```text
upstream update
    ↓
diff + leitura dos release notes
    ↓
revisão de licença (se houver intenção de incorporar código)
    ↓
revisão de segurança
    ↓
revisão de compatibilidade do contrato /v1
    ↓
atualizar expectedEngineCommit / expectedManifestVersion
    ↓
testes focados (deepseek-bridge, deepseek-acp, harness-adapters)
    ↓
regressão completa + shadow (quando aplicável)
    ↓
promoção explícita
```

Nunca copiar "latest upstream" por cima de qualquer camada do CVG. Nunca atualizar
`expectedEngineCommit` sem que o novo commit tenha sido exercitado contra a ponte.

## Compatibilidade de contrato

| Item CVG | Versão | Regra |
| --- | --- | --- |
| Ponte `/v1` (`packages/deepseek-bridge`) | schema v1 | Estável; mudanças exigem ADR e versionamento de envelope. |
| Adapter externo (`DeepSeekHarnessAdapter`) | `adapterId: deepseek-harness-http` | Fail-closed; exige commit/manifest/capabilities idênticos aos esperados. |
| ACP (`DeepSeekAcpGovernance`) | contrato `CVG_DEEPSEEK_ACP_*` | Opt-in explícito; permission mode `read-only`. |
