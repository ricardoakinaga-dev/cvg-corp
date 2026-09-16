# Runbook — incidente de prompt injection

**Estado:** quarentena de prompt e firewall de contexto implementados e exercitados localmente (`tests/unit/agent-security.test.ts`, `tests/unit/agent-context.test.ts`); exercício adversarial externo `NOT_RUN`.
**Owner:** segurança + AI runtime. **Abortar se:** a evidência não estiver preservada ou o escopo do conteúdo exposto ainda for desconhecido.

Objetivo: conter injeção direta (prompt do ator) e indireta (retrieval/documento/tool result), preservar evidência e revisar a origem antes de reabilitar qualquer conteúdo.

## 1. Detecção

- Injeção direta no prompt: `looksLikeInjection()` (`packages/embedded-agent-runtime/src/index.ts:1232`) casa padrões como "ignore all previous", "ignore instruções", "system prompt", "reveal secret", "tool allowlist", `<system`. O turno é persistido como `QUARANTINED` com motivo "Conteúdo retido..." e `usage.status: QUARANTINED`; nenhum modelo ou tool é chamado (`packages/embedded-agent-runtime/src/index.ts:452-455`).
- Injeção indireta no contexto: `ContextBuilder.build` inspeciona conteúdo `RETRIEVED_UNTRUSTED`, `EXTERNAL_UNTRUSTED`, `USER_SUPPLIED` e `TOOL_RESULT` (`packages/agent-context/src/index.ts:257-266`). Achados de `INSTRUCTION_OVERRIDE`, `SYSTEM_PROMPT_PROBE`, `TOOL_ENABLEMENT_ATTEMPT`, `APPROVAL_SYNTHESIS_ATTEMPT`, `PERMISSION_ESCALATION`, `SECRET_MATERIAL` (linhas 132-140) geram `findings` e `sanitized: true`.
- Item não-confiável com finding é **removido** do contexto e entra em `quarantined[]`; `TOOL_RESULT` é mantido como dado delimitado, porém marcado e sanitizado (`packages/agent-context/src/index.ts:257-267`).
- Documento de conhecimento só entra se `status === "APPROVED"`, no escopo e na classe permitida (`packages/embedded-agent-runtime/src/index.ts:755-757`).

## 2. Quarentena de retrieval

- `KnowledgeGovernor.select` só considera `APPROVED` no escopo/classe (`packages/agent-context/src/index.ts:197-206`); `quarantine(id)` muda `approvalStatus` para `QUARANTINED` e remove o documento da seleção (linhas 190-195).
- No domínio: `quarantineKnowledgeDocument(context, documentId, reason, expectedVersion)` (`packages/domain/src/index.ts:1787`), com rota `POST /api/v1/knowledge/:id/quarantine` (`apps/api/src/app.ts:2123`).
- Documento `QUARANTINED` não pode ser aprovado sem revisão de origem (`INVALID_STATE`, `packages/domain/src/index.ts:1767`).
- Se a origem é um documento específico, quarentenar é o primeiro passo; reindexar/reaplicar só após revisão humana registrada.

## 3. Contenção

1. Preservar turno, sessão, correlation ID e payload original (não reproduzir o prompt).
2. Quarentenar o documento de retrieval envolvido (rota acima).
3. Reduzir superfície: `CVG_AI_SAFE_MODE=true` (nega tools não `READ_ONLY`, `SAFE_MODE_READ_ONLY`, `packages/embedded-agent-runtime/src/index.ts:839`) e `CVG_AI_DISABLED_TOOLS` para capabilities específicas.
4. Se houver qualquer suspeita de exposição de segredo (finding `SECRET_MATERIAL`), rotacionar por referência seguindo `docs/runbooks/credential-rotation.md` e investigar uso.
5. Incidente mais grave ou recorrente: `CVG_AGENT_RUNTIME=disabled` (`apps/api/src/app.ts:587`), mantendo o núcleo operante.

## Evidência

- `AiTurn.status = "QUARANTINED"`, `usage.status` e motivo persistidos;
- registro de auditoria `ai.turn` com `result` e `reason: "untrusted content quarantined"` (`apps/api/src/app.ts:2039`);
- `ModelContext.findings[]` (`code`, `itemId`, `source`, `trust`, `detail`) e `quarantined[]` (`packages/agent-context/src/index.ts:76-93,121-124`) capturados por telemetria/log no momento da detecção — não são persistidos como registro de primeira classe;
- `sanitizedContext` no `KernelRunResult` (`packages/agent-kernel/src/index.ts:317`);
- `agent_turns`: `input_digest`/`context_digest`/`model_request_digest` do turno (nunca o texto bruto do prompt no checkpoint);
- correlation ID, sessão, ator, organização e horário.

## Sinais para varredura retroativa

Procurar no período suspeito por:

- turnos `QUARANTINED` na mesma sessão/ator (tentativa repetida);
- `agent.context.built/v1` com `sanitized: true` (`packages/agent-kernel/src/index.ts:545`);
- documentos de conhecimento que mudaram de versão/status próximos ao incidente;
- mudanças recentes em `allowedDataClasses`/profiles;
- acessos de leitura a `/api/v1/knowledge/:id/index` (`apps/api/src/app.ts:2092`), que podem ter exposto o conteúdo malicioso antes do filtro.

## Critérios de encerramento

- [ ] documento/origem em quarentena ou corrigido e revisado;
- [ ] nenhum turno com efeito externo derivado da injeção;
- [ ] evidência preservada e cadeia de custódia registrada;
- [ ] causa raiz classificada (prompt, retrieval, tool result ou skill);
- [ ] novo teste adversarial adicionado quando o padrão não estava coberto;
- [ ] comunicação a segurança/DPO concluída quando aplicável.

## Comunicação e postmortem

- Comunicar owner de segurança e DPO quando houver dado pessoal/clínico potencialmente exposto; classificar com base no conteúdo do item e nas classes de dados do profile.
- Postmortem obrigatório: vetor (direto/indireto), item de origem, controle que falhou, tempo de contenção, ações de reabilitação.
- Registrar revisão do documento de origem antes de reaprová-lo e adicionar caso de teste adversarial quando o padrão não estiver coberto.

## O que NÃO fazer

- Nunca reexecutar o mesmo prompt "para confirmar" a injeção.
- Nunca apagar o turno `QUARANTINED`, o documento em quarentena ou registros de auditoria.
- Nunca aprovar documento que ficou `QUARANTINED` sem revisão de origem.
- Nunca habilitar tools por texto do modelo: capability só existe por registry + profile + PDP.
- Nunca tratar o firewall como DLP completo: os padrões são sinal/auditoria; a garantia estrutural é o dado não-confiável ser emitido como dado delimitado que não pode virar policy, permissão ou segredo (`packages/agent-context/src/index.ts:142-146`).
