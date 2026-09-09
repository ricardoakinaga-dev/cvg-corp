# CVG-Corp

Sistema operacional veterinário local-first, reconstruído a partir da especificação em [`docs/`](docs/README.md). Esta fotografia inclui a fundação vNext de runtime governado, API modularizada, worker separado, web modular e artefatos de release.

## Executar a demonstração

```bash
npm install
npm run bootstrap
npm run dev
```

Abra `http://127.0.0.1:5173`. A demonstração sintética pode ser acessada pelo botão próprio da tela inicial. Para login convencional, use as credenciais geradas em `.local/bootstrap-credentials.json`.

O modo padrão usa memória descartável para permanecer executável sem dependências externas. O adapter PostgreSQL implementa bootstrap, `BEGIN`/`COMMIT`/`ROLLBACK`, lock advisory, CAS de revisão, snapshot JSONB, journal independente com escopo organizacional, ledgers duráveis de auditoria/receipts com cadeia `previous_hash`/`record_hash`, leituras normalizadas de guardians/patients/appointments com escopo de transação, outbox com claim/lease/fencing, ledger idempotente de uso, inbox atômico com assinatura/verificação configurável, ledger de efeitos externos com recibo obrigatório, reconciliação explícita, `ENABLE/FORCE RLS` nas tabelas de domínio e FKs cross-table com proveniência organizacional. As migrations `001_initial.sql`–`026_audit_tamper_evident_chain.sql` são aplicadas em ordem e migrations já aplicadas não devem ser editadas. O drill de restore exporta e verifica snapshot + outbox + usage + inbox + efeitos externos por digest, encapsula o bundle em AES-256-GCM com `keyRef`, rejeita adulteração e restaura em destino temporário quarentenado; inclui um cenário sintético de crash após marcador de dispatch sem reenvio cego. Ele exige migrations aplicadas e conexão acessível. O JSONB ainda é a fonte agregada de reconstrução em transição; PDP universal em todas as rotas/repositories, provider real e consulta externa de reconciliação ainda não foram promovidos. Sem PostgreSQL disponível, `CVG_STORAGE=postgres` falha fechado para não simular durabilidade. Nenhum banco existente é removido por scripts do projeto.

## Verificação

```bash
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:security
npm run test:database
npm run test:fault
npm run build
npm run verify:static
npm run test:e2e
npm run audit:licenses
npm run audit:contrast
npm run audit:tokens -- --strict
npm run benchmark:local
npm run verify:production
node --import tsx --test tests/unit/deepseek-bridge.test.ts
```

Com PostgreSQL local disponível, aplique as migrations e execute a verificação durável com uma URL de conexão explícita:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
DATABASE_URL='postgresql://...' CVG_STORAGE=postgres CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres
DATABASE_URL='postgresql://...' CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres:restore
```

O verificador exercita bootstrap, login, mutation idempotente, commit de journal/auditoria/receipt, restart, leituras normalizadas recuperadas, outbox/worker, recibo de provider sintético, resultado desconhecido e reconciliação, inbox atômico com assinatura HMAC sintética, CAS concorrente, crash após marcador de dispatch e isolamento RLS organizacional + unidade/workspace — inclusive snapshot/journal e mutações clínicas negativas — usando papel efêmero não-superusuário removido ao final. O drill de restore cria apenas um banco temporário identificado, recupera os cinco conjuntos de evidência por digest, valida quarentena/login/readiness e remove somente o destino criado pelo próprio drill; nenhum banco existente é alvo. `verify:production` valida os artefatos de release e o Compose em ambiente sintético, sem iniciar serviços; quando Docker não está disponível, encerra com falha fechada/resultado incompleto.

O artifact atual demonstra identidade, contexto, agenda, pacientes, atendimento, estoque, financeiro e copiloto governado com dados sintéticos. Provider real, credenciais externas, dados reais, break-glass, exportação e produção são bloqueados na API, não apenas ocultados na UI.

O caminho de IA usa a interface `AgentRuntime`, um adapter Mock determinístico e um adapter DeepSeek opcional. O Mock tem policy, budget, approval, provenance, quarentena de prompt injection e replay. O bridge DeepSeek funciona como uma ponte CVG `/v1` com health/manifest/tool-set estritos, correlation, cancel, timeout e envelopes de erro; seu port nativo default é `UNAVAILABLE`, não há fallback implícito e nenhuma conexão externa é alegada neste workspace. Consulte [`docs/deepseek-production-integration.md`](docs/deepseek-production-integration.md).

## Estrutura

- `apps/api`: BFF Fastify, application services, rotas de health, pacientes e IA, autenticação, escopo e auditoria.
- `apps/worker`: processo separado com health, heartbeat, shutdown cooperativo e ciclo de outbox/jobs/schedule/reconciliation/notifications/maintenance; lanes sem runner, backpressure e dispatch externo permanecem bloqueados.
- `apps/web`: interface React/Vite responsiva, modular por shell/rotas/features e com máquina de estados operacionais.
- `packages/contracts`: schemas e contratos públicos compartilhados.
- `packages/domain`: invariantes e store sintético.
- `packages/agent-runtime`, `packages/agent-policy`, `packages/agent-tools`: contratos de runtime, PDP/ABAC e gateway governado.
- `packages/harness-adapters`: adapters Mock e DeepSeek com fail-closed.
- `packages/deepseek-bridge` e `apps/deepseek-bridge`: contrato `/v1` provider-neutral, sem fallback, com port nativo explícito.
- `packages/config`: configuração typed e validação fail-closed.
- `packages/harness`: governança de sessões/tools/approval/budget/replay.
- `packages/persistence`: boundary PostgreSQL transacional, leituras normalizadas, outbox/usage e validação de snapshot/journal.
- `packages/integrations`: contratos, adapters deny-by-default e worker bounded de outbox.
- `packages/ops`: métricas e redaction.
- `db/migrations`: schema PostgreSQL sem seed real.
- `.agent/` e `.gauntlet/`: estado de execução e bar de verificação deste trabalho.

## Estado de qualidade

Os gates locais determinísticos registrados no último checkpoint incluem lint, typecheck, suíte unitária/integração, build Vite, E2E Chromium em 375/768/1440, verificação estática, contratos/segurança/banco/fault, licenças, contraste, tokens, benchmark sintético, auditoria de dependências, SBOM, Compose estrutural e diff check. O workflow CI declara E2E, PostgreSQL efêmero, migrations, restore e scan de imagens como gates bloqueantes. A barra v3 permanece `FAIL_WITH_LIMITATIONS`: produção, dados reais, secret manager real, provider externo, entrega efetiva, scan de imagem remoto, carga production-like, browsers adicionais, OTel/SLO/alertas e aprovação independente ainda não foram provados. O sistema não deve ser apresentado como Triplo AAA ou release pronto; o scorecard honesto está em [`docs/triple-aaa-final-scorecard.md`](docs/triple-aaa-final-scorecard.md).
