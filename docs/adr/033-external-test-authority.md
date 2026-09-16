# ADR 033 — Preparação e autoridade para testes externos

## Status

Aceito para preparação; execução externa `BLOCKED_EXTERNAL` até provisionamento
e autorização explícitos.

## Decisão

O contrato de staging é mantido em uma matriz versionada de recurso, versão,
endpoint/identificador, owner, disponibilidade e gate. A matriz não materializa
URLs reais, credenciais, chaves, destinatários ou dados clínicos. Esses valores
pertencem à autoridade de infraestrutura, secrets, integração, dados ou
release e são fornecidos somente fora do checkout.

Cada execução com rede, escrita, egress, custo ou dado sensível precisa de uma
autorização revalidada na sessão atual. A autorização pode ser reutilizada sem
nova pergunta apenas quando recurso, operação, escopo, janela e teto forem
idênticos. Qualquer divergência, expiração ou ausência falha fechado; não há
fallback para fixture, provider alternativo ou produção.

O conjunto mínimo usa staging isolado, um dataset sintético, um destinatário
controlado, limites explícitos de custo/carga, secret authority com rotação e
um bundle de evidência same-SHA fora do repositório. O sucesso de health/readiness
ou de um teste loopback não promove staging, provider, release ou produção.

## Consequências

- owners podem provisionar os recursos sem alterar código ou revelar segredos;
- verificadores continuam determinísticos e bloqueiam quando a autoridade está
  ausente;
- evidência externa fica separada de fixtures e pode ser atestada por produtor
  e revisor distintos;
- a ausência de staging, provider, secrets, observabilidade, carga ou recovery
  é registrada como lacuna operacional, não como falha inventada nem aprovação.

## Referências

- `docs/staging.md`
- `docker/.env.example`
- `docs/adr/006-secret-provider.md`
- `docs/adr/008-recovery-and-release.md`
- `docs/adr/009-deepseek-harness-external-runtime.md`
- `docs/release-provenance.md`
- `scripts/verify-staging.ts`
- `scripts/verify-container-smoke.ts`
