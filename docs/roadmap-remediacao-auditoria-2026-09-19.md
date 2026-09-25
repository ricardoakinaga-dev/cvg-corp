# Roadmap de remediação da auditoria — 2026-09-19

> **Superado em 2026-09-20:** a reauditoria encontrou regressões e provas inválidas no resultado AUD19. A sequência vigente está no [roadmap CVG-AUD20](roadmap-melhorias-cvg-aud20-2026-09-20.md), apoiado pela [nova auditoria](auditoria-resultado-cvg-aud19-2026-09-20.md).

**Estado:** PROPOSTO<br>
**Origem:** [Auditoria de código de 2026-09-19](auditoria-codigo-2026-09-19.md)<br>
**Backlog executável:** [Backlog de remediação](backlog-remediacao-auditoria-2026-09-19.md)<br>
**Perfil:** brownfield, T4/risco crítico, com exposição clínica, autorização, persistência e recuperação<br>
**Restrição:** este documento não autoriza deploy, uso de dados reais, credenciais, provider real ou aceitação de risco

## 1. Objetivo

Conduzir o sistema do estado auditado `FAIL / 75` para um candidato verificável, sem achados altos conhecidos e com evidência atual vinculada ao mesmo SHA e aos mesmos artefatos promovidos.

O roadmap ordena resultados e gates. Ele não cria datas artificiais: calendário e capacidade deverão ser definidos pelos responsáveis humanos depois da atribuição do backlog.

## 2. Princípios de execução

1. Fechar primeiro exposição de dados, autorização, perda de estado e concorrência.
2. Obter uma reprodução conhecida-ruim antes de alterar cada comportamento material.
3. Resolver o recurso real antes de autorizar; nunca aceitar unidade/workspace declarados pelo chamador como facts autoritativos.
4. Validar persistência, migrations, RLS, grants, restore e concorrência em PostgreSQL real descartável.
5. Separar `LOCAL_PASS`, `STAGING_PASS`, `BLOCKED_EXTERNAL` e aprovação humana.
6. Regenerar evidências somente depois que o código e o harness estiverem estabilizados.
7. Não reduzir metas ou transformar `NOT_RUN` em sucesso para fechar o programa.
8. Cada marco deve terminar com uma demonstração observável e uma revisão adversarial fresca.

## 3. Sequência de marcos

| Marco | Resultado esperado | Itens principais | Gate de saída |
|---|---|---|---|
| M0 — Contenção e harness | Caminho clínico vulnerável contido e reproduções permanentes | CVG-AUD19-001, 002, 003 | G0 — exposição contida |
| M1 — Autorização e sessões | Recursos autoritativamente resolvidos; TTL, ownership e leases corretos | 004–008 | G1 — trust boundary aprovado |
| M2 — Banco, persistência e recovery | Readiness completo, grants mínimos, concorrência isolada e restore integral | 009–014 | G2 — durabilidade aprovada |
| M3 — Workers e efeitos | Sucesso somente após acknowledge e cancelamento cooperativo comprovado | 015–017 | G3 — efeitos confiáveis |
| M4 — Frontend e operação | Contratos fail-closed, recuperação visual, alertas e logs duráveis | 018–023 | G4 — produto operável |
| M5 — Evidência e promoção | Pacote exact-SHA, provas externas e decisão humana | 024–030 | G5 — decisão de release |

## 4. M0 — Contenção e harness discriminante

### Objetivo

Interromper a possibilidade de nova divulgação entre workspaces e transformar os dois defeitos reproduzidos — acesso clínico e TTL expirado — em regressões que falham no estado atual.

### Entregas

- Contenção explícita de `cvg.clinical.draft` enquanto a resolução autoritativa não estiver implantada.
- Teste HTTP atravessando autenticação, contexto, PDP, runtime, tool executor e um provider-capture.
- Teste determinístico com relógio controlado para sessão expirada.
- Registro de possível exposição histórica e procedimento de investigação, sem presumir que houve incidente real.

### Gate G0

- O conhecido-ruim cross-workspace falha antes da correção e passa depois dela.
- Nenhum metadado do recurso estrangeiro aparece na entrada capturada do provider.
- O caso same-workspace autorizado continua funcional.
- O caminho vulnerável fica desabilitado ou corrigido em todos os modos de runtime.
- A contenção recebe revisão independente.

