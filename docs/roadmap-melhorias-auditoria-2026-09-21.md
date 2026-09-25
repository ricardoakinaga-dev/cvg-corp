# Roadmap de implementação — CVG-AUD26

**Base:** [plano executivo](./plano-executivo-melhorias-auditoria-2026-09-21.md)
**Backlog:** [backlog completo](./backlog-melhorias-auditoria-2026-09-21.md)
**Status:** PROPOSTO
**Regra de fluxo:** marcos são sequenciais nas fronteiras críticas; tarefas independentes podem avançar em paralelo somente depois de seus pré-requisitos.

## Visão geral

| Marco | Objetivo | Tarefas principais | Gate de saída |
|---|---|---|---|
| M0 | Reconciliar verdade e baseline | 001 | Control plane honesto e sujeito inventariado |
| M1 | Fechar restore e autoridade | 002–006 | Matriz PostgreSQL adversarial verde |
| M2 | Conter telemetria e integrações | 009–014 | Limites incrementais e cardinalidade comprovados |
| M3 | Fortalecer contratos e persistência | 015–020 | Egress validado e snapshots prioritários migrados |
| M4 | Elevar qualidade e frontend | 021–025, 029 | Quality gates efetivos e E2E estável |
| M5 | Endurecer runtime e supply chain | 026–028, 031 | Imagem mínima, imutável e atestável |
| M6 | Tornar operação observável e recuperável | 032–034 | Logs, alertas, carga, caos e DR comprovados |
| M7 | Renovar documentação e evidências | 007, 030 | Evidência corrente do sujeito congelado |
| M8 | Qualificar duas vezes e obter gates externos | 008, 035, 036 | Mesmo fingerprint verde + autoridade humana |

## M0 — Verdade operacional e baseline

### Objetivo

Eliminar divergência entre fatos, documentos e estado canônico antes de novas mudanças críticas.

### Execução

- Inventariar alterações rastreadas e não rastreadas sem descartá-las.
- Ler instruções aplicáveis, planos AUD25, backlog, estado e logs.
- Reabrir `AUD25-002` e `AUD25-003` por evento corretivo se os critérios continuarem não atendidos.
- Importar o programa proposto `CVG-AUD26` para `.agent` no schema vigente, sem criar fonte concorrente.
- Registrar baseline de comandos, versões, fingerprint e falhas conhecidas.
- Definir ownership de arquivos e sequência de migrations.

### Tarefas

- `CVG-AUD26-001`.

### Gate de saída

- Nenhum item crítico indevidamente `DONE`.
- Os 39 achados mapeados no control plane.
- Baseline reproduzível e sem perda das mudanças preexistentes.
- Promoção explicitamente bloqueada.

## M1 — Restore, menor privilégio e integridade PostgreSQL

### Objetivo

Transformar o restore de uma prova permissiva em uma garantia adversarial de autoridade mínima, atomicidade e terminação correta.

### Execução

- Criar migration forward-only para corrigir atributos de role, após descobrir se a 044 já foi aplicada em algum ambiente.
- Exigir todos os sete atributos relevantes de role no runtime e nos testes.
- Expandir a matriz de autoridade com um cenário negativo por atributo proibido.
- Remover grants, ownership e `CREATE` artificiais do verificador.
- Injetar falha depois de mutações parciais e provar rollback integral.
- Cobrir replay, concorrência, base não vazia, desconexão e `outcome unknown`.

### Tarefas

- `CVG-AUD26-002` a `CVG-AUD26-006`.

### Dependências

- M0 concluído.

### Gate de saída

- Testes falham para cada atributo proibido e passam com a role mínima.
- Nenhuma autoridade é concedida apenas para fazer o teste passar.
- Falha tardia deixa banco, ledger e efeitos no estado esperado.
- Replay e concorrência produzem um único resultado terminal íntegro.

## M2 — Telemetria, limites e fronteiras externas

### Objetivo

Impedir crescimento não limitado, vazamento por telemetria e consumo integral de respostas hostis.

### Execução

- Nomear spans e métricas por route template/operação estável, nunca URL bruta.
- Definir limites de cardinalidade e política de overflow/eviction.
- Encerrar spans idempotentemente em response, error, abort, timeout e close.
- Criar retenção/limpeza de buckets antigos de rate limit.
- Ler respostas de modelos e mensageria por stream com limite de bytes e cancelamento.
- Resolver e validar endereços antes da conexão, controlar redirects e testar DNS rebinding.

