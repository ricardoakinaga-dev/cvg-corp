# CVG-Corp — DeepSeek Harness como motor de agentes

**Estado:** CURRENT capability map + TARGET/PROPOSED adapter design.

Este documento define o uso do `deepseek-harness` como motor plugável. A existência de uma seam, pacote ou evento no motor não significa que um adapter CVG já exista.

## 1. Envelope atual do motor

O repositório local está em `6454e3270642c3a7551dcae4f7447e4032febd77`, manifesto `0.1.1-rc.2`, ESM, Node `^22.19.0 || >=24.0.0` e postura developer preview. A documentação do motor declara que tudo é plugin Cordis: serviços entram no contexto, eventos tipados comunicam e registros são efeitos reversíveis.

O motor oferece profile/bundle com patches ordenados. O `dsh-base` compõe a fundação; `web` e `headless` são modos de superfície; overlays de profile/home/CLI podem substituir rows. O programa CVG deve fixar uma versão compatível e validar a composição efetivamente carregada antes de produção; nenhum `--dump-config` foi executado nesta fase.

## 2. Grafo de composição proposto

```mermaid
flowchart TD
    ROOT[cvg-profile]
    BASE[dsh-base\nCURRENT]
    SURFACE[dsh-web-app ou host CVG\nCURRENT/PROPOSED]
    DOMAIN[cvg-domain-adapters\nPROPOSED]
    POLICY[cvg-identity-policy\nPROPOSED]
    CONTEXT[cvg-patient-context\nPROPOSED]
    TOOLS[cvg-tools\nPROPOSED]
    KNOW[cvg-knowledge\nPROPOSED]
    BUDGET[cvg-budget-usage\nPROPOSED]
    AUDIT[cvg-audit-session\nPROPOSED]
    JOBS[cvg-automation\nPROPOSED]
    INTEGRATION[cvg-integrations\nPROPOSED]

    ROOT --> BASE
    ROOT --> SURFACE
    ROOT --> DOMAIN
    ROOT --> POLICY
    ROOT --> CONTEXT
    ROOT --> TOOLS
    ROOT --> KNOW
    ROOT --> BUDGET
    ROOT --> AUDIT
    ROOT --> JOBS
    ROOT --> INTEGRATION
    TOOLS --> DOMAIN
    TOOLS --> POLICY
    CONTEXT --> DOMAIN
    KNOW --> DOMAIN
    AUDIT --> DOMAIN
    JOBS --> DOMAIN
```

`cvg-*` são nomes de planejamento. Um bundle pode montar vários plugins, mas cada capability precisa de um Service Definition, Provider e Consumer quando houver variação independente. O profile não deve alterar o loop concreto para adicionar comportamento CVG.

## 3. Matriz seam→uso

