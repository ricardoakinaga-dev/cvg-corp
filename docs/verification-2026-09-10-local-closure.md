# Fechamento local — 2026-09-10

Fotografia executada no workspace `/home/ricardo/Área de trabalho/cvg-corp` em 2026-09-10, consolidada tecnicamente no commit `6b3df2f` (`feat: normalize clinical read repositories`), após `135ae56` (AuditRepository) e o ciclo durável de break-glass em `e846904`. O prompt normativo permanece em [`prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt`](prompt-state-of-the-art-triplo-aaa-2026-09-09-v2.txt), SHA-256 `34e886f59adacf8fda46d8d54bdede259705adc6e1521590cd3c281509b0e0d9`.

## Alterações verificadas

- `DeepSeekHarnessAdapter.health()` agora rejeita `READY` quando cancellation, approvals, replay e provenance não estão completos; nenhuma capability incompleta é promovida.
- O harness local executa tools pelo `ToolGateway.execute()`, com PDP, timeout, ledger, idempotência e executor sintético `LOCAL_ONLY`; o receipt de uma aprovação de alto impacto foi observado como `SUCCEEDED`.
- Lease expirada de outbox falha fechado e o startup exige explicitamente as migrations de cadeia de auditoria 026–028.
- A migration 029 adiciona `usage_record_id`/`provenance_json`, ledger de usage idempotente e políticas DML estritas para unit/workspace; a persistência agora rejeita divergência de uso/proveniência.
- A migration 030 adiciona ciclo durável de break-glass com MFA `WEBAUTHN`, FKs organizacionais, `FORCE RLS`, janela máxima de 15 minutos e guard forward-only para expiração, revogação e revisão; a capability pública continua `BLOCKED`.
- A leitura de auditoria foi extraída para um `AuditRepository` tipado: o caminho PostgreSQL consulta `audit_records` em transação `READ ONLY`, aplica organização/unidade/workspace e rejeita metadata, resultado ou versão de cadeia corrompidos; o runtime mantém o adapter de memória como fallback.
- A API passou a oferecer `/api/v1/ops/export`, protegido pelo PDP, finalidade/TTL/idempotência, SecretProvider e AES-256-GCM; purpose é devolvido com digest auditável, o envelope v2 autentica `expiresAt` no AAD e o decrypt rejeita cópias expiradas; sem PostgreSQL ou chave de 256 bits o endpoint falha fechado.
- O overlay `docker-compose.production.yml` usa `proxy.tls.conf`, certificados montados out-of-band, redirect 80→HTTPS e TLS 1.2/1.3; o verificador renderiza a composição e rejeita a porta 8080 de desenvolvimento, mas não inicia o proxy nem prova certificado/staging.
- O guard de PDP compara o catálogo inteiro de rotas protegidas e boundaries de aplicação, incluindo export, worker fenced e recovery durável.
- A API expõe `/internal/metrics` somente para a rede privada de observabilidade, com métricas agregadas sem tenant/rota; Prometheus, alertas de dependência, `OUTCOME_UNKNOWN`, reconciliação e poison outbox foram ligados estruturalmente.
- A UI separa login inicial de sessão expirada, `PERMISSION_DENIED` de revalidação, e `STALE` de degradação; 403 não repete a mesma solicitação e 401 durante sessão oculta o conteúdo.

## Evidência local

| Procedimento | Resultado observado |
|---|---|
| `npm test` | PASS — 122 testes: 121 pass, 1 skip condicional |
| `npm run typecheck` | PASS |
| `npm run build` | PASS — typecheck + Vite |
| `npm run lint` | PASS — 121 fontes |
| `npm run verify:static` | PASS — 46 artefatos, 123 fontes; `/internal/metrics` possui exceção explícita e rede privada documentada |
| `npm run verify:pdp` | PASS — 68 operações, 70 regras, 6 policies canônicas, 12 domínios |
| `npm run test:security` | PASS — 26 testes |
| `npm run test:database` | PASS — 16 testes: persistência, repositories clínicos/audit normalizados, break-glass durável, exportação governada e restore |
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

