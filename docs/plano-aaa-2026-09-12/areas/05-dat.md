# 05 — Persistência e integridade

Baseline da auditoria: **78/100**. Meta de planejamento da área: **≥ 97/100**, sem substituir os limiares individuais das dimensões `database, domainIntegrity`. Todas precisam da própria evidência.

Resultado executivo: Isolamento, fonte transacional, concorrência e integridade provados com PostgreSQL real.

Papel líder: **Dados**. Achados de origem: A07, A08.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M1 | DAT-01 | Revalidar migrations e RLS em PostgreSQL efêmero |
| M2 | DAT-02 | Fechar fonte authoritative e concorrência multiprocesso |
| M2 | DAT-03 | Endurecer auditoria imutável e exportação |
| M3 | DAT-04 | Provar restore sem ressuscitar dados ou privilégios |

## Backlog executável

### DAT-01 — Revalidar migrations e RLS em PostgreSQL efêmero

**P1 · M · M1 · R2**. Dependências: SUP-01.

Demonstrar banco real, role runtime sem privilégios elevados e isolamento de tenant/unidade/workspace.

Entradas e superfície permitida: `tests/integration/persistence.test.ts`; `scripts/verify-postgres.ts`; `db/migrations/`.

Reservas exclusivas: `db-schema`, `staging-db`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Migrations existentes aplicadas em ordem sem reescrever as já publicadas
- Runtime sem superuser/BYPASSRLS; schema_migrations sem DML
- Casos negativos diretos SQL e via API negam, com banco descartável próprio

Validação planejada, ainda não executada para esta melhoria:

- npm run db:migrate
- npm run verify:postgres
- npm run test:database

Artefato esperado: Entrega revisável de DAT-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F8.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DAT-02 — Fechar fonte authoritative e concorrência multiprocesso

**P1 · L · M2 · R2**. Dependências: DAT-01, FIN-01.

Eliminar caminhos de escrita fora do contrato transacional e comprovar CAS/idempotência.

Entradas e superfície permitida: `packages/persistence/src/`; `apps/api/src/application/idempotency-service.ts`; `db/migrations/`; `scripts/verify-postgres-concurrency.ts`.

Reservas exclusivas: `persistence-core`, `db-schema`, `idempotency`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Cada coleção relevante tem dono de escrita e invariantes exercitadas
- Mesmo comando em dois processos gera um efeito; payload diferente conflita
- Crash em fronteiras commit/receipt deixa estado reconciliável sem sucesso falso

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:authoritative-writes
- npm run verify:postgres:concurrency
- npm run test:fault

Artefato esperado: Entrega revisável de DAT-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F2, F7, F8.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DAT-03 — Endurecer auditoria imutável e exportação

**P1 · M · M2 · R2**. Dependências: DAT-02, SEC-02.

Provar trilha resistente a alteração e exportação mínima, autorizada e rastreável.

Entradas e superfície permitida: `packages/persistence/src/`; `apps/api/src/application/export-service.ts`; `db/migrations/`; `tests/unit/audit-chain.test.ts`.

Reservas exclusivas: `persistence-core`, `db-schema`, `export`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Alterar/remover/reordenar ledger falha ou é detectado inclusive via SQL
- Exportação exige finalidade, escopo, TTL, idempotência e chave referenciada
- Falha de auditoria ou cifra impede confirmação e artefato utilizável

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:audit-chain
- npm run verify:authoritative-writes
- Teste API + SQL de exportação, tamper e escopo

Artefato esperado: Entrega revisável de DAT-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F25, F27.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### DAT-04 — Provar restore sem ressuscitar dados ou privilégios

**P1 · L · M3 · R3**. Dependências: DAT-03, OPS-02, ARC-03.

Restaurar checkpoint e decisões posteriores preservando revogação/restrição, ledger e efeitos desconhecidos.

Entradas e superfície permitida: `packages/persistence/src/`; `scripts/verify-postgres-restore.ts`; `tests/integration/restore.test.ts`.

Reservas exclusivas: `persistence-core`, `recovery-db`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Backup → revogação/restrição → restore não reabilita autoridade antiga
- Contagens, hashes, vínculos, leases e watermark reconciliados
- Origem intacta; destino próprio em quarentena e sem reenvio cego

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:postgres:restore
- npm run test:restore
- Drill de perda do store local de decisões e replay pós-watermark

Artefato esperado: Entrega revisável de DAT-04: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F18.

Pré-requisitos externos/decisões:

- Destino isolado e conexão administrativa dedicada ao drill autorizados

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

