# ADR 006 — SecretProvider explícito

**Status:** accepted for implementation; nenhum segredo real está habilitado.

O código acessa secrets por referência e `SecretProvider`, com implementação de ambiente/arquivo apenas para desenvolvimento controlado e pontos de integração para Vault, AWS, GCP, Azure, Docker e Kubernetes.

Segredos não entram em logs, respostas, prompts, provenance público ou cliente web. Falta de provider ou referência falha fechado.