| Capacidade DeepSeek | Estado no motor | Proveniência | Adapter CVG proposto | Regra de uso |
|---|---|---|---|---|
| `ctx.llm` | CURRENT documentado | `SRC-DSH-01` | `cvg-llm-policy`/provider configuration | Resolver provider por request e credencial por operação; não expor segredo. |
| `ctx.agents` | CURRENT documentado | `SRC-DSH-01` | `cvg-agent-factory` | Criar/resumir Agent com owner, tenant, workspace e session link explícitos. |
| `ctx.agentLoop` | CURRENT concrete driver | `SRC-DSH-01` | Consumir seam, não patchar | Alteração do loop exige atualização de arquitetura e regressão ampla. |
| `ctx.systemPrompt` | CURRENT documentado | `SRC-DSH-01` | `cvg-prompt-context` | Montar policy, papel, contexto mínimo e formato de citação; conteúdo model-visible deve ser logado. |
| `agent.inject()` | CURRENT documentado | `SRC-DSH-01` | avisos/contexto do domínio | Injeta somente mensagem identificada, com origem e finalidade; nunca usa texto de documento como policy. |
| `ctx.sessions` | CURRENT documentado | `SRC-DSH-02` | `cvg-session-bridge` | Sessão append-only para interação, replay e tool results; `flush` é checkpoint, não prontuário. |
| `ctx.tools.register()` | CURRENT documentado | `SRC-DSH-03` | `cvg-tool-*` | Registrar cada tool com schema de input/output, apresentação, log projection e cancelamento. |
| `tools/pre-execute` | CURRENT waterfall | `SRC-DSH-03` | `cvg-tool-policy` | Avaliar contexto, role, ação, recurso, estado, budget e egress; negar por default. |
| `ctx.tools.guard()` | CURRENT monotonic guard | `SRC-DSH-03` | `cvg-clinical-guard`/`cvg-finance-guard` | Proibir que listener posterior ou approval transforme uma negação em permissão. |
| `ctx.tools.execute()` | CURRENT pipeline | `SRC-DSH-03` | wrappers CVG de timeout/metrics/idempotência | O efeito final deve ser um comando de domínio, não uma mutação direta feita pelo modelo. |
| `ctx.tools.post-execute` | CURRENT waterfall | `SRC-DSH-03` | `cvg-result-policy` | Redigir resultado, anexar referências e bloquear conteúdo inadequado; não confundir content replacement com confidentiality. |
| `ctx.approval` | CURRENT fail-closed | `SRC-DSH-04` | `cvg-approval-adapter` | Approval pontual para args/resource/estado exatos; `unavailable` é deny. |
| `ctx.credentials` | CURRENT reference/provider | `SRC-DSH-05` | `cvg-credential-provider` | Referenciar credencial; resolver no gateway por operação; nunca persistir valor em policy/prompt/log. |
| `ctx.authorization` | CURRENT flow | `SRC-DSH-05` | adapters OAuth/API | Uma tentativa por chave; rotação/revogação deve ter registro. |
| `ctx.sandbox` | CURRENT process seam | `SRC-DSH-06` | `cvg-process-policy` | Somente para processo/arquivo que realmente exista; `partial` não pode ser tratado como isolamento absoluto. |
| `ctx.jobs` | CURRENT package family | `SRC-DSH-07` | `cvg-job-consumers` | Relatórios, indexação e follow-up; movimentos clínicos/financeiros continuam no domínio. |
| `ctx.workflowEngine` | CURRENT optional seam | `SRC-DSH-07` | automações P1 | Limitar duração, execução, subagentes e side effects; `dispose` e cancelamento precisam de prova. |
| `ctx.subagents` | CURRENT providers | `SRC-DSH-08` | especialistas de baixo risco | Cada child recebe escopo mínimo; nenhum child assina, prescreve, dispensa ou liquida. |
| `ctx.agentTeams` | EXPERIMENTAL | `SRC-DSH-08` | não usar em P0 | Só após gate próprio de isolamento, concorrência, persistência e auditoria. |
| `ctx.sessionTelemetry` | CURRENT optional | `SRC-DSH-10` | `cvg-telemetry-sink` | Telemetria redigida e best-effort; auditoria crítica fica fora dela. |
| `ctx.remote`/Typert | CURRENT API layer | `SRC-DSH-09` | BFF quando validado | Wire transporta snapshots/IDs e erros estáveis; não expõe objetos live ou initiator como auth. |

## 4. Contexto e sessão

O fluxo documentado é `turn/start → agent/pre-step → step → agent/request → llm/stream → assistant/message → tool/call → tools/* → tool/result → step/end → turn/end`. O log de sessão pode existir em memória e/ou persistência conforme o backend montado; `flush` é o checkpoint que precisa ser confirmado antes de tratar um evento como fisicamente persistido. Waterfalls e eventos live são pontos de extensão.

O CVG deve registrar em cada sessão:

- identidade do ator e owner do Agent;
- organização, unidade, workspace e finalidade;
- paciente e atendimento apenas quando necessários e autorizados;
- versão do profile, policy, prompt, ferramenta e modelo;
- referências de dados consultados, sem duplicar o prontuário inteiro;
- approval, budget reservation, command id e audit id;
- motivo de falha, cancelamento, retry ou `OUTCOME_UNKNOWN`.

`Session` é append-only e seu histórico de modelo é derivado. `user/message`, `assistant/message` e `tool/result` são model-visible; qualquer dado que chegue ao modelo precisa ser reconstruível pelo log. Como o log canônico não é reescrito pela redaction de telemetria, o adapter deve minimizar dados clínicos antes de criar a mensagem.

