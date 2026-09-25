# Backlog de remediação da auditoria — 2026-09-19

> **Superado em 2026-09-20:** itens AUD19 declarados `DONE` foram reabertos por contraprovas. O backlog corrente é o [CVG-AUD20](backlog-melhorias-cvg-aud20-2026-09-20.md); a justificativa está na [reauditoria](auditoria-resultado-cvg-aud19-2026-09-20.md). Este arquivo preserva os contratos históricos.

**Estado do catálogo:** PROPOSTO<br>
**Origem:** [Auditoria de código](auditoria-codigo-2026-09-19.md)<br>
**Sequenciamento:** [Roadmap de remediação](roadmap-remediacao-auditoria-2026-09-19.md)<br>
**Escopo:** propostas de remediação; nenhum item está implicitamente iniciado, aprovado ou concluído

## 1. Legenda

- **P0:** exposição de dados, autorização, perda de estado, concorrência ou falso sucesso; bloqueia produção.
- **P1:** confiabilidade, operação, UX resiliente ou evidência obrigatória; necessário antes do candidato.
- **P2:** otimização e robustez que não substituem o fechamento dos P0/P1.
- **S/M/L/XL:** tamanho relativo proposto; não representa prazo.
- **PROPOSTO:** ainda exige refinamento, owner e reserva de superfície antes de `READY`.
- Owners abaixo são perfis propostos, não atribuições humanas confirmadas.

## 2. Visão consolidada

| ID | Pri. | Marco | Tam. | Resultado | Dependências | Owner proposto | Estado |
|---|---|---|---|---|---|---|---|
| CVG-AUD19-001 | P0 | M0 | S | Conter imediatamente `cvg.clinical.draft` vulnerável | — | Segurança/API | PROPOSTO |
| CVG-AUD19-002 | P0 | M0 | M | Regressão HTTP cross-workspace com provider-capture | CVG-AUD19-001 | Qualidade/segurança | PROPOSTO |
| CVG-AUD19-003 | P0 | M0 | S | Regressão determinística de TTL expirado | — | Runtime/qualidade | PROPOSTO |
| CVG-AUD19-004 | P0 | M1 | L | Resolver recurso autoritativamente antes do PDP | CVG-AUD19-002 | Arquitetura/API | PROPOSTO |
| CVG-AUD19-005 | P0 | M1 | M | Alimentar PDP somente com facts resolvidos | CVG-AUD19-004 | Segurança/PDP | PROPOSTO |
| CVG-AUD19-006 | P0 | M1 | M | Endurecer tool gateway contra divergência de escopo | CVG-AUD19-004, CVG-AUD19-005 | Runtime/segurança | PROPOSTO |
| CVG-AUD19-007 | P0 | M1 | M | Aplicar actor scope em turnos/checkpoints | CVG-AUD19-004 | Persistência | PROPOSTO |
| CVG-AUD19-008 | P0 | M1 | L | Corrigir TTL, lease e exclusão mútua por sessão | CVG-AUD19-003 | Runtime/persistência | PROPOSTO |
| CVG-AUD19-009 | P0 | M2 | M | Exigir migrations 038/039 no startup/readiness | — | Persistência/API | PROPOSTO |
| CVG-AUD19-010 | P0 | M2 | L | Incluir estado do agente no recovery bundle | CVG-AUD19-009 | Persistência/recovery | PROPOSTO |
| CVG-AUD19-011 | P0 | M2 | L | Provar restore integral e sem leases zumbis | CVG-AUD19-010 | Recovery/qualidade | PROPOSTO |
| CVG-AUD19-012 | P0 | M2 | M | Revogar DML excessivo do papel de runtime | CVG-AUD19-009 | DBA/segurança | PROPOSTO |
| CVG-AUD19-013 | P0 | M2 | M | Definir isolamento transacional das rotas remotas | CVG-AUD19-004, CVG-AUD19-008 | Arquitetura | PROPOSTO |
| CVG-AUD19-014 | P0 | M2 | L | Implementar e provar isolamento do store por request | CVG-AUD19-013 | API/persistência | PROPOSTO |
| CVG-AUD19-015 | P0 | M3 | M | Registrar sucesso somente após ack durável | — | Workers/persistência | PROPOSTO |
| CVG-AUD19-016 | P0 | M3 | M | Tornar timeout/cancelamento cooperativo | CVG-AUD19-015 | Workers/integrações | PROPOSTO |
| CVG-AUD19-017 | P0 | M3 | L | Matriz worker de ack, retry, crash e duplicidade | CVG-AUD19-015, CVG-AUD19-016 | Qualidade/workers | PROPOSTO |
| CVG-AUD19-018 | P1 | M4 | L | Validar runtime todos os payloads consumidos pela UI | — | Contratos/frontend | PROPOSTO |
| CVG-AUD19-019 | P1 | M4 | M | Adicionar error boundary e recuperação observável | CVG-AUD19-018 | Frontend/UX | PROPOSTO |
| CVG-AUD19-020 | P1 | M4 | S | Eliminar resposta obsoleta na busca de pacientes | — | Frontend | PROPOSTO |
| CVG-AUD19-021 | P1 | M4 | M | Conectar e provar Prometheus → Alertmanager | — | Plataforma/SRE | PROPOSTO |
| CVG-AUD19-022 | P1 | M4 | L | Exportar e reter logs estruturados/redigidos | CVG-AUD19-021 | Plataforma/SRE | PROPOSTO |
| CVG-AUD19-023 | P2 | M4 | M | Gates de bundle, Core Web Vitals, lint e flaky tests | CVG-AUD19-018 | Frontend/qualidade | PROPOSTO |
| CVG-AUD19-024 | P1 | M5 | L | Vincular proveniência e evidências ao exact-SHA | CVG-AUD19-006, CVG-AUD19-011, CVG-AUD19-014, CVG-AUD19-017, CVG-AUD19-019, CVG-AUD19-021, CVG-AUD19-022 | DevOps/qualidade | PROPOSTO |
| CVG-AUD19-025 | P1 | M5 | S | Fazer bloqueio externo resultar em exit não zero | — | Qualidade/DevOps | PROPOSTO |
| CVG-AUD19-026 | P1 | M5 | L | Matriz Chromium/Firefox/WebKit e acessibilidade manual | CVG-AUD19-019, CVG-AUD19-023, CVG-AUD19-024 | QA/a11y | PROPOSTO |
| CVG-AUD19-027 | P1 | M5 | XL | PostgreSQL, carga, chaos, backup e RTO/RPO atuais | CVG-AUD19-008, CVG-AUD19-011, CVG-AUD19-012, CVG-AUD19-014, CVG-AUD19-017, CVG-AUD19-024 | SRE/DBA/qualidade | PROPOSTO |
| CVG-AUD19-028 | P1 | M5 | XL | Staging, imagens imutáveis e providers reais | CVG-AUD19-024, CVG-AUD19-025, CVG-AUD19-027 | Plataforma/integrações | PROPOSTO |
| CVG-AUD19-029 | P1 | M5 | M | Sincronizar docs/scorecards e executar reauditagem | CVG-AUD19-026, CVG-AUD19-027, CVG-AUD19-028 | Lead/auditoria | PROPOSTO |
| CVG-AUD19-030 | P1 | M5 | S | Decisão humana de release e risco residual | CVG-AUD19-029 | Autoridade de release | PROPOSTO |

