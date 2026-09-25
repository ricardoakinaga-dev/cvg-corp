# Relatório de auditoria profunda do repositório CVG-Corp

**Data da auditoria:** 2026-09-21
**Objeto:** árvore de trabalho local do repositório `cvg-corp`
**Tipo:** auditoria técnica brownfield, baseada em documentação, código, testes e evidências locais
**Resultado global:** **65/100**
**Prontidão para produção:** **38/100**
**Veredito:** **REPROVADO — promoção bloqueada**

## 1. Resumo executivo

O CVG-Corp demonstra uma base técnica acima da média em segurança de aplicação, domínio, autorização universal, trilhas append-only, idempotência e amplitude de testes. A auditoria encontrou, porém, uma diferença material entre a qualidade aparente do control plane e as garantias realmente comprovadas para restauração PostgreSQL, observabilidade, persistência autoritativa, qualificação reprodutível e operação em ambiente semelhante à produção.

Foram identificados **39 problemas**: **14 de alto impacto**, **22 de médio impacto** e **3 de baixo impacto**. O principal bloqueador não é falta de funcionalidade; é a presença de controles críticos incompletos ou falsamente verdes, especialmente em autoridade de restore, rollback tardio, matriz de atributos de roles, evidência estática vencida e qualificação da mesma revisão limpa.

O estado auditado não corresponde apenas ao commit `c990914`: havia **58 arquivos rastreados modificados**, aproximadamente **10 mil adições** e diversos arquivos críticos não rastreados, incluindo as migrations `040` a `044`. Portanto, todas as notas e conclusões deste relatório se referem à árvore de trabalho local observada em 2026-09-21.

## 2. Escopo e método

A auditoria cobriu:

- documentação raiz, ADRs, planos, backlogs, evidências e estado em `.agent`;
- arquitetura de aplicações e pacotes;
- domínio, contratos HTTP, autorização, autenticação e proteção de fronteiras;
- persistência, migrations, restore, backup, recuperação e concorrência;
- runtime de agentes, worker e integrações externas;
- frontend, acessibilidade, design tokens e performance;
- testes unitários, integração, E2E e verificadores de produção;
- CI, dependências, licenças, imagens, SBOM e cadeia de suprimentos;
- observabilidade, logs, métricas, tracing, alertas e provas operacionais.

O método combinou leitura estática, comparação entre documentação e implementação, inspeção de evidências e execução de verificações locais. A auditoria não atribui equivalência entre teste local e prova externa de staging/produção.

## 3. Scorecard

| Área | Peso | Nota | Diagnóstico resumido |
|---|---:|---:|---|
| Documentação e rastreabilidade | 6 | 55 | Rica, mas com estado divergente e evidências vencidas |
| Arquitetura e modularidade | 7 | 67 | Boa separação macro; arquivos centrais excessivamente grandes |
| Domínio e regras de negócio | 7 | 82 | Modelagem ampla e invariantes relevantes bem representadas |
| API e contratos | 6 | 73 | Catálogo forte; validação de resposta ainda apenas declarativa |
| Segurança, autenticação e autorização | 10 | 76 | Base sólida; faltam fechamentos em SSRF e restore authority |
| Persistência e integridade de dados | 12 | 61 | Bons mecanismos distribuídos; ampla dependência de snapshots |
| Restore, backup e recuperação | 11 | 40 | Lacunas críticas de autoridade, atomicidade e qualificação |
| IA, agentes e governança | 6 | 78 | PDP e políticas abrangentes; operação externa ainda não provada |
| Worker e integrações | 6 | 70 | Idempotência e fencing bons; limites de resposta incompletos |
| Frontend e acessibilidade | 6 | 70 | Cobertura funcional boa; qualidade visual e E2E ainda frágeis |
| Testes e verificação | 8 | 72 | 576 testes aprovados; ausência de cobertura e prova limpa repetida |
| CI e cadeia de suprimentos | 5 | 64 | Ações pinadas e auditorias úteis; imagens e proveniência incompletas |
| Observabilidade e operações | 5 | 47 | Instrumentação existe; cardinalidade, logs e alertas são insuficientes |
| Performance e escalabilidade | 3 | 53 | Sem orçamento de bundle nem carga semelhante à produção |
| Manutenibilidade e DX | 2 | 58 | TypeScript estrito parcial; lint sem análise semântica real |
| **Total ponderado** | **100** | **65** | **Promoção bloqueada** |

## 4. Resultados de verificação observados