Uma sessão em memória não equivale a persistência física. Após eventos críticos ou antes de concluir uma operação que depende de replay, o bridge usa `ctx.sessions.flush(session)` e distingue `accepted-in-log` de `durably-persisted`.

## 5. Catálogo de agentes CVG

Cada agente é um preset de capacidades e prompt, não uma role de segurança. A autorização continua no domínio e nos guards.

| Preset | Pode consultar | Pode propor | Não pode executar autonomamente |
|---|---|---|---|
| `cvg-frontdesk` | tutor, paciente mínimo, agenda, fila e status financeiro mínimo | confirmação, lembrete, rascunho de mensagem | alteração clínica, desconto fora de alçada, exportação ampla |
| `cvg-clinical-scribe` | contexto clínico do atendimento, documentos e resultados autorizados | resumo, campos ausentes, rascunho SOAP/alta | diagnóstico final, prescrição, assinatura, comunicação |
| `cvg-nursing-ops` | tarefas, ordens, leitos, monitoramento e handoff atribuídos | checklist, handoff, alerta operacional | alterar ordem, assinar decisão reservada, inventário fora da ordem |
| `cvg-pharmacy-stock` | itens, lotes, validade, ordens e consumo | alerta de ruptura/validade, rascunho de compra | dispensar sem ordem/policy, ajuste silencioso, saldo negativo |
| `cvg-finance-ops` | orçamento, ledger, pagamentos e reconciliação permitidos | explicação e relatório | estorno, desconto fora de alçada, alteração clínica |
| `cvg-quality-admin` | métricas agregadas e auditoria autorizada | análise de tendência, plano de melhoria | acessar prontuário individual sem break-glass |
| `cvg-platform-admin` | configuração de plataforma e status técnico | policy/catálogo global | acessar conteúdo clínico por padrão |

O preset deve usar escopo de Agent para composição e visibility de tools; essa restrição de apresentação não é uma fronteira de autoridade. Uma tool local pode existir só para o Agent, mas ainda precisa de autorização server-side.

## 6. Política em cascata

A política `PROPOSED` é monotônica e só permite restrição ao descer de escopo:

```text
platform baseline
  -> organization policy
    -> unit policy
      -> workspace policy
        -> role/actor policy
          -> session approval state
```

Uma camada inferior pode remover provider, modelo, tool, destino, dado ou ação; não pode reintroduzir o que uma camada superior proibiu. Ausência de policy, versão expirada, hash divergente, cache corrompido ou contexto incompleto produz `POLICY_DENIED`.

`ctx.tools.restrict()` é apenas composição de visibilidade; o desenho não o trata como controle de segurança. A decisão final é uma guard/porta de domínio que conhece ator, recurso, estado, condição e versão de policy.

## 7. Tipos de tools e approval

| Nível | Exemplo | Política proposta |
|---|---|---|
| T0 leitura | agenda disponível, paciente já resolvido, estoque por local | role + escopo + policy; sem approval se estritamente read-only |
| T1 rascunho | resumo clínico, e-mail, alta, relatório | grava `AiDraft`; revisão humana antes de publicar |
| T2 efeito reversível | criar reserva, tarefa, rascunho de cobrança, lembrete | approval contextual quando houver destinatário/efeito externo |
| T3 alto impacto | assinar, prescrever, dispensar, registrar administração, alterar saldo, estornar, enviar informação sensível | role de alçada + estado válido + approval forte; em alguns casos segunda pessoa |
| T4 irreversível/privilegiado | exclusão, exportação ampla, break-glass, troca global de policy/credencial | ação fora do Agent clínico; autoridade explícita, janela, motivo, auditoria e revalidação |

O approval do motor retorna somente `allowed-once`, `rejected`, `cancelled` ou `unavailable`; somente o primeiro autoriza. O adapter CVG acrescenta um `ApprovalBinding` com hash dos argumentos normalizados, recurso, versão esperada, policy revision, actor approver, expiração, finalidade e alçada. Se qualquer item mudar entre approval e execução, o comando é rejeitado e precisa de nova decisão.

O hash usa canonicalização determinística `UTF-8 + JSON sem whitespace`, chaves ordenadas recursivamente, números em representação única, listas preservando ordem, campos opcionais explicitamente ausentes/nulos conforme schema e rejeição de campos desconhecidos. O digest inclui `action`, `resource`, `expectedVersion`, `scope`, `egressIntent`, `policyRevision/hash`, `credentialRef/version`, `budgetReservationId`, `artifactBinding` e `expiresAt`; não é calculado a partir do texto exibido na UI.