## 5. M1 — Trust boundary, autorização e sessões

### Objetivo

Garantir que autorização e ferramentas operem sobre fatos resolvidos do recurso, e que sessões/leases tenham ownership, expiração e exclusão mútua coerentes.

### Entregas

- Resolver `resourceId` para organização, unidade, workspace, paciente e atendimento antes do PDP.
- Rejeitar divergência entre `resourceId`, `encounterId` e contexto.
- Aplicar `actorId` no contrato e nas queries PostgreSQL de turnos/checkpoints, ou remover o campo do contrato mediante decisão arquitetural explícita.
- Impedir load e lease de sessões expiradas; definir transição terminal consistente.
- Impedir duas execuções simultâneas na mesma sessão, inclusive com idempotency keys diferentes e mesmo owner.
- Testar revogação, mudança de contexto, replay, expiração e duas instâncias.

### Gate G1

- Matriz same/cross organization, unit, workspace, actor, patient e encounter passa em API e persistence.
- O PDP recebe facts derivados do repositório autoritativo.
- Sessão expirada não pode ser carregada nem adquirir lease.
- Uma segunda execução não realiza chamada de provider/tool enquanto a primeira detém a sessão.
- Testes adversariais de agente passam com o novo caso conhecido-ruim.

## 6. M2 — Banco, persistência e recovery

### Objetivo

Eliminar estados verdes falsos, garantir isolamento por requisição e tornar o estado durável do agente parte integral de backup e restore.

### Entregas

- `assertSchema` e readiness exigindo migrations 038/039 e objetos essenciais.
- Bundle versionado contendo sessões, turnos, checkpoints e leases, com digests e validação de tenant.
- Restore que reconstrói ou encerra leases de forma segura e prova retomada/reconciliação.
- `REVOKE` explícito de DML não necessário; teste de `has_table_privilege` e tentativas negativas.
- Isolamento de store/transação para rotas remotas sem manter trava durante chamadas externas.
- Testes de concorrência multi-instância, conflito, rollback e crash entre provider e commit.

### Gate G2

- Serviço não anuncia readiness com schema 037.
- Backup/restore round-trip compara linhas, digests e invariantes das quatro tabelas do agente.
- `cvg_runtime` não possui `DELETE` sobre sessões/turnos/checkpoints nem DML desnecessário.
- Requisições concorrentes não misturam snapshots nem efeitos.
- PostgreSQL real descartável passa migrations, privilégios, RLS, concorrência e restore no mesmo SHA.

## 7. M3 — Workers, timeout e efeitos externos

### Objetivo

Fazer auditoria e métricas refletirem o estado durável real e impedir continuação silenciosa de trabalho após timeout.

### Entregas

- Estado `SUCCEEDED` e métrica de sucesso somente após acknowledge durável.
- Estado intermediário ou reconciliação explícita quando o efeito ocorreu e o acknowledge falhou.
- Contrato cooperativo de cancelamento para handlers e adapters.
- Testes de timeout, handler não cooperativo, perda de lease, ack failure, duplicate delivery e restart.
- Semântica documentada para `OUTCOME_UNKNOWN` e reconciliação.

### Gate G3

- Não existe auditoria `SUCCEEDED` antes do commit/ack correspondente.
- Falha de ack não produz dois efeitos externos.
- Timeout impede novo efeito do handler antigo ou o coloca em reconciliação observável.
- Execução multiprocesso/multi-instância passa em PostgreSQL real.

## 8. M4 — Frontend, observabilidade e desempenho

### Objetivo

Tornar contratos da interface fail-closed, impedir quebra total da aplicação por payload e fornecer detecção operacional persistente.

### Entregas

- Schema runtime para todo endpoint consumido pela UI, sem fallback silencioso `passthrough`.
- Error boundary raiz e estados recuperáveis com correlation ID sanitizado.
- Proteção contra resposta obsoleta na busca de pacientes.
- Prometheus ligado ao Alertmanager, com teste real de firing/resolution/delivery.
- Logs estruturados, redigidos e exportados para armazenamento durável, correlacionados com trace/request.
- Budget de bundle e lazy loading por rotas onde medido como benéfico.
- CI falhando em teste flaky; lint real de TypeScript/React Hooks/a11y.

