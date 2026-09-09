# Runbook — indisponibilidade do DeepSeek bridge

## Sinal

Health `/v1/health` diferente de `READY`, aumento de `NATIVE_UNAVAILABLE`, `CONTRACT_MISMATCH`, `TIMEOUT` ou `DEPENDENCY_UNAVAILABLE`, ou ausência de provenance/correlation.

## Contenção

1. Não habilite Mock nem altere o commit/manifest/tool-set aprovado para fazer o health passar.
2. Mantenha o runtime em `UNAVAILABLE`; interrompa novos turns e preserve requests/outcomes desconhecidos para reconciliação.
3. Não repita um dispatch externo cujo resultado seja desconhecido. Abra revisão manual para qualquer efeito não reconciliado.
4. Preserve correlation, erro estruturado, digest, timestamp e estado de approval; redija prompts, tokens e dados clínicos.

## Diagnóstico

```bash
curl -fsS http://127.0.0.1:4320/v1/health
node --import tsx --test tests/unit/deepseek-bridge.test.ts
```

Compare `engineCommit`, `manifestVersion` e `tools` com o profile aprovado. Verifique a saúde do native port, SecretProvider, TLS, limites de timeout, Collector e fila do worker. Se a versão externa mudou sem aprovação, classifique como `CONTRACT_MISMATCH`.

## Recuperação

Só reabra turns após health `READY`, provenance/replay/cancel verificados em staging e aprovação do incidente. Se a recuperação não for comprovada dentro do budget, mantenha quarentena e siga `runbooks/quarantine.md`, `runbooks/provider-outage.md` e `runbooks/slo-breach.md`.