O artifact continua local-first e sintético. Usage/provenance, exportação governada, as leituras normalizadas de auditoria, encounters e clinical documents e o armazenamento durável do ciclo break-glass estão implementados e cobertos localmente, mas a execução PostgreSQL concorrente, provider WebAuthn/secret authority, provider/DeepSeek, staging/TLS real, collector/alert dispatch/SLO medidos, carga/chaos, backup/RTO/RPO, WebKit, leitor de tela e zoom de 200% continuam `PARTIAL`, `NOT_RUN` ou `BLOCKED`. O host desta fotografia não tinha `DATABASE_URL` nem daemon Docker; por isso migration/role/RLS em PostgreSQL efêmero e startup de containers não foram executados neste checkpoint. A cobertura dos demais repositories/jobs permanece parcial; o commit `6b3df2f` fecha somente esta fatia adicional e não fecha V3-DATA-001. A crítica I1 concluída sobre o SHA publicado anteriormente rejeitou AAA; a tentativa fresh desta onda sem parecer está registrada em [critique-clinical-read-attempt-20260910.md](../.gauntlet/critique-clinical-read-attempt-20260910.md) e não é aprovação. O veredito global permanece `FAIL_WITH_LIMITATIONS` / `AAA_NOT_PROVEN`.

## Incremento local — AuditRepository — 2026-09-10

No commit `135ae56`, `GET /api/v1/audit` deixou de acessar `CvgStore.listAudit` diretamente. Em PostgreSQL, `PostgresPersistence.listAudit` usa a transação contextual `READ ONLY`, consulta `audit_records` com organização e escopo de unidade/workspace, mantém paginação por cursor e valida os campos duráveis antes de serializar. Metadata não escalar, resultado desconhecido no banco ou versão de cadeia diferente de `2` produzem quarentena por corrupção, sem downgrade para lista vazia.

Evidência corrente: `npm test` passou com `121` testes (`120 pass`, `1 skip`); `npm run test:database` passou `15/15`, incluindo rota HTTP PostgreSQL-fake, escopo e linha corrompida; `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:static`, `npm run verify:pdp`, `npm run verify:production` e `git diff --check` passaram. O incremento reduz a dependência operacional do snapshot para auditoria, mas não cria repositories completos para os demais bounded contexts nem evidência PostgreSQL/staging de produção.

Nenhum segredo, dado real, provider externo, publicação de efeito ou alteração no repositório `/home/ricardo/deepseek-harness` foi realizada.

## Incremento local — EncounterRepository e ClinicalRepository — 2026-09-10

No commit `6b3df2f`, `GET /api/v1/encounters` e `GET /api/v1/clinical/documents` passaram a atravessar `ReadApplicationService`, com policy de aplicação e adapters separados para memória e PostgreSQL. O adapter PostgreSQL consulta `encounters` e `clinical_documents` em transação `READ ONLY`, usa `cvg_request_organization()`/`cvg_request_scope_allows(...)`, filtros explícitos de unidade/workspace e valida IDs, enums, timestamps, versão e projeções relacionadas antes de devolver dados. O endpoint clínico continua removendo `content` da resposta pública.

Os testes cobrem linha conhecida-bom, status clínico persistido não suportado com rollback e rotas HTTP usando o pool PostgreSQL-fake; a verificação estática também bloqueia bypass direto dessas leituras. Evidência observada: `npm test` 122 (`121 pass`, `1 skip`), `npm run test:database` 16/16, typecheck, lint, build, static, PDP, `verify:production` estrutural e `git diff --check` passaram. O gate de produção confirmou Compose base, observabilidade e overlay TLS renderizados, sem iniciar serviços.

Esta onda não prova PostgreSQL real/concurrente, nem cria repositories para diagnostics, hospitalization, medication, stock, finance, communication ou jobs. O critic fresh não completou e nenhum status AAA foi inferido.
