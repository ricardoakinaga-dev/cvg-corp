# Fechamento local — 2026-09-10

Fotografia executada no workspace `/home/ricardo/Área de trabalho/cvg-corp` em 2026-09-10, consolidada tecnicamente no commit `e846904` (`feat: persist break-glass lifecycle with RLS guards`), publicado em `main` após o hardening de recovery/TLS de `8b122ea`. O prompt normativo permanece em [`prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt), SHA-256 `34e886f59adacf8fda46d8d54bdede259705adc6e1521590cd3c281509b0e0d9`.

## Alterações verificadas

- `DeepSeekHarnessAdapter.health()` agora rejeita `READY` quando cancellation, approvals, replay e provenance não estão completos; nenhuma capability incompleta é promovida.
- O harness local executa tools pelo `ToolGateway.execute()`, com PDP, timeout, ledger, idempotência e executor sintético `LOCAL_ONLY`; o receipt de uma aprovação de alto impacto foi observado como `SUCCEEDED`.
- Lease expirada de outbox falha fechado e o startup exige explicitamente as migrations de cadeia de auditoria 026–028.
- A migration 029 adiciona `usage_record_id`/`provenance_json`, ledger de usage idempotente e políticas DML estritas para unit/workspace; a persistência agora rejeita divergência de uso/proveniência.
- A migration 030 adiciona ciclo durável de break-glass com MFA `WEBAUTHN`, FKs organizacionais, `FORCE RLS`, janela máxima de 15 minutos e guard forward-only para expiração, revogação e revisão; a capability pública continua `BLOCKED`.
- A API passou a oferecer `/api/v1/ops/export`, protegido pelo PDP, finalidade/TTL/idempotência, SecretProvider e AES-256-GCM; purpose é devolvido com digest auditável, o envelope v2 autentica `expiresAt` no AAD e o decrypt rejeita cópias expiradas; sem PostgreSQL ou chave de 256 bits o endpoint falha fechado.
- O overlay `docker-compose.production.yml` usa `proxy.tls.conf`, certificados montados out-of-band, redirect 80→HTTPS e TLS 1.2/1.3; o verificador renderiza a composição e rejeita a porta 8080 de desenvolvimento, mas não inicia o proxy nem prova certificado/staging.
- O guard de PDP compara o catálogo inteiro de rotas protegidas e boundaries de aplicação, incluindo export, worker fenced e recovery durável.
- A API expõe `/internal/metrics` somente para a rede privada de observabilidade, com métricas agregadas sem tenant/rota; Prometheus, alertas de dependência, `OUTCOME_UNKNOWN`, reconciliação e poison outbox foram ligados estruturalmente.
- A UI separa login inicial de sessão expirada, `PERMISSION_DENIED` de revalidação, e `STALE` de degradação; 403 não repete a mesma solicitação e 401 durante sessão oculta o conteúdo.

## Evidência local

| Procedimento | Resultado observado |
|---|---|
| `npm test` | PASS — 119 testes: 118 pass, 1 skip condicional |
| `npm run typecheck` | PASS |
| `npm run build` | PASS — typecheck + Vite |
| `npm run lint` | PASS — 121 fontes |
| `npm run verify:static` | PASS — 46 artefatos, 123 fontes; `/internal/metrics` possui exceção explícita e rede privada documentada |
| `npm run verify:pdp` | PASS — 68 operações, 70 regras, 6 policies canônicas, 12 domínios |
| `npm run test:security` | PASS — 26 testes |
| `npm run test:database` | PASS — 13 testes: persistência, break-glass durável, exportação governada e restore |
| `npm run verify:provider-sandbox` | PASS — loopback HTTP, replay, `OUTCOME_UNKNOWN`, reconciliação e HMAC; `externalProvider=NOT_RUN` |
| `npm run verify:production` | PASS limitado — gates locais completos, Compose principal/observabilidade e overlay TLS renderizados; nenhum serviço de produção foi iniciado |
| `npm run audit:contrast` | PASS — 7/7 pares |
| `npm run audit:tokens` | PASS — 0 high/critical; 73 sinais medium heurísticos não bloqueantes |
| `npm run audit:licenses` | PASS — 207 dependências |
| `npm audit --omit=dev` | PASS — 0 vulnerabilidades |
| `npm run test:e2e` | PASS — 64 testes, 4 skips condicionais (Chromium/Firefox/stress) |
| `npm run benchmark:local` | PASS limitado — baseline do stub local; não é SLO/capacidade |
| `git diff --check` | PASS |

## Gates que corretamente não promovem AAA

- `npm run verify:triplo-aaa`: `AAA_NOT_PROVEN`, exit 2. Gates locais passaram; registry ficou bloqueado pela rede e não houve provider real, secret authority, staging, Collector/SLO, recovery/load production-like, WebKit, assistive tech, zoom real ou aceite humano.
- `npm run verify:staging`: `STAGING_EVIDENCE_INCOMPLETE`, exit 2. Nenhuma URL foi configurada e nenhuma chamada de rede foi feita.
- `npm run verify:deepseek-acp`: bloqueado, exit 2, sem o conjunto explícito `CVG_DEEPSEEK_ACP_*` e atestação. O bridge permanece fail-closed; não houve prompt/turno LLM real.

## Limitações mantidas

O artifact continua local-first e sintético. Usage/provenance, exportação governada e o armazenamento durável do ciclo break-glass estão implementados e cobertos localmente, mas a execução PostgreSQL concorrente, provider WebAuthn/secret authority, provider/DeepSeek, staging/TLS real, collector/alert dispatch/SLO medidos, carga/chaos, backup/RTO/RPO, WebKit, leitor de tela e zoom de 200% continuam `PARTIAL`, `NOT_RUN` ou `BLOCKED`. O host desta fotografia não tinha `DATABASE_URL` nem daemon Docker; por isso migration/role/RLS em PostgreSQL efêmero e startup de containers não foram executados neste checkpoint. A cobertura de repositories/jobs permanece parcial; o commit `e846904` foi publicado e sua página de checks não apresentou resultado final observável no momento do registro. A crítica I1 concluída sobre o SHA publicado anteriormente rejeitou AAA; as tentativas pós-publicação sem parecer não são aprovação. O veredito global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

Nenhum segredo, dado real, provider externo, publicação de efeito ou alteração no repositório `/home/ricardo/deepseek-harness` foi realizada.
