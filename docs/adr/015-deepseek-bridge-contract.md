# ADR-015 — Contrato do bridge DeepSeek

## Status

Aceito para implementação local; integração nativa e produção pendentes.

## Decisão

O CVG expõe um bridge `/v1` próprio em `apps/deepseek-bridge` e o núcleo protocolar em `packages/deepseek-bridge`. O bridge aceita um `DeepSeekNativeHarnessPort` explicitamente injetado e valida health, commit, manifest, tools, correlation, contexto, approval, replay e provenance antes de devolver qualquer resultado ao runtime.

O port default é indisponível. Não há Mock, chamada externa implícita, retry cego, regra clínica ou execução de tool dentro do bridge. A integração com um Harness real só será habilitada quando houver um adapter nativo compatível, credencial/SecretProvider e evidência de staging.

## Consequências

- o runtime pode distinguir `READY`, `DEGRADED`, `UNAVAILABLE` e `DISABLED`;
- respostas fora do schema são rejeitadas como `INVALID_RESPONSE`;
- timeout e cancelamento abortam o port e mantêm correlation;
- mismatch de profile é `CONTRACT_MISMATCH`, nunca degrada silenciosamente para outra engine;
- fixtures conhecidas podem testar o contrato sem alegar egress ou modelo real;
- o protocolo do Harness externo não é inventado: sua ausência permanece um blocker observável.

## Verificação

`node --import tsx --test tests/unit/deepseek-bridge.test.ts` cobre unavailable, known-good, mismatch, schema, timeout, cancelamento e round-trip HTTP com o adapter provider-neutral.