### Tarefas

- `CVG-AUD26-009` a `CVG-AUD26-014`.

### Dependências

- M0 concluído; `009` antes de `010`.

### Gate de saída

- Dez mil URLs com parâmetros distintos não criam dez mil séries/operações.
- Zero spans abertos após matriz de abortos/timeouts.
- Respostas oversized são interrompidas durante a leitura.
- Hosts resolvidos para redes proibidas são bloqueados, inclusive após redirect.
- Limpeza de rate limit é idempotente e observável.

## M3 — Contratos de egress e persistência autoritativa

### Objetivo

Fazer com que contratos sejam executáveis e que os domínios prioritários deixem de depender de snapshots como fonte principal.

### Execução

- Aplicar validação runtime às respostas da API, com tratamento seguro de falha.
- Publicar ADR e framework de migração de snapshot para comandos/eventos autoritativos.
- Migrar em slices: clínica/agenda, hospital/estoque/medicação, finanças/comunicação/conhecimento e IA.
- Para cada slice, definir comandos, idempotência, autorização, transação, backfill, reconciliação e compatibilidade de leitura.
- Remover o caminho snapshot-primary somente depois de equivalência comprovada.

### Tarefas

- `CVG-AUD26-015` a `CVG-AUD26-020`.

### Dependências

- M0 concluído; `016` antes de `017`–`020`.
- Slices com novas migrations respeitam a sequência estabelecida em M1.

### Gate de saída

- Resposta incompatível é detectada antes de sair da fronteira HTTP.
- Todas as 32 coleções têm classificação explícita e as 24 snapshot-primary foram migradas ou substituídas conforme o contrato aprovado.
- Escritas concorrentes, replay e backfill são testados.
- Nenhum snapshot legado é removido sem reconciliação e plano reversível.

## M4 — Qualidade de engenharia, E2E e frontend

### Objetivo

Substituir verificações superficiais por gates semânticos e reduzir flakiness, custo de carregamento e risco de manutenção.

### Execução

- Integrar ESLint com TypeScript/React/imports/promises sem perder checks customizados úteis.
- Adotar cobertura e thresholds graduais, mais altos em segurança, restore e persistência.
- Tornar portas E2E efêmeras/configuráveis, isolar estado e medir repetição.
- Remover o skip incondicional de WebKit do root boundary.
- Dividir bundle por rotas/features e estabelecer budget no CI.
- Fazer design tokens strict falhar segundo política documentada e ampliar contraste para UI renderizada.
- Extrair módulos dos quatro arquivos monolíticos por seams testáveis.

### Tarefas

- `CVG-AUD26-021` a `CVG-AUD26-025` e `CVG-AUD26-029`.

### Dependências

- M0 concluído.
- Refatorações de `029` devem acompanhar ou suceder as mudanças funcionais nos mesmos módulos para evitar conflito.

### Gate de saída

- Lint semântico e cobertura bloqueiam regressões.
- E2E executa repetidamente sem colisão de porta e com WebKit efetivo.
- Flake conhecida tem causa removida, não mascarada por retries indiscriminados.
- Bundle, tokens e contraste obedecem budgets publicados.
- Interfaces públicas dos módulos extraídos permanecem compatíveis.

## M5 — Runtime mínimo e cadeia de suprimentos

### Objetivo

Produzir artefatos menores, imutáveis, verificáveis e associados ao código qualificado.

### Execução

- Criar `.dockerignore` mínimo e testar o contexto.
- Compilar API/worker e copiar somente runtime necessário para imagens finais.
- Pinar bases por digest com processo de atualização automatizado.
- Gerar SBOM e proveniência OCI nativos e associá-los ao digest.
- Assinar e verificar artefatos em ambiente autorizado, usando identidade ou chaves gerenciadas.
- Fixar package manager, adicionar governança e endurecer TypeScript gradualmente.

### Tarefas

- `CVG-AUD26-026` a `CVG-AUD26-028` e `CVG-AUD26-031`.

### Dependências

- M0 concluído; build estável de M4 recomendado antes de fechar budgets.

### Gate de saída

- Contexto Docker exclui `.git`, dependências locais, artefatos e segredos.
- Runtime não executa fontes via `tsx` e não contém ferramentas desnecessárias.
- Todas as bases estão presas a digest verificável.
- SBOM, proveniência e assinatura resolvem para o mesmo digest.
- Secret scanning dedicado cobre worktree e histórico no CI autorizado.

