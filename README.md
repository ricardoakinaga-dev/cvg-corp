# CVG-Corp

Sistema operacional veterinário local-first, reconstruído a partir da especificação em [`docs/`](docs/README.md).

## Executar a demonstração

```bash
npm install
npm run bootstrap
npm run dev
```

Abra `http://127.0.0.1:5173`. A demonstração sintética pode ser acessada pelo botão próprio da tela inicial. Para login convencional, use as credenciais geradas em `.local/bootstrap-credentials.json`.

O modo padrão usa memória descartável para permanecer executável sem dependências externas. O adapter PostgreSQL implementa bootstrap, `BEGIN`/`COMMIT`/`ROLLBACK`, lock advisory, CAS de revisão, snapshot JSONB, journal independente com escopo organizacional, ledgers duráveis de auditoria/receipts, leituras normalizadas de guardians/patients/appointments com escopo de transação, outbox com claim/lease/fencing, ledger idempotente de uso, inbox atômico com assinatura/verificação configurável, ledger de efeitos externos com recibo obrigatório, reconciliação explícita, `ENABLE/FORCE RLS` nas 54 tabelas de domínio e FKs cross-table com proveniência organizacional. As migrations `001_initial.sql`–`014_cross_organization_foreign_keys.sql` são aplicadas em ordem e não devem ser editadas depois de aplicadas. O drill de restore exporta e verifica snapshot + outbox + usage + inbox + efeitos externos por digest, encapsula o bundle em AES-256-GCM com `keyRef`, rejeita adulteração e restaura em destino temporário quarentenado; inclui um cenário sintético de crash após marcador de dispatch sem reenvio cego. Ele exige migrations aplicadas e conexão acessível. O JSONB ainda é a fonte agregada de reconstrução em transição; PDP de negócio completo por unidade/workspace, provider real e consulta externa de reconciliação ainda não foram promovidos. Sem PostgreSQL disponível, `CVG_STORAGE=postgres` falha fechado para não simular durabilidade. Nenhum banco existente é removido por scripts do projeto.

## Verificação

```bash
npm run typecheck
npm test
npm run build
npm run verify:static
npm run test:e2e
```

Com PostgreSQL local disponível, aplique as migrations e execute a verificação durável com uma URL de conexão explícita:

```bash
DATABASE_URL='postgresql://...' npm run db:migrate
DATABASE_URL='postgresql://...' CVG_STORAGE=postgres CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres
DATABASE_URL='postgresql://...' CVG_BOOTSTRAP_PASSWORD='senha-sintética' npm run verify:postgres:restore
```

O verificador exercita bootstrap, login, mutation idempotente, commit de journal/auditoria/receipt, restart, leituras normalizadas recuperadas, outbox/worker, recibo de provider sintético, resultado desconhecido e reconciliação, inbox atômico com assinatura HMAC sintética, CAS concorrente, crash após marcador de dispatch e isolamento RLS organizacional + unidade/workspace — inclusive snapshot/journal e mutações clínicas negativas — usando papel efêmero não-superusuário removido ao final. O drill de restore cria apenas um banco temporário identificado, recupera os cinco conjuntos de evidência por digest, valida quarentena/login/readiness e remove somente esse destino criado pelo próprio drill; nenhum banco existente é alvo.

O artifact atual demonstra identidade, contexto, agenda, pacientes, atendimento, estoque, financeiro e copiloto governado com dados sintéticos. Provider real, credenciais externas, dados reais, break-glass, exportação e produção são bloqueados na API, não apenas ocultados na UI.

O caminho de IA é um stub local determinístico com policy, budget, approval, provenance, quarentena de prompt injection e replay. O commit documentado do DeepSeek Harness é preservado como contrato de replay, mas o runtime externo não é alegado como conectado neste workspace.

## Estrutura

- `apps/api`: BFF Fastify, autenticação, escopo, auditoria e rotas v1.
- `apps/web`: interface React/Vite responsiva.
- `packages/contracts`: schemas e contratos públicos compartilhados.
- `packages/domain`: invariantes e store sintético.
- `packages/harness`: governança de sessões/tools/approval/budget/replay.
- `packages/persistence`: boundary PostgreSQL transacional, leituras normalizadas, outbox/usage e validação de snapshot/journal.
- `packages/integrations`: contratos, adapters deny-by-default e worker bounded de outbox.
- `packages/ops`: métricas e redaction.
- `db/migrations`: schema PostgreSQL sem seed real.
- `.agent/` e `.gauntlet/`: estado de execução e bar de verificação deste trabalho.