### Gate G4

- Payload malformado em cada família de endpoint é rejeitado sem tela branca.
- Resposta antiga não substitui uma busca mais recente.
- Um alerta controlado percorre regra, Prometheus, Alertmanager e receiver.
- Logs permanecem pesquisáveis após reinício do processo.
- Budget de bundle e Core Web Vitals alvo estão definidos e passam em ambiente representativo.
- Chromium, Firefox e WebKit funcionais passam nos viewports previstos; AT/zoom real permanece requisito separado.

## 9. M5 — Evidência exact-SHA e promoção

### Objetivo

Produzir um candidato imutável cuja origem, testes, imagens, ambientes e aprovações possam ser verificados sem depender de scorecards históricos.

### Entregas

- Gates de proveniência vinculando `subjectSha`, worktree, digests e artefatos.
- `verify:state-of-art-external` retornando processo diferente de zero quando requisitos obrigatórios estiverem bloqueados.
- Matriz completa atual de browsers, acessibilidade manual, PostgreSQL, load/chaos, recovery e observabilidade.
- Staging com imagens imutáveis, SBOM, scans e assinaturas do mesmo SHA.
- Verticais autorizadas de DeepSeek/provider, callback e reconciliação.
- Scorecards/documentação sincronizados sem transportar fatos históricos como atuais.
- Crítica final independente e decisão humana registrada.

### Gate G5

- Todos os critérios obrigatórios do quality bar possuem evidência `CURRENT` no mesmo candidato.
- Nenhum achado alto ou crítico permanece aberto.
- `verify:static`, suites locais, CI, imagens e staging concordam sobre SHA e digests.
- RTO/RPO, SLOs, runbooks e ownership operacional estão aprovados.
- Release somente após autoridade humana explícita; automação não autoaprova produção.

## 10. Dependências principais

```text
contenção + regressões conhecidas-ruins
  ├── resolução autoritativa de recurso ── PDP/tool gateway
  └── TTL + lease + actor scope ── concorrência de sessão

schema/readiness ── recovery completo ── restore PostgreSQL real
        └── grants mínimos

isolamento de request/store ── workers/efeitos ── load e chaos

frontend fail-closed + observabilidade durável
        └── matriz integrada e staging

todos os marcos ── evidência exact-SHA ── crítica final ── decisão humana
```

## 11. Trilhas que podem avançar em paralelo

Depois de G0, as seguintes trilhas podem ser executadas em paralelo, desde que arquivos compartilhados tenham um único owner por intervalo:

- sessões/leases e resolução autoritativa;
- recovery/readiness/grants e desenho de isolamento de request;
- frontend contracts e topologia de observabilidade;
- harness de evidência e preparação de ambientes externos.

Integração final, `apps/api/src/app.ts`, `packages/persistence/src/index.ts`, migrations e arquivos de estado/evidência exigem coordenação central.

## 12. Métricas de progresso

- Quantidade de achados altos reproduzíveis ainda abertos.
- Percentual de endpoints UI com schema runtime fail-closed.
- Cobertura da matriz de escopo: organização/unidade/workspace/ator/recurso.
- Percentual de tabelas duráveis cobertas por backup/restore e verificação de digest.
- Testes de concorrência/timeout que demonstram caso conhecido-ruim e corrigido.
- Alertas com entrega comprovada e logs com retenção/reinício comprovados.
- Critérios do quality bar com evidência `CURRENT` no mesmo SHA.
- Zero diferenças entre HEAD, CI, SBOM, imagem e manifesto de promoção.

## 13. Estado inicial do programa

- M0–M5: `PROPOSTO`.
- Nenhum item deste roadmap está implicitamente aprovado ou iniciado.
- O worktree já possuía mudanças fora destes documentos; elas não devem ser incorporadas, revertidas ou reclassificadas sem reconciliação própria.
- O primeiro item executável recomendado é `CVG-AUD19-001`, seguido de `CVG-AUD19-002` e `CVG-AUD19-003`.