| Verificação | Resultado observado |
|---|---|
| Typecheck | PASS |
| Testes automatizados | 576 aprovados, 0 falhas, 1 ignorado; 577 no total |
| Build | PASS; chunk principal web em aproximadamente 573 kB |
| Lint | PASS, porém implementado por script customizado, não ESLint semântico |
| PDP | PASS; 85 operações, 88 regras, 6 políticas de ferramentas e 12 domínios |
| Catálogo runtime de rotas | PASS; 26/26 rotas |
| `npm audit`, incluindo dev | 0 vulnerabilidades |
| Licenças | PASS; 163 pacotes avaliados |
| Contraste | PASS, mas somente 7 pares estáticos declarados |
| Design tokens em modo strict | Exit 0 com 73 achados médios; strict sem efeito bloqueante |
| Control plane | PASS técnico, mas com falsos verdes em itens críticos |
| Manifesto de schema | PASS; migration mais recente identificada como 044 |
| Verificação estática | FAIL; 15 falhas de SHA/freshness |
| `verify:production` | FAIL por verificação estática e colisão de porta do navegador |
| E2E isolado | 124 aprovados, 9 ignorados e 1 falha antes de interrupção deliberada |
| Caso E2E tablet inicialmente falho | PASS isolado em 11,6 s, indicando flakiness |
| Integridade do diff | PASS |

## 5. Achados completos e enumerados

### Alto impacto e alta prioridade

1. **A verificação de role de restore não exige `NOCREATEDB`, `NOCREATEROLE` e `NOREPLICATION`.** A prova de menor privilégio aceita uma role com poderes administrativos incompatíveis com o contrato pretendido. Evidência: `packages/persistence/src/index.ts:3484`.

2. **A migration 044 não força `NOREPLICATION`.** Mesmo que a role seja criada ou alterada pela migration, o atributo de replicação permanece fora da garantia. Evidência: `db/migrations/044_agent_restore_authority_and_lease_terminality.sql:8`.

3. **A matriz de autoridade PostgreSQL omite atributos críticos.** Os cenários de verificação não cobrem `CREATEDB`, `CREATEROLE` e `REPLICATION`, permitindo regressões sem sinalização. Evidência: `scripts/verify-postgres-restore.ts:522`.

4. **`AUD25-002` e `AUD25-003` foram marcados como concluídos sem cumprir os critérios de aceite.** O estado canônico transmite fechamento superior à prova existente. Evidências: `.agent/backlog.json:8797`, `.agent/backlog.json:8925`, `.agent/state.json:18` e `docs/backlog-melhorias-cvg-aud25-2026-09-20.md:48`.

5. **O verificador de restore fabrica autoridade excessiva.** O teste cria uma role, concede privilégios amplos, inclusive `GRANT ALL`, `CREATE` e ownership, reduzindo a validade da prova de menor privilégio. Evidência: `scripts/verify-postgres-restore.ts:677`.

6. **Não existe prova de rollback para falha tardia durante restore público.** A atomicidade precisa ser demonstrada depois de mutações parciais, não apenas em validações antecipadas.

7. **A matriz de replay, concorrência, estado não vazio, desconexão e `outcome unknown` está incompleta.** Esses cenários são essenciais para evitar duplicação, corrupção ou falsa confirmação em falhas distribuídas.

8. **A evidência estática está inválida.** Quinze checks de SHA ou freshness falharam, portanto documentos e recibos não comprovam a revisão corrente. Evidência: `scripts/verify-static.ts` e saída de `npm run verify:static`.

9. **Não há duas qualificações limpas consecutivas do mesmo fingerprint.** A candidata está suja e inclui arquivos não rastreados; nenhuma execução de CI corresponde inequivocamente ao mesmo sujeito auditado.

10. **A telemetria usa URL bruta como chave e nome de span, permitindo cardinalidade ilimitada.** Uma prova com 10 mil URLs distintas produziu 10 mil entradas no `Map` de operações, com risco de memória, custo e vazamento de identificadores. Evidências: `apps/api/src/app.ts:957` e `packages/ops/src/index.ts:107`.

11. **Vinte e quatro de 32 coleções de domínio continuam snapshot-primary.** Apenas oito têm comandos autoritativos; o restante mantém risco de sobrescrita, concorrência fraca e auditabilidade limitada. Evidência: `packages/persistence/src/index.ts:17`.

12. **Não há pipeline durável de logs.** O collector exporta logs apenas para debug, sem armazenamento pesquisável, retenção ou prova de recuperação operacional. Evidência: `docker/observability/otel-collector.yml:32`.

13. **Não existe prova semelhante à produção de carga, caos, restore gerenciado, RTO e RPO.** Ensaios locais são úteis, mas insuficientes para aprovação operacional.