Estados propostos do binding: `ISSUED → DECIDED → CONSUMING → CONSUMED`, ou `REJECTED`, `EXPIRED`, `REVOKED`, `CONFLICT`. `CONSUMING` é reservado atomicamente por `approvalId + digest`; uma segunda tentativa recebe `APPROVAL_REPLAY`. Para comando interno, o consumo do binding e a mutação do domínio ocorrem na mesma transação. Para efeito externo, o consumo e o `DispatchIntent` idempotente são persistidos antes do envio; crash entre intent e envio é reconciliado pelo provider, nunca repetido cegamente. Approval do engine sem `ApprovalBinding` CVG válido é `DENIED`.

### 7.1 Admission comum para toda tool

Para evitar bypass por superfície, toda chamada originada por tool nativa, tool local, MCP, skill, Code Mode, subagente ou integração remota deve chegar à mesma porta `CvgToolAdmission`/`CvgCommandAdmission`. `ctx.tools.restrict()` controla visibilidade; não substitui esta decisão. O sandbox controla apenas os efeitos que realmente cobre; não é autorização de tenant ou clínica.

```text
ActionEnvelope {
  actionId, actionClass, actorId, actorKind,
  securityContextDigest, organizationId, unitId?, workspaceId?,
  resourceType, resourceId, expectedVersion?, purpose,
  normalizedArgsDigest, policyRevision, policyHash,
  credentialRef?, egressIntent?, idempotencyKey,
  budgetReservationId, approvalBindingId?, artifactBinding,
  registryRevision, deadline, parentActionId?
}
```

O envelope é montado e validado no servidor; o modelo não pode declarar `actorId`, escopo, role, approval, credencial, registry ou digest de artefato como autoridade. A admissão executa, nesta ordem, decode/schema, classificação de conteúdo não confiável, resolução do contexto, revogação, policy monotônica, authz do recurso/estado, lookup do registry e comparação de `registryRevision`/digests, budget reservation, binding de approval, egress/credencial, idempotência e chamada da porta de domínio. Registry indisponível, artefato suspenso, digest divergente ou qualquer outra ausência retorna `DENIED` antes do efeito.

| Origem | Tratamento obrigatório | Limite adicional |
|---|---|---|
| Tool nativa/local | schema + guard + `ActionEnvelope` + porta de domínio | não chamar banco/HTTP diretamente |
| MCP | admission CVG antes e depois do transporte, egress allowlist e trust level | descrição/nome/resultado MCP são untrusted; não recebem autoridade |
| Skill/plugin | hash, versão, owner, dependências e registry admitido | plugin in-process é código confiável do processo, não sandbox |
| Code Mode | processo/policy próprios, mesma authz/budget/egress e output normalizado | não ganha `full-access` nem bypass por código gerado |
| Subagente/nested call | herda o contexto e recebe sub-reserva; pode somente restringir | nunca amplia role, escopo, tool, budget ou approval do parent |
| BFF/remote direto | `CommandEnvelope` passa pela mesma policy e domínio | transporte não é identidade e não cria um caminho alternativo |

Negação em qualquer fase é auditável por `actionId`/`correlationId`; conteúdo recebido depois não pode transformar `DENIED` em `ALLOW`. O teste de bypass para cada origem permanece `NOT_RUN`.

## 8. Budget e consumo

O budget deve reservar capacidade antes do turno e registrar consumo depois de cada request/tool. A unidade definitiva — moeda, créditos, tokens e unidades de mídia — é `UNKNOWN`; a arquitetura exige ledger de consumo separado do saldo exibido.

`UsageRecord` inclui tenant, workspace, actor, session, step, tool/model, provider request id, input/output usage quando disponível, mídia, retry, status, estimated/final cost, currency, policy revision e idempotency key. A consolidação em lote pode atrasar a visão, mas não pode transformar atraso em crédito ilimitado.

Chamadas aninhadas, Code Mode, retries e providers sem usage precisam de budget reservation e reconciliação. Em caso de incerteza, bloquear novo efeito caro e abrir reconciliação; não confiar na média do token meter.

