# Staging e release gate vNext

## Pré-condições

Staging precisa possuir PostgreSQL gerenciado, TLS terminado no proxy,
SecretProvider autorizado, rate limiter distribuído, worker com ledger de
efeitos, collector, backup e dados explicitamente aprovados. O ambiente deve
ser isolado de produção e usar identidades de serviço distintas.

O comando `npm run verify:staging -- --url=https://host-aprovado` faz apenas
probes explícitos de health/readiness, sem credenciais embutidas e sem seguir
redirects. Sem URL ele não faz rede e retorna `BLOCKED`.

## Smoke obrigatório

1. migrations forward-only e checksum;
2. `/api/v1/health` e `/api/v1/ready` com dependencies e schema;
3. login/MFA/session/context/PDP e headers de segurança;
4. transação de domínio com receipt, outbox e auditoria;
5. worker claim/lease/fence/restart;
6. provider sandbox com receipt, callback duplicado e timeout seguido de
   reconciliação;
7. backup, restore em destino quarentenado e replay pós-watermark;
8. browsers, teclado, contraste, reduced motion e acessibilidade;
9. carga aprovada, SLO/error budget, SBOM, scan de imagem e rollback.

Qualquer item ausente permanece `NOT_RUN`, `BLOCKED` ou `STAGING_ONLY`; health
e readiness sozinhos não autorizam release.