14. **Faltam gates externos e humanos.** Staging, provedores reais, segredos reais, collector durável, SLOs, testes de aceitação, zoom manual e aprovação humana continuam sem evidência.

### Médio impacto e prioridade intermediária

15. **As linhas de rate limit distribuído não têm política de limpeza.** Buckets antigos podem crescer indefinidamente no banco. Evidência: `db/migrations/023_distributed_rate_limit.sql:3`.

16. **Os schemas de resposta do catálogo de API são metadados, não enforcement.** O backend envia o payload sem validação runtime de egress. Evidências: `packages/contracts/src/api-catalog.ts:81` e `apps/api/src/app.ts:293`.

17. **O adapter de modelos usa `response.text()` sem limite incremental.** Uma resposta grande ou maliciosa pode ser integralmente carregada em memória antes de rejeição. Evidência: `packages/model-adapters/src/index.ts:174`.

18. **A integração de mensagens verifica limite após buffering completo em respostas chunked ou sem tamanho declarado.** O limite não protege a memória durante a leitura. Evidências: `packages/integrations/src/index.ts:691` e `packages/integrations/src/index.ts:744`.

19. **A proteção contra SSRF mantém risco residual de DNS rebinding.** Allowlist de hostname e bloqueio de literais privados não validam necessariamente o endereço resolvido em toda conexão.

20. **Spans abertos podem vazar em abortos e timeouts.** A API encerra a instrumentação principalmente em `onResponse`; conexões abortadas exigem finalização idempotente por todos os caminhos. Evidências: `packages/ops/src/otel.ts:60` e `apps/api/src/app.ts:517`.

21. **O E2E usa portas fixas e `reuseExistingServer: false`.** Execuções concorrentes ou processos residuais causam colisões e falsos negativos. Evidência: `playwright.config.ts:19`.

22. **O teste E2E de acessibilidade em tablet é instável.** O caso falhou no conjunto e passou isoladamente, sinalizando dependência de timing ou estado.

23. **Os testes do root error boundary ignoram WebKit incondicionalmente.** O CI instala WebKit, mas a cobertura permanece desativada. Evidência: `tests/e2e/root-boundary.spec.ts:4`.

24. **O comando de lint não executa um linter semântico real.** O script customizado captura padrões específicos, mas não substitui regras de TypeScript/React, imports e promessas. Evidência: `scripts/lint.ts:4`.

25. **Não há medição nem threshold de cobertura.** O número de testes não garante cobertura mínima das fronteiras críticas.

26. **O bundle web principal está em aproximadamente 573 kB, sem orçamento nem divisão explícita.** Há risco de regressão de carregamento e parse. Evidência: saída de build.

27. **`audit:tokens --strict` não é realmente estrito.** Setenta e três achados médios terminam com exit code zero. Evidência: `scripts/audit-design-tokens.ts:50`.

28. **A verificação de contraste cobre somente sete pares declarados.** Ela não representa temas, estados, componentes e conteúdo renderizado. Evidência: `scripts/check-contrast.ts:3`.

29. **Não existe `.dockerignore`.** O contexto do repositório é de aproximadamente 407 MB, incluindo cerca de 160 MB de `node_modules` e 32 MB de `.git`, aumentando tempo e risco de inclusão acidental.

30. **Imagens base são referenciadas por tags mutáveis.** Node, PostgreSQL e componentes de observabilidade não estão pinados por digest; apenas nginx foi observado como pinado. Evidências: `Dockerfile.api:3`, `docker-compose.yml:3` e `docker-compose.observability.yml:3`.

31. **Proveniência e SBOM OCI nativos estão desativados e não há assinatura.** Manifesto e SBOM npm próprios ajudam, mas não fecham a cadeia de distribuição. Evidência: `.github/workflows/ci.yml:249`.

32. **A API executa TypeScript via `tsx` em produção.** A imagem carrega fontes, scripts e migrations, ampliando superfície e tamanho em vez de executar artefato compilado mínimo. Evidência: `Dockerfile.api:21`.

33. **A documentação está desatualizada ou inconsistente.** O README informa migration 037, 404 testes e verificação estática aprovada; `docs/README.md` cita `AUD25-001` como ativo enquanto o estado observado aponta `AUD25-006`. Evidências: `README.md:15` e `docs/README.md:7`.

34. **Arquivos centrais são monolíticos.** `packages/persistence/src/index.ts` tem cerca de 5.148 linhas, `apps/api/src/app.ts` 2.577, domínio 2.320 e contratos 2.000, aumentando acoplamento e custo de revisão.

35. **`verify:production` empobrece diagnósticos de falha.** O runner mantém somente as últimas três linhas de stderr e descarta stdout do subprocesso quando há erro. Evidência: `scripts/verify-production.ts:671`.