### Reserva atômica e hard stop

O contrato de budget usa dimensões independentes para não esconder consumo de uma modalidade:

```text
BudgetReservation {
  reservationId, parentReservationId?, organizationId, workspaceId, actorId,
  sessionId, actionId, policyRevision, dimensions,
  upperBound, reservedAt, expiresAt, status, idempotencyKey
}

dimensions = {
  money, inputTokens, outputTokens, audioSeconds, imageUnits,
  transcriptionSeconds, providerCalls, toolDispatches, externalEffects
}
```

1. Antes de qualquer provider, mídia, transcrição, MCP, retry, Code Mode ou efeito externo, o gateway calcula um `upperBound` ou rejeita por não conseguir estimar com segurança.
2. A reserva raiz é atômica por `organizationId/workspaceId/actorId` e cada nested call só pode consumir uma sub-reserva da raiz. A mesma `idempotencyKey` devolve a reserva existente; parâmetros incompatíveis geram `IDEMPOTENCY_CONFLICT`.
3. O admission repete o hard check imediatamente antes do dispatch. Ao atingir o limite, novos dispatches são negados; não há crédito implícito por atraso de batch, retry ou saldo de interface.
4. O settlement registra usage observado, custo estimado/final, provider request id, receipt, retry e discrepância; libera sobra somente depois de confirmar o estado permitido.
5. Uso tardio, duplicado ou acima da reserva entra em `BUDGET_RECONCILIATION_HOLD`, congela novos efeitos caros do escopo afetado e exige reconciliação. Nunca produzir saldo negativo silencioso nem contar o mesmo provider event duas vezes.

### Ledger de uso e settlement

O ledger é append-only lógico e separado do saldo apresentado na UI:

```text
UsageLedgerEntry {
  usageEntryId, reservationId, parentReservationId?, actionId, attempt,
  organizationId, workspaceId, actorId, sessionId,
  providerRequestId?, providerUsageEventId?, modality, quantity,
  estimatedCost?, finalCost?, currency?, occurredAt, receivedAt,
  state: RESERVED|DISPATCHED|SETTLED|UNKNOWN|RECONCILIATION_HOLD,
  idempotencyKey, causationId, auditId
}
```

As chaves `(reservationId, actionId, attempt)`, `(providerRequestId, providerUsageEventId)` quando presentes e `idempotencyKey` são únicas; um evento repetido retorna o mesmo settlement. `DISPATCHED` sem usage confirmado vira `UNKNOWN`; usage tardio ou fora de ordem não reescreve o passado, gera uma entrada compensatória e transita para `RECONCILIATION_HOLD`. A reconciliação compara reserva, receipt/request do provider, `UsageLedgerEntry` e cobrança; divergência mantém o escopo em hold e exige owner, motivo, decisão e `AuditRecord`. Crash entre reserva, dispatch e settlement deve ser recuperado por replay idempotente, não por dedução temporal.

Os preços, moeda e limites numéricos são `UNKNOWN`; a atomicidade, cobertura das dimensões e comportamento de hard stop são requisitos `PROPOSED` que precisam de ledger executável e teste de crash/late/out-of-order antes do gate.

## 9. Conhecimento, memória e conteúdo não confiável

O CVG mantém três camadas diferentes:

1. **Conhecimento aprovado:** políticas, manuais, protocolos e documentos versionados, com ACL e vigência.
2. **Memória de sessão/workspace:** preferências e contexto derivados, sujeitos a finalidade e retenção própria.
3. **Prontuário e domínio:** fatos clínicos e operacionais canônicos, escritos apenas por casos de uso autorizados.

O retrieval deve filtrar escopo antes da busca, devolver fonte/versão/trecho e marcar documentos, e-mails, web, MCPs e memórias como conteúdo não confiável. Nenhum trecho pode alterar system prompt, allowlist, role, budget ou approval. Resumos de IA são sempre `AiDraft` até revisão.

## 10. Automação, subagentes e offline

Jobs e workflows devem possuir `automationId`, versão, owner, janela, budget, input snapshot, policy revision, run id, cancelamento, retry bounded e outcome. Uma automação agendada não herda approval interativa sem uma decisão explícita de produto; ações T2/T3 devem pausar ou solicitar confirmação.