## M6 — Observabilidade durável, resiliência e DR

### Objetivo

Converter instrumentação em capacidade operacional comprovada.

### Execução

- Exportar logs para backend durável com retenção, acesso e redaction.
- Definir SLOs/SLIs e alertas para disponibilidade, latência, filas, restore e segurança.
- Executar drills controlados, registrar detecção, notificação e resposta.
- Criar perfis de carga realistas e injeções de falha seguras.
- Qualificar backup/restore em PostgreSQL gerenciado ou ambiente equivalente autorizado.
- Medir RTO/RPO e registrar desvios.

### Tarefas

- `CVG-AUD26-032` a `CVG-AUD26-034`.

### Dependências

- M1 para restore; M2 para telemetria; M5 para artefato qualificável.

### Gate de saída

- Logs sobrevivem ao processo e podem ser consultados por correlação.
- Alertas críticos são recebidos pela rota esperada em drill.
- Carga e caos não violam invariantes de dados.
- RTO e RPO são medidos em ambiente representativo e comparados aos objetivos.

## M7 — Documentação, diagnósticos e evidência corrente

### Objetivo

Gerar uma narrativa verificável do artefato que será qualificado, sem evidências stale ou truncadas.

### Execução

- Fazer o runner de produção preservar stdout/stderr, comando, exit code e caminho do artefato completo.
- Atualizar README, índice de docs, migrations, contagem de testes e estado ativo a partir de fontes verificáveis.
- Atualizar manifests, hashes e receipts somente depois de congelar o sujeito.
- Rodar verificação estática e checar que nenhuma evidência aponta para revisão anterior.

### Tarefas

- `CVG-AUD26-007` e `CVG-AUD26-030`.

### Dependências

- M1–M6 funcionalmente concluídos.

### Gate de saída

- Falhas exibem diagnóstico completo e útil.
- Documentação não contém números ou status contraditórios.
- Todos os hashes/fingerprints referem-se à candidata corrente.
- `verify:static` e checks equivalentes estão verdes.

## M8 — Qualificação repetida, gates externos e release

### Objetivo

Demonstrar repetibilidade do mesmo artefato e entregar a decisão final à autoridade correta.

### Execução

- Congelar fingerprint e impedir mutações entre execuções.
- Executar duas qualificações completas e independentes da mesma candidata.
- Qualificar staging, provedores reais, segredos gerenciados, collector durável e testes de aceitação.
- Realizar inspeção manual de zoom/responsividade e revisão humana de risco residual.
- Reauditar os 39 achados e recalcular score com evidência.

### Tarefas

- `CVG-AUD26-008`, `CVG-AUD26-035` e `CVG-AUD26-036`.

### Dependências

- Todos os marcos anteriores.

### Gate de saída

- Duas execuções completas verdes resolvem para o mesmo fingerprint.
- Gates externos têm recibos emitidos pelos sistemas responsáveis.
- A reauditoria não encontra achado alto aberto.
- A decisão humana de promover ou não promover está registrada.

## Caminho crítico

```text
001
 ├─ 002 → 003 → 004 → 005 → 006 ──────────────┐
 ├─ 009 → 010 ──────────────────────────────────┤
 ├─ 011–015 ────────────────────────────────────┤
 ├─ 016 → 017/018/019/020 ──────────────────────┤
 ├─ 021–025/029 ────────────────────────────────┤
 └─ 026 → 027 → 028; 031 ───────────────────────┤
                                                  ↓
                         032 → 033 → 034 → 007 → 030
                                                  ↓
                                      008 → 035 → 036
```

## Política de checkpoint e recuperação

Ao final de cada tarefa e de cada marco, o executor deve registrar:

- arquivos alterados e motivo;
- critérios satisfeitos e pendentes;
- comandos executados, resultados e caminhos das evidências;
- fingerprint do sujeito;
- risco residual e decisão de continuidade;
- próximo item desbloqueado.

Se houver interrupção, a retomada começa pela leitura do estado canônico e pela confirmação de que o fingerprint e a árvore de trabalho ainda correspondem ao checkpoint. Não se reexecuta trabalho concluído sem motivo, e não se assume que uma evidência antiga continua válida após alteração do sujeito.