## 3. Contratos dos itens

### CVG-AUD19-001 — Conter o caminho clínico vulnerável

**Origem:** AUD-2026-001<br>
**Superfície provável:** `apps/api/src/agent-tool-executor.ts`, admissão de `/api/v1/ai/turns`, policy/tool catalog.

Aceite:

- Enquanto a correção estrutural não estiver pronta, nenhuma chamada com recurso não resolvido executa `cvg.clinical.draft`.
- A negação ocorre antes de tool/provider e gera auditoria sanitizada.
- O fluxo same-workspace conhecido-bom permanece explicitamente coberto ou a indisponibilidade temporária é declarada.

Evidência de fechamento: teste HTTP negativo e captura comprovando zero dispatch ao provider/tool, revisão de segurança e regressão das demais ferramentas.

### CVG-AUD19-002 — Criar regressão HTTP com provider-capture

**Origem:** AUD-2026-001 e lacuna do harness.<br>
**Superfície provável:** testes API/integração, fake provider observável e fixtures multi-workspace.

Aceite:

- Fixture inclui mesma organização, workspaces A/B, pacientes e encounters distintos.
- `resourceId` estrangeiro com `encounterId` ausente falha antes do provider.
- Divergência entre `resourceId` e `encounterId` também falha.
- O conhecido-ruim falha contra o código vulnerável, provando o harness.

Evidência de fechamento: request/response, contagem zero de chamadas e bytes sanitizados capturados no provider fake.