Subagentes recebem contexto mínimo e nenhum privilégio superior ao parent. O parent não pode atribuir a um child uma tool que sua própria policy não permite. A coordenação experimental `agent-team` fica fora do caminho P0.

Offline pode abrir dados/cache já autorizados conforme a decisão U14, mas não pode ampliar policy, criar credencial, confirmar efeito externo, assinar, dispensar, estornar ou publicar alteração clínica. Uma escrita local pendente precisa de estado `PENDING_SYNC`, chave idempotente, conflito explícito e reconciliação humana quando o estado mudou.

## 11. Segurança do runtime e upgrade

Plugins JavaScript in-process admitidos são confiáveis no processo; o mecanismo de admissão não é sandbox completo e não detecta um plugin confiável que tenha sido comprometido. Por isso, plugin, skill, MCP e bundle CVG não podem abrir store ou provider diretamente: só podem solicitar `CvgToolAdmission`/porta de domínio. Se a origem, digest ou confiança do processo não puder ser provada, o artefato não é admitido. Código não confiável exige outro processo/boundary real, com a mesma authz, budget, egress e auditoria.

O sandbox do motor cobre efeito de arquivo de subprocessos e pode ser `partial`; não é firewall de rede nem controle de tenant. Web fetch e integrações usam egress allowlist, tamanho, timeout, destinos seguros, redaction e bloqueio de redirect credenciado quando aplicável.

### Registry e ciclo de vida de artefatos de IA

Modelos, prompts, profiles/bundles, tools, skills, MCPs e configurações de provider entram em um registry único de admissão, mesmo quando sua execução usa seams diferentes:

```text
GovernedArtifact {
  artifactId, kind, version, digest, sourceUri, owner,
  dependencies, requestedCapabilities, dataClasses, riskLevel,
  evaluationSuiteVersion, evaluationResult, approver, approvedAt,
  rollbackTarget, killSwitchId, policyRevision, status
}
```

Cada dispatch também carrega uma referência imutável ao conjunto admitido:

```text
GovernedArtifactBinding {
  registryRevision, artifactIdsAndDigests,
  engineCommit, profileDigest, policyRevision, admissionDecisionId,
  issuedAt, expiresAt, killSwitchEpoch
}
```

O binding é recalculado no início da sessão, no pre-execute e imediatamente antes do dispatch. Registry ausente, revisão expirada, `killSwitchEpoch` alterado ou digest divergente bloqueia a ação; não existe fallback para o último artefato “conhecido”.

Estados mínimos: `RECEIVED → REVIEWED → EVALUATED → APPROVED → ADMITTED`; também `SUSPENDED` e `RETIRED`. O agente não aprova seu próprio artefato. A admissão exige origem/hash, revisão humana adequada ao risco, avaliação conhecida, dependências e escopo; um hash ou versão diferente é outro artefato. Toda sessão registra os IDs exatos de engine, profile, prompt, modelo, tool/skill/MCP e provider.

Rollback remove o artefato da allowlist, aponta para uma versão previamente admitida e registra impacto; kill switch impede novos dispatches e cancela/quiesce efeitos conforme o boundary, sem apagar auditoria. Como registry, avaliação e rollback ainda não existem no CVG, `AI-01` permanece `NOT_RUN`.

O harness está em pré-release e `SESSION_FORMAT_VERSION=0`. Antes de cada upgrade, o CVG deve executar: dump da composição, build/test do motor, replay de sessões representativas, teste de tool/approval, verificação de eventos desconhecidos, restauração de backup e rollback/roll-forward aprovado.

## 12. Estado de implementação e próximo gate

`CURRENT`: capacidades acima estão documentadas no motor local; nenhuma foi adaptada ao CVG nesta fase.

`PROPOSED`: plugins, bundles, presets, contracts, guards, bridges e workers `cvg-*` ainda não existem.

`NOT_RUN`: nenhum runtime, build, profile dump, provider, tool, approval ou replay foi executado para o CVG.

Próximo gate: transformar as decisões U1–U15 em contratos aprovados e testar uma fatia vertical `agenda → atendimento → rascunho de resumo → revisão → registro`, sem permitir que o agente escreva diretamente no prontuário.
