# Staging, TLS e ambiente production-like

Status: `BLOCKED/NOT_RUN`. Não há URL de staging autorizada nesta revisão. `npm run verify:staging` falha fechado quando a URL, credenciais ou evidências reais não estão configuradas e não faz request externo por inferência.

## Gate mínimo

- deploy imutável do commit auditado, imagens escaneadas e migrations checksum-locked;
- PostgreSQL gerenciado com role sem superuser, RLS/FORCE RLS, backup e restore isolado;
- SecretProvider real com rotação/revogação; nenhum segredo em env/log/imagem;
- TLS válido na borda, redirect/HSTS, origem web explícita, cookies seguros e headers de segurança; o repositório fornece `docker-compose.production.yml` + `docker/nginx/proxy.tls.conf` para essa topologia, com certificados montados out-of-band;
- DeepSeek bridge, provider sandbox, worker, callback, OTel e alertas habilitados somente por configuração aprovada;
- smoke de login/MFA, PDP, stage/approval/outbox/receipt/reconciliation, replay/idempotência e shutdown;
- Chromium, Firefox e WebKit em mobile/tablet/desktop, axe/WCAG, carga, chaos e restore;
- evidência redigida, URL/commit/manifest/time window e aprovação humana.

O ambiente local pode verificar estrutura, contratos, fixtures e a composição TLS renderizada; não substitui o gate de staging. Até a configuração e autoridade serem fornecidas, TLS real, provider, secret authority, browsers adicionais, carga e recovery permanecem `NOT_RUN`.