### CVG-AUD19-003 — Fixar regressão de TTL expirado

**Origem:** AUD-2026-004.<br>
**Superfície provável:** `packages/agent-session`, testes de relógio e stores memory/PostgreSQL.

Aceite:

- Relógio determinístico prova load/lease antes e depois do vencimento.
- O mesmo contrato roda contra implementação memory e PostgreSQL.
- Estado terminal/limpeza após expiração é explicitado.

Evidência de fechamento: conhecido-ruim falha no baseline e passa após CVG-AUD19-008.

### CVG-AUD19-004 — Resolver o recurso autoritativamente

**Origem:** AUD-2026-001.<br>
**Superfície provável:** contratos de input, application service, repositórios/read services e contexto do agente.

Aceite:

- `resourceId` é resolvido para tipo e ownership reais antes do PDP.
- Organização, unidade, workspace, ator, paciente e encounter provêm da fonte autoritativa.
- Recurso ausente, tipo incorreto ou facts divergentes falham fechado.
- A API não fabrica facts do recurso a partir do contexto do chamador.

Evidência de fechamento: matriz de escopo API + application + persistence com casos same/cross boundary.

### CVG-AUD19-005 — Usar facts resolvidos no PDP

**Origem:** AUD-2026-001.<br>
**Dependência:** contrato produzido por CVG-AUD19-004.

Aceite:

- PDP recebe identidade e escopo resolvidos do recurso.
- Nenhum caller pode sobrescrever facts autoritativos.
- Regras e logs distinguem `subject`, `context` e `resource` sem incluir PII desnecessária.

Evidência de fechamento: teste de mutação/negação e cobertura estrutural das rotas/ferramentas.

### CVG-AUD19-006 — Endurecer o tool gateway

**Origem:** AUD-2026-001.<br>
**Dependências:** CVG-AUD19-004 e 005.

Aceite:

- Tool executor revalida tipo, organização, unidade, workspace e relação paciente/encounter.
- Aprovação ou policy antiga não autoriza recurso alterado.
- Result preview e mensagens enviadas ao modelo são minimizados.

Evidência de fechamento: regressão provider-capture, replay e troca de contexto/recurso.

### CVG-AUD19-007 — Fechar actor scope na persistência de sessão

**Origem:** AUD-2026-008.<br>
**Superfície provável:** `packages/agent-session`, migration/policies e testes PostgreSQL.

Aceite:

- `latestCheckpoint` e `listTurns` aplicam o mesmo ownership declarado pelo contrato.
- Se `actorId` não for a fronteira desejada, uma decisão arquitetural altera contrato, callers e testes antes da implementação.
- Tentativas cross-actor falham na aplicação e, quando aplicável, no banco.

Evidência de fechamento: testes memory/PostgreSQL e consulta negativa com actor diferente.

### CVG-AUD19-008 — Corrigir TTL, lease e exclusão mútua

**Origem:** AUD-2026-004.<br>
**Superfície provável:** `packages/agent-session`, runtime embarcado e dedup de in-flight.

Aceite:

- Sessão expirada não pode ser carregada nem receber/renovar lease.
- Mesmo owner não toma um lease vivo para iniciar trabalho sobreposto.
- Exclusão mútua é por sessão, não apenas por idempotency key.
- Perda de fence interrompe o trabalho antes de novo tool/provider, ou produz reconciliação explícita.

Evidência de fechamento: relógio controlado e teste concorrente multi-instância com duas chaves.

### CVG-AUD19-009 — Tornar o schema do agente obrigatório no readiness

**Origem:** AUD-2026-003.<br>
**Superfície provável:** `assertSchema`, `/ready`, health do agent runtime e testes de migration.

Aceite:

- Schema 037 falha readiness com razão estável e sem vazar detalhes sensíveis.
- Objetos/constraints únicos de 038/039 são verificados.
- Schema completo passa e executa um smoke de sessão durável.

Evidência de fechamento: PostgreSQL real nos estados 037, 038 e 039.

### CVG-AUD19-010 — Incluir tabelas do agente no recovery bundle

**Origem:** AUD-2026-002.<br>
**Superfície provável:** tipos/manifest do bundle, export/import e digests.

Aceite:

- Sessões, turnos, checkpoints e leases possuem representação versionada no bundle.
- Digests, tenant, ordem e referências são validados.
- Compatibilidade com bundles anteriores tem política explícita de migração ou rejeição.
- Segredos e payloads desnecessários não são adicionados.