36. **O secret scanning é superficial.** A checagem usa regex customizada, sem scanner dedicado, histórico completo ou conjunto amplo de detectores.

### Baixo impacto e menor prioridade

37. **O `packageManager` não fixa versão exata.** A reprodução pode variar entre releases do gerenciador. Evidência: `package.json:7`.

38. **Faltam arquivos básicos de governança.** Não foram encontrados `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` e `LICENSE` adequados ao projeto.

39. **O TypeScript relaxa verificações úteis.** `skipLibCheck` está habilitado e `noUnusedLocals`/`noUnusedParameters` não são impostos. Evidência: `tsconfig.json:9`.

## 6. Ranking de resolução

### Prioridade 0 — bloqueadores de integridade e promoção

1. Reabrir `AUD25-002` e `AUD25-003` e corrigir a verdade do control plane.
2. Fechar os sete atributos de role, a migration e a matriz PostgreSQL.
3. Remover a autoridade artificialmente ampla do verificador de restore.
4. Provar rollback tardio, replay, concorrência, desconexão e `outcome unknown`.
5. Normalizar e limitar cardinalidade de telemetria e encerrar spans em abortos/timeouts.
6. Restaurar evidências correntes e obter duas qualificações limpas do mesmo fingerprint.

### Prioridade 1 — confiabilidade, dados e operação

7. Implantar logs duráveis, SLOs e exercícios de alerta.
8. Migrar coleções snapshot-primary para comandos autoritativos, começando por finanças, estoque, hospital e IA.
9. Limitar leituras de respostas externas e reforçar DNS/SSRF.
10. Aplicar lifecycle aos buckets de rate limit e validação runtime às respostas da API.
11. Executar carga, caos, restore gerenciado e medir RTO/RPO.

### Prioridade 2 — engenharia, frontend e supply chain

12. Adotar ESLint semântico, cobertura com thresholds e estabilizar o E2E.
13. Criar orçamentos de bundle, tokens e contraste renderizado.
14. Criar `.dockerignore`, compilar a API e reduzir a imagem de runtime.
15. Pinar imagens por digest, emitir SBOM/proveniência OCI e assinar artefatos.
16. Melhorar diagnósticos dos verificadores, modularizar arquivos e endurecer o TypeScript.
17. Sincronizar documentação e adicionar arquivos de governança.

### Gate final — autoridade externa ou humana

18. Qualificar staging e provedores reais com segredos gerenciados.
19. Validar collector durável, SLOs, testes de aceitação e inspeção visual manual.
20. Obter aprovação humana explícita para promoção.

## 7. Pontos fortes preserváveis

- Autenticação com scrypt, TOTP e WebAuthn.
- Cookies `httpOnly`, `SameSite` e `Secure`, além de CSRF, CSP, limite de corpo e configuração de proxy confiável.
- PDP universal com cobertura extensa de operações, ferramentas e domínios.
- RLS, ledgers append-only, idempotência, outbox, leases, fencing e semântica de `outcome unknown` já presentes em partes relevantes.
- TypeScript com base estrita e catálogo consistente de contratos e rotas.
- 576 testes aprovados, `npm audit` sem vulnerabilidades e licenças verificadas.
- Actions do GitHub pinadas por SHA, uso de Trivy e geração própria de SBOM.
- Documentação reconhece corretamente que a qualificação Triple-A externa ainda não foi demonstrada.

## 8. Critérios para mudar o veredito

O veredito só deve mudar de **promoção bloqueada** quando, no mínimo:

1. todos os achados de alto impacto estiverem implementados e comprovados;
2. não houver item crítico falsamente marcado como concluído;
3. o restore provar menor privilégio, atomicidade tardia e cenários distribuídos adversos;
4. a telemetria estiver limitada, normalizada e encerrada em todos os caminhos;
5. houver persistência durável de logs e evidência de alertas/SLOs;
6. as verificações estáticas e de produção estiverem verdes para a revisão corrente;
7. duas qualificações limpas consecutivas apontarem para o mesmo fingerprint;
8. gates externos e humanos estiverem registrados por suas autoridades legítimas.

## 9. Documentos derivados

- [Plano executivo](./plano-executivo-melhorias-auditoria-2026-09-21.md)
- [Roadmap de implementação](./roadmap-melhorias-auditoria-2026-09-21.md)
- [Backlog completo](./backlog-melhorias-auditoria-2026-09-21.md)
- [Prompt para Codex](./prompt-codex-implementacao-auditoria-2026-09-21.md)

Este relatório é um registro do estado auditado, não uma aprovação de release e não substitui o estado canônico do programa em `.agent`.