Evidência de fechamento: round-trip determinístico e rejeição de bundle adulterado.

### CVG-AUD19-011 — Provar restore do runtime do agente

**Origem:** AUD-2026-002.<br>
**Dependência:** CVG-AUD19-010.

Aceite:

- Restore compara contagens, digests, ownership e continuidade de turnos/checkpoints.
- Lease ativo não revive silenciosamente depois do restore; a política escolhida é testada.
- Uma sessão restaurada pode retomar com fence correto ou é encerrada de forma explícita.
- Falha parcial não publica restore como concluído.

Evidência de fechamento: PostgreSQL real descartável, backup criptografado, restore e smoke funcional.

### CVG-AUD19-012 — Aplicar least privilege ao papel PostgreSQL

**Origem:** AUD-2026-006.<br>
**Superfície provável:** migrations de grants e verificadores de privilégios.

Aceite:

- Migration aplica `REVOKE` explícito antes dos grants permitidos.
- `has_table_privilege` prova a matriz esperada em todas as tabelas do runtime.
- `DELETE` em sessões/turnos/checkpoints e writes indevidos falham como `cvg_runtime`.
- Upgrade a partir de 022 + 038 e instalação limpa convergem para os mesmos grants.

Evidência de fechamento: matriz SQL positiva/negativa no caminho real de migrations.

### CVG-AUD19-013 — Definir isolamento das rotas remotas

**Origem:** AUD-2026-005.<br>
**Natureza:** decisão de arquitetura antes do BUILD.

Aceite:

- Escolher unidade de trabalho sem store singleton mutável entre requests.
- Explicitar fronteiras antes/depois do provider, CAS/revision, idempotência e `OUTCOME_UNKNOWN`.
- Avaliar compatibilidade com rotas locais, testes, snapshots e persistência atual.
- Definir rollback/roll-forward e observabilidade de conflitos.

Evidência de fechamento: ADR aprovado e dois cenários concorrentes executáveis congelados.

### CVG-AUD19-014 — Implementar isolamento do store por request

**Origem:** AUD-2026-005.<br>
**Dependência:** CVG-AUD19-013.

Aceite:

- Uma requisição não observa nem persiste mutações não confirmadas de outra.
- Chamada externa não mantém trava global, mas o commit usa revisão/baseline coerentes.
- Conflito não deixa mutação aplicada com resposta de falha enganosa.
- Crash em cada fronteira possui resultado recuperável.

Evidência de fechamento: teste concorrente com barriers determinísticas e persistência observada.

### CVG-AUD19-015 — Mover sucesso para depois do acknowledge

**Origem:** AUD-2026-007.<br>
**Superfície provável:** worker runtime, outbox/job completion, audit e métricas.

Aceite:

- `SUCCEEDED` e contador de sucesso são emitidos apenas depois da confirmação durável.
- Falha de acknowledge possui estado diferente de sucesso e caminho de reconciliação.
- Auditoria preserva o efeito observado sem afirmar conclusão falsa.

Evidência de fechamento: falha injetada em `complete*`, inspeção do ledger/job/audit/metrics e retry.

### CVG-AUD19-016 — Cancelamento cooperativo end-to-end

**Origem:** AUD-2026-007.<br>
**Dependência:** CVG-AUD19-015.

Aceite:

- Handlers e adapters recebem e respeitam `AbortSignal` nos pontos bloqueantes.
- Após timeout, o handler antigo não inicia novo efeito.
- Handler comprovadamente não cancelável usa fence/reconciliação apropriado.
- Recursos, sockets e timers são encerrados.

Evidência de fechamento: fake lento, timeout, inspeção de efeito/telemetria e ausência de handles pendentes.

### CVG-AUD19-017 — Matriz adversarial de workers

**Origem:** AUD-2026-007.<br>
**Dependências:** CVG-AUD19-015 e 016.

Aceite:

- Cobrir ack failure, lease loss, crash antes/depois do efeito, duplicidade, poison job e restart.
- Provar no máximo um efeito ou reconciliação explícita.
- Executar com pelo menos duas instâncias e PostgreSQL real.

Evidência de fechamento: ledger, receipts, audit, métricas e estado final por cenário.

### CVG-AUD19-018 — Fechar contratos runtime do frontend

**Origem:** AUD-2026-009.<br>
**Superfície provável:** `apps/web/src/api`, contracts compartilhados e consumidores.

Aceite:

- Todo endpoint consumido pela UI possui schema e versão/compatibilidade definidos.
- Endpoint não registrado falha fechado em vez de `passthrough`, salvo allowlist documentada.
- Payload malformado não alcança o estado de componente.
- Erro preserva correlation ID sanitizado e estado recuperável.

Evidência de fechamento: testes contratuais e browser interception de payload ruim por família de endpoint.

### CVG-AUD19-019 — Error boundary e recuperação da UI

**Origem:** AUD-2026-009.<br>
**Dependência:** CVG-AUD19-018.

Aceite:

- Erro inesperado não deixa tela branca nem expõe stack/dados.
- Usuário pode tentar novamente ou voltar a uma rota segura.
- Foco e live region anunciam o erro de forma acessível.

Evidência de fechamento: componente conhecido-ruim em browser, screenshot/axe e recuperação funcional.

### CVG-AUD19-020 — Impedir resposta obsoleta na busca de pacientes

**Origem:** achado secundário de frontend.<br>
**Superfície provável:** `apps/web/src/features/patients/Patients.tsx`.

Aceite:

- Busca anterior atrasada não substitui o resultado da consulta mais nova.
- Cancelamento/sequence guard funciona em sucesso, erro e unmount.
- Loading e empty state correspondem à consulta atual.

Evidência de fechamento: E2E com respostas deliberadamente invertidas.

### CVG-AUD19-021 — Conectar Prometheus ao Alertmanager

**Origem:** AUD-2026-010.<br>
**Superfície provável:** configuração Prometheus/Compose, verifier e runbook.

Aceite:

- `alerting.alertmanagers` aponta para o serviço correto.
- Verificador estrutural falha quando a conexão é removida.
- Alerta controlado dispara, chega ao receiver e resolve.
- Falha do receiver é observável.

Evidência de fechamento: estado da regra/alerta, entrega sanitizada e timestamps firing/resolved.

### CVG-AUD19-022 — Logs estruturados e duráveis

**Origem:** AUD-2026-010.<br>
**Dependência:** topologia operacional de CVG-AUD19-021.

Aceite:

- API/workers exportam logs redigidos com correlation/trace IDs.
- Pipeline possui backend/retention definidos e health observável.
- Reinício do processo não apaga logs já exportados.
- Teste conhecido-ruim detecta PII/segredo antes da exportação.

Evidência de fechamento: consulta no backend após restart e teste de redação.

### CVG-AUD19-023 — Qualidade e performance do frontend

**Origem:** achados secundários de frontend/CI.<br>
**Superfície provável:** Vite, rotas, ESLint, Playwright e CI.

Aceite:

- Budget de bundle e métricas de navegação representativas definidos.
- Rotas pesadas usam splitting somente quando medição demonstra benefício.
- CI falha em flaky tests e roda lint de TS/React Hooks/a11y.
- Contraste não depende apenas de sete pares hard-coded.

Evidência de fechamento: build/budget, Core Web Vitals em ambiente definido, known-flaky rejeitado e lint com caso ruim.

### CVG-AUD19-024 — Proveniência exact-SHA

**Origem:** AUD-2026-011.<br>
**Superfície provável:** snapshot, current state, docs provenance, CI e manifesto.

Aceite:

- `subjectSha`, HEAD, worktree, CI, SBOM, imagens e evidências possuem identidade coerente.
- `WORKTREE` não aceita qualquer sujeira como prova do sujeito.
- Artefato alterado, expirado ou de outro SHA faz o gate falhar.
- Recaptura não reaproveita sucesso histórico sem executar o procedimento.

Evidência de fechamento: matriz conhecida boa/ruim para SHA, bytes, mtime/window, dirty paths e digest.

### CVG-AUD19-025 — Corrigir semântica de exit do verifier externo

**Origem:** lacuna de gate observada.<br>
**Superfície provável:** `scripts/verify-state-of-art-external.ts` e orquestradores.

Aceite:

- Requisito obrigatório `BLOCKED_EXTERNAL` não retorna exit zero no gate de release.
- Modo informativo, se mantido, tem comando/nome/contrato distinto.
- CI não consegue interpretar bloqueio como verde.

Evidência de fechamento: execução sem credenciais e com fixture autorizada, verificando exit/status/artifact.

### CVG-AUD19-026 — Browser e acessibilidade atuais

**Origem:** limitações de testes/acessibilidade.<br>
**Dependências:** CVG-AUD19-019, 023 e 024.

Aceite:

- Chromium, Firefox e WebKit executam assertions nos viewports configurados.
- Zero flaky pass oculto por retry.
- Leitor de tela, teclado, touch e zoom real de 200% seguem roteiro documentado.
- Evidência é vinculada ao mesmo SHA do candidato.

Evidência de fechamento: relatório Playwright, traces dos erros reais e registro manual com limitações.

### CVG-AUD19-027 — Provas operacionais atuais

**Origem:** lacunas de banco, performance, recovery e operação.<br>
**Dependências:** CVG-AUD19-008, 011, 012, 014, 017 e 024.

Aceite:

- Migrations 001–atuais, RLS, grants, concorrência e restore passam em PostgreSQL real.
- Carga representativa mede p50/p95/p99, erro, fila e recursos.
- Chaos cobre dependência, collector, worker, DB, provider e restart.
- Backup gerenciado/restore mede RTO/RPO aprováveis.

Evidência de fechamento: procedimentos, ambiente, workload, amostra, resultados brutos e limitações exact-SHA.

### CVG-AUD19-028 — Staging e verticais externas

**Origem:** `BLOCKED_EXTERNAL` do quality bar.<br>
**Dependências:** CVG-AUD19-024, 025 e 027.

Aceite:

- Staging usa imagens imutáveis ligadas ao SHA/SBOM/assinatura.
- DeepSeek e providers reais executam sucesso, falha, timeout, callback, replay e reconciliação.
- Segredos vêm da autoridade aprovada e não aparecem em artefatos/logs.
- Smoke e observabilidade provam o mesmo deployment.

Evidência de fechamento: IDs/digests de deployment e registros externos sanitizados; nenhuma credencial no repositório.

### CVG-AUD19-029 — Sincronizar documentação e reauditagem

**Origem:** drift documental e fechamento do programa.<br>
**Dependências:** CVG-AUD19-026, 027 e 028.

Aceite:

- README, estado atual e scorecards concordam sobre SHA, contagens, resultados e bloqueios.
- Relatórios históricos permanecem históricos; não são reescritos como prova atual.
- Todos os 22 critérios recebem nova nota/status com evidência atual.
- Crítico independente recebe bar congelado, artefato e resultados brutos.

Evidência de fechamento: gates de claims/provenance, links resolvidos, relatório final e fingerprint limpo.

### CVG-AUD19-030 — Decisão humana de release

**Origem:** fronteira de autoridade de produção.<br>
**Dependência:** CVG-AUD19-029.

Aceite:

- Autoridade humana revisa achados fechados, riscos residuais, RTO/RPO, SLO, retenção/residência e rollback.
- Decisão referencia exatamente o candidato e possui validade/escopo definidos.
- Rejeição ou condição mantém promoção bloqueada.

Evidência de fechamento: registro de decisão aprovado e vinculado ao manifesto; automação não substitui a autoridade.

## 4. Definition of Ready

Um item pode sair de `PROPOSTO` para o fluxo executável somente quando:

- owner e revisor estão definidos;
- dependências estão concluídas ou explicitamente dispensadas pela autoridade correta;
- arquivos/recursos compartilhados possuem reserva de ownership;
- reprodução, comportamento esperado e known-bad estão congelados;
- dados e ambiente são sintéticos/descartáveis;
- aceitação e comandos/procedimentos de prova são executáveis;
- qualquer decisão de produto, segurança, migração ou operação pendente está resolvida.

## 5. Definition of Done

Um item não está concluído apenas porque o código foi alterado. `DONE` exige:

- aceitação observada no boundary correto;
- known-bad falhando antes da correção e passando depois, quando aplicável;
- regressão proporcional ao blast radius;
- estados de erro, persistência, efeitos e telemetria inspecionados;
- nenhuma redução de gate/threshold para obter verde;
- evidência `CURRENT` vinculada ao sujeito correto;
- crítica independente nos itens P0 e nos gates de marco;
- documentação/traceabilidade atualizadas;
- risco residual e limitações explicitados;
- nenhuma dependência externa obrigatória reclassificada como PASS sem execução.

## 6. Ordem imediata recomendada

1. `CVG-AUD19-001` — conter o caminho vulnerável.
2. `CVG-AUD19-002` — fixar a regressão HTTP/provider-capture.
3. `CVG-AUD19-003` — fixar a regressão de TTL.
4. Em paralelo após contenção: `004` e `009`; preparar `013` como decisão arquitetural.
5. Não iniciar recaptura/promoção de evidências (`024+`) antes do fechamento dos P0 correspondentes.
