# Backlog de implementação após auditoria da entrega

33 contratos de melhoria. Estado de execução pertence exclusivamente a `.agent/backlog.json`; este catálogo não marca tarefas concluídas. Primeiro reconciliar em AAA2-01. Tarefas legadas e seus aceites continuam válidos salvo contradição documentada.

| ID | Entrega | Onda | Prioridade | Dependências |
|---|---|---|---|---|
| AAA2-01 | Reconciliar aceite, estado e trabalho residual | R0 | P1 | — |
| AAA2-02 | Proteger prescrição terminal e dispensação | R1 | P1 | AAA2-01 |
| AAA2-03 | Contabilizar uso real e reter orçamento em disputa | R1 | P1 | AAA2-01 |
| AAA2-04 | Tornar reserva e settlement ACP obrigatórios e duráveis | R1 | P1 | AAA2-03 |
| AAA2-05 | Revalidar autoridade na conclusão e divulgação da IA | R1 | P1 | AAA2-01 |
| AAA2-06 | Isolar prontuários e carregar todos os adendos | R1 | P1 | AAA2-01 |
| AAA2-07 | Entregar dispensação acessível ao perfil de farmácia | R1 | P1 | AAA2-02 |
| AAA2-08 | Completar admissão de internação planejada | R1 | P1 | AAA2-01 |
| AAA2-09 | Corrigir foco e leitura de documentos assinados | R1 | P2 | AAA2-06 |
| AAA2-10 | Reconstruir proveniência e gates do candidato | R0 | P1 | AAA2-01 |
| AAA2-11 | Provar idempotência e retomada de claims em banco | R2 | P1 | AAA2-01, AAA2-02 |
| AAA2-12 | Migrar escritas primárias residuais com invariantes | R2 | P1 | AAA2-11 |
| AAA2-13 | Completar anexos clínicos governados | R2 | P1 | AAA2-06, AAA2-12 |
| AAA2-14 | Completar checklist e consentimento de admissão | R2 | P1 | AAA2-08, AAA2-12 |
| AAA2-15 | Completar fornecedor e custo de estoque | R2 | P1 | AAA2-07, AAA2-12 |
| AAA2-16 | Completar orçamento, aprovação e conciliação financeira | R2 | P1 | AAA2-12, AAA2-15 |
| AAA2-17 | Completar conhecimento e registry governado | R2 | P1 | AAA2-04, AAA2-12 |
| AAA2-18 | Completar automações, workers e comunicação | R2 | P1 | AAA2-11, AAA2-12 |
| AAA2-19 | Readiness atual por capacidade e operação manual | R1 | P1 | AAA2-01 |
| AAA2-20 | Completar métricas, causalidade e relatórios reais | R2 | P2 | AAA2-01, AAA2-19 |
| AAA2-21 | Renderizar alertas e provar entrega | R3 | P1 | AAA2-19, AAA2-20, AAA2-25 |
| AAA2-22 | Substituir prova textual de runbook por execução | R2 | P1 | AAA2-10, AAA2-19 |
| AAA2-23 | Criar workloads completos e thresholds por jornada | R2 | P1 | AAA2-10, AAA2-11 |
| AAA2-24 | Lifecycle e restore útil com reconciliação | R3 | P1 | AAA2-12, AAA2-18 |
| AAA2-25 | Preparar e integrar provider, secrets e MFA forte | R3 | P1 | AAA2-01, AAA2-05, AAA2-18 |
| AAA2-26 | Comprovar vertical DeepSeek governada real | R3 | P1 | AAA2-04, AAA2-05, AAA2-17, AAA2-25 |
| AAA2-27 | Publicar candidato verificável em CI e staging autorizado | R3 | P1 | AAA2-10, AAA2-12, AAA2-19, AAA2-25 |
| AAA2-28 | Refatorar e otimizar por perfil observado | R3 | P2 | AAA2-12, AAA2-18, AAA2-20, AAA2-23 |
| AAA2-29 | Provar jornadas por persona, browser e tecnologia assistiva | R4 | P1 | AAA2-02, AAA2-06, AAA2-07, AAA2-08, AAA2-09, AAA2-13, AAA2-14, AAA2-15, AAA2-16, AAA2-17, AAA2-18, AAA2-20, AAA2-27, AAA2-28, AAA2-33 |
| AAA2-30 | Provar operação adversa e recuperação no candidato | R4 | P1 | AAA2-21, AAA2-22, AAA2-23, AAA2-24, AAA2-25, AAA2-26, AAA2-27, AAA2-28 |
| AAA2-31 | Consolidar dossiê e Gauntlet final fresco | R5 | P1 | AAA2-01, AAA2-02, AAA2-03, AAA2-04, AAA2-05, AAA2-06, AAA2-07, AAA2-08, AAA2-09, AAA2-10, AAA2-11, AAA2-12, AAA2-13, AAA2-14, AAA2-15, AAA2-16, AAA2-17, AAA2-18, AAA2-19, AAA2-20, AAA2-21, AAA2-22, AAA2-23, AAA2-24, AAA2-25, AAA2-26, AAA2-27, AAA2-28, AAA2-29, AAA2-30, AAA2-33 |
| AAA2-32 | Obter decisão humana e promover somente artefato aprovado | R5 | P1 | AAA2-31 |
| AAA2-33 | Completar semântica clínica dos exames | R2 | P1 | AAA2-12 |

## AAA2-01 — Reconciliar aceite, estado e trabalho residual

**Origem:** AUD13-01, AUD13-21, AUD13-37, AUD13-15. **Achados:** E10. **Dono proposto:** Lead. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `.agent/`, `docs/`.

Critérios de aceite:

- Mapear todos38 contratos e6 filhos sem duplicar status
- Reabrir aceites contraditos de budget (AUD13-21) e exames (AUD13-15); vincular regressões clínicas às tarefas parciais
- Preservar histórico e registrar owner/next_action por fatia; crítico ausente não vira aprovação

Verificação:

- git status --short
- python3 docs/plano-triplo-aaa-pos-entrega-2026-09-13/validar-plano.py

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-02 — Proteger prescrição terminal e dispensação

**Origem:** AUD13-16, AUD13-17. **Achados:** E01. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `packages/domain/`, `apps/api/`, `tests/`.

Critérios de aceite:

- Negar dispensação suspensa/concluída sem alterar estoque
- Negar saída indireta de COMPLETED; correção excepcional exige contrato autorizado separado
- HTTP idempotente e concorrência mantêm um receipt e uma movimentação válida

Verificação:

- Reproduzir E01 via API com roles veterinário e estoque
- npm run test:database
- npm test

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-03 — Contabilizar uso real e reter orçamento em disputa

**Origem:** AUD13-21. **Achados:** E02. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/domain/`, `packages/persistence/`, `packages/harness/`, `tests/`.

Critérios de aceite:

- Registrar900 quando uso900 exceder reserva100
- Criar hold no escopo antes de nova despesa; liberar apenas por reconciliação autorizada
- Late/duplicado/expirado/outcome_unknown não perdem uso nem liberam capacidade cega
- Aplicar limites de organização/unidade/workspace/ator/sessão e modalidade conforme contrato

Verificação:

- Reproduzir E02 e exigir nova reserva negada
- npm test
- Provar concorrência em PostgreSQL efêmero

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-04 — Tornar reserva e settlement ACP obrigatórios e duráveis

**Origem:** AUD13-21, AUD13-27. **Achados:** E03. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/harness-adapters/`, `packages/deepseek-bridge/`, `packages/persistence/`, `apps/deepseek-bridge/`, `tests/`.

Critérios de aceite:

- Sem budget authority não há dispatch permitido
- Persistir vínculo tentativa/reserva antes do efeito
- Restart recupera reserva e settle exatamente uma vez
- Falhas entre reserva/dispatch/commit permanecem reconciliáveis sem SETTLED falso

Verificação:

- Probe E03 com ausência e recriação
- Teste multiprocesso e crash com adapter sintético
- npm test

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-05 — Revalidar autoridade na conclusão e divulgação da IA

**Origem:** AUD13-27. **Achados:** E04. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `packages/harness-adapters/`, `apps/api/src/application/`, `packages/agent-policy/`, `tests/`.

Critérios de aceite:

- Revogação durante turno impede conclusão autorizada, draft e consumo de aprovação
- Contabilidade preservada em estado apropriado sem devolver conteúdo sensível
- Revalidar sessão/contexto/revisão de policy/recurso antes de commit e disclosure

Verificação:

- Probe E04 e requisição remota sintética pendente através da aplicação
- npm run test:security
- npm test

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-06 — Isolar prontuários e carregar todos os adendos

**Origem:** AUD13-14. **Achados:** E05, E06. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `apps/web/src/features/clinical/`, `apps/web/src/api/`, `tests/e2e/`.

Critérios de aceite:

- Troca de paciente/contexto limpa estado e descarta respostas antigas
- Todos documentos assinados têm adendos vinculados e visíveis
- Loading/erro próprios não ocultam correções nem atribuem texto ao paciente errado

Verificação:

- Browser com A/B, latências invertidas, erro e reabertura
- Regressão integrada UI→API de dois documentos e dois pacientes

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-07 — Entregar dispensação acessível ao perfil de farmácia

**Origem:** AUD13-16, AUD13-17. **Achados:** E07. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `apps/web/src/features/stock/`, `apps/web/src/features/hospital/`, `apps/api/src/application/`, `tests/`.

Critérios de aceite:

- Perfil estoque conclui dispensação sem exigir acesso a prontuários/leitos
- Veterinário/admin/estoque preservam separação de funções
- Lote, validade, saldo, receipt, negativa e replay visíveis

Verificação:

- Browser autenticado como estoque contra API real local
- Teste de negativa sem ampliar permissões clínicas

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-08 — Completar admissão de internação planejada

**Origem:** AUD13-16, AUD13-16A. **Achados:** E08. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `apps/web/src/features/hospital/`, `apps/api/`, `packages/domain/`, `packages/persistence/`, `tests/`.

Critérios de aceite:

- Episódio PLANNED existente recebe leito e vira ADMITTED sem duplicar episódio
- Concorrência pelo mesmo leito nega segundo ator sem parcialidade
- UI permite retomar após conflito e mostra receipt

Verificação:

- Fluxo local criar sem leito→atribuir→admitir→procedimento→recuperação
- Teste de conflito e replay

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-09 — Corrigir foco e leitura de documentos assinados

**Origem:** AUD13-14, AUD13-35. **Achados:** E09. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `apps/web/src/features/clinical/`, `apps/web/src/components/`, `tests/e2e/`.

Critérios de aceite:

- Foco inicial entra em elemento habilitado do diálogo
- Leitura preserva imutabilidade sem remover conteúdo da navegação assistiva
- Tab/ShiftTab/Escape/retorno de foco funcionam em desktop e mobile

Verificação:

- Probe de activeElement e teclado
- Matriz automatizada pertinente; leitor humano em AAA2-29

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-10 — Reconstruir proveniência e gates do candidato

**Origem:** AUD13-03, AUD13-34, AUD13-37. **Achados:** E10. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `scripts/`, `tests/unit/`, `artifacts/`, `docs/`.

Critérios de aceite:

- verify:static distingue snapshot stale e válido
- Regenerar evidência só a partir de verificações realmente executadas
- Identificar HEAD mais delta do worktree; não retocar hashes manualmente para passar
- Instalação reproduzível e scripts não dependem de portas/dirty tree acidentais

Verificação:

- npm run verify:static
- npm run build
- npm test
- Fixture negativa de SHA/conteúdo stale

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-11 — Provar idempotência e retomada de claims em banco

**Origem:** AUD13-22. **Achados:** E11. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/api/src/application/idempotency-service.ts`, `packages/persistence/`, `db/migrations/`, `tests/`, `scripts/`.

Critérios de aceite:

- Re-login não duplica efeito pela troca de identidade de sessão
- Lease/fence rejeitam dono antigo após takeover
- Crash antes/depois do commit tem desfecho reconciliável; migration037 compatível

Verificação:

- npm run verify:postgres:concurrency em banco efêmero autorizado
- Matriz de crash/replay e cliente antigo/novo

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-12 — Migrar escritas primárias residuais com invariantes

**Origem:** AUD13-23. **Achados:** E11. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/persistence/`, `apps/api/src/application/`, `packages/domain/`, `db/migrations/`, `tests/`, `scripts/`.

Critérios de aceite:

- Inventariar24 coleções e migrar por domínio sem perda
- Fonte autoritativa e snapshot não disputam ownership
- RLS/CAS/filhos/auditoria testados com dois processos e role restrita
- Gate final rejeita coleção operacional sem comando autoritativo ou exceção normativa explícita

Verificação:

- npm run verify:authoritative-writes
- npm run verify:postgres
- Concorrência e backfill em banco efêmero; rollback/forward-fix documentados

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-13 — Completar anexos clínicos governados

**Origem:** AUD13-14, AUD13-14A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/clinical/`, `apps/api/`, `packages/domain/`, `packages/persistence/`, `tests/`.

Critérios de aceite:

- Upload/download vinculado ao paciente e contexto com ACL e auditoria
- Tipo/tamanho/integridade/quarentena e expiração definidos
- Retenção e storage confirmados pelo responsável; teste com dados sintéticos

Verificação:

- Jornada anexar→consultar→negar outro contexto→expirar
- Casos de arquivo inválido, interrupção e recuperação

**Dependências externas:** Decisão de storage/retention para operação real

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-14 — Completar checklist e consentimento de admissão

**Origem:** AUD13-16A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/hospital/`, `apps/api/`, `packages/domain/`, `packages/contracts/`, `tests/`.

Critérios de aceite:

- Consentimento e checklist têm identidade/versão/autor/proveniência
- Admissão aplica regras aprovadas sem inventar decisão clínica
- Histórico e revogação/correção têm semântica explícita

Verificação:

- Fluxo clínico com requisito faltante e completo
- Validação do responsável clínico

**Dependências externas:** Regra clínica de consentimento/checklist quando não definida

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-15 — Completar fornecedor e custo de estoque

**Origem:** AUD13-17A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/stock/`, `apps/api/`, `packages/domain/`, `packages/persistence/`, `tests/`.

Critérios de aceite:

- Entrada registra fornecedor/custo/unidade/lote e receipt
- Ajuste/inventário/dispensação preservam saldo e trilha
- Valores monetários em centavos e concorrência impedem saldo inconsistente

Verificação:

- Jornada entrada→inventário→ajuste→dispensação
- Caso negativo e replay sem movimento duplicado

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-16 — Completar orçamento, aprovação e conciliação financeira

**Origem:** AUD13-18, AUD13-18A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/finance/`, `apps/api/`, `packages/domain/`, `packages/persistence/`, `tests/`.

Critérios de aceite:

- Orçamento/aprovação/cobrança/pagamento/conciliação concluíveis
- Estorno segue política confirmada e ledger auditável
- PAID não volta a aberto; efeitos incertos não geram pagamento duplicado

Verificação:

- Fluxo integrado e divergência financeira
- Regressão de saldo/centavos/permissões

**Dependências externas:** Política de estorno e conciliação quando não definida; nenhum efeito financeiro real implícito

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-17 — Completar conhecimento e registry governado

**Origem:** AUD13-20, AUD13-20A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/knowledge/`, `packages/agent-policy/`, `packages/agent-runtime/`, `packages/persistence/`, `apps/api/`, `tests/`.

Critérios de aceite:

- Ingestão/indexação/versão/consulta/revogação têm estados reais
- Model/prompt/tool/skill/MCP usam admissão e manifesto compatível
- Kill switch impede execução e fontes revogadas deixam de alimentar resposta
- Citação/contexto e isolamento testados; sem índice fictício

Verificação:

- Jornada ingerir→consultar→revogar com worker local
- Admissão inválida, prompt injection e kill switch

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-18 — Completar automações, workers e comunicação

**Origem:** AUD13-25, AUD13-25A. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/web/src/features/communications/`, `apps/worker/`, `apps/api/`, `packages/integrations/`, `packages/persistence/`, `tests/`.

Critérios de aceite:

- Criar/agendar/cancelar/acompanhar automação com janela e receipt
- Worker real respeita lease/fence/backpressure e exclusão por contexto
- Comunicação exige aprovação e reconcilia outcome_unknown
- Prévia local não envia mensagem real

Verificação:

- Jornada com adapter sintético e dois workers
- Cancelamento concorrente, atraso, indisponibilidade e replay

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-19 — Readiness atual por capacidade e operação manual

**Origem:** AUD13-30. **Achados:** E12. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `apps/api/src/routes/health.ts`, `apps/api/src/app.ts`, `packages/integrations/`, `tests/`.

Critérios de aceite:

- Sinais de banco/auditoria/outbox/secrets vêm de observação atual
- Capacidade manual pode operar quando IA indisponível conforme PRD
- Capacidade dependente falha fechado sem ready global enganoso
- Rotação/revogação de secret atualiza estado sem depender de reinício

Verificação:

- Probe E12 positivo/negativo
- Falhas simuladas em cada dependência e rota manual real

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-20 — Completar métricas, causalidade e relatórios reais

**Origem:** AUD13-29. **Achados:** E16. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/ops/`, `apps/api/src/application/`, `apps/web/src/features/overview/`, `apps/web/src/features/ops/`, `tests/`.

Critérios de aceite:

- Preservar buffers limitados já entregues
- Trace liga request→comando→worker→provider com dados redigidos
- Relatórios usam período/contexto/dados reais e mostram indisponibilidade
- Limites e cardinalidade medidos sob volume

Verificação:

- npm test
- Probe de volume limitado e jornada de relatório
- Comparar métricas com receipts do dataset

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-21 — Renderizar alertas e provar entrega

**Origem:** AUD13-31. **Achados:** E15. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `docker/observability/`, `docker-compose.observability.yml`, `scripts/`, `tests/`, `docs/`.

Critérios de aceite:

- Configuração renderizada válida sem placeholder literal
- Ausência de destinatário impede ativação sem simular entrega
- Alerta e resolução chegam ao sink autorizado com timestamps

Verificação:

- Validação de config e sink loopback
- Drill real de entrega no ambiente autorizado

**Dependências externas:** Sink de alertas e destinatário controlado autorizado

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-22 — Substituir prova textual de runbook por execução

**Origem:** AUD13-32. **Achados:** E13. **Dono proposto:** Builder. **Esforço:** M: 1–3 sessões técnicas; decompor após reprodução.

**Superfície máxima:** `scripts/verify-runbook-execution.ts`, `tests/`, `docs/runbooks/`.

Critérios de aceite:

- Contrato textual separado de EXECUTED
- Cada cenário invoca runtime e registra transição/efeito bloqueado/recuperação
- Mutação conhecida no handler faz gate falhar

Verificação:

- Probe E13 deve deixar de aprovar execução fictícia
- Casos bons/ruins de cenário runtime; prova externa em AAA2-30

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-23 — Criar workloads completos e thresholds por jornada

**Origem:** AUD13-32, AUD13-36. **Achados:** E14. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `tests/load/`, `scripts/verify-load.ts`, `tests/unit/`, `docs/`.

Critérios de aceite:

- Workloads incluem escritas clínicas, IA, provider e fila com reconciliação
- Autorização, idempotência, assertions semânticas e mix definidos
- Thresholds por operação/cenário e cobertura obrigatória rejeitam omissões
- Teste inválido/GET-only não passa como workload integral

Verificação:

- Validação local do harness com servidor sintético
- Known-bad em receipt/estado/threshold; execução real em AAA2-30

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-24 — Lifecycle e restore útil com reconciliação

**Origem:** AUD13-24. **Achados:** E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/persistence/`, `apps/worker/`, `scripts/verify-postgres-restore.ts`, `docs/runbooks/`, `tests/`.

Critérios de aceite:

- Retenção/export/expurgo e backup respeitam autoridade e integridade
- Restore em quarentena reconcilia efeitos e chega a capacidade útil autorizada
- RTO/RPO medidos incluem retorno útil; manifest/chaves/audit intactos

Verificação:

- npm run test:restore
- npm run verify:postgres:restore em banco efêmero
- Drill operacional posterior no candidato

**Dependências externas:** Políticas de retenção/residência e objetivos de recuperação aprovados

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-25 — Preparar e integrar provider, secrets e MFA forte

**Origem:** AUD13-26, AUD13-28. **Achados:** E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/integrations/`, `packages/auth/`, `packages/config/`, `apps/api/`, `apps/worker/`, `docs/staging.md`, `tests/`.

Critérios de aceite:

- Inventariar autoridade/disponibilidade sem repetir autorização já válida
- Provider tem query/receipt/reconciliação; secrets rotação/revogação observáveis
- WebAuthn/break-glass provam autenticação forte, TTL e revogação
- Contratos locais continuam quando etapa externa bloqueada

Verificação:

- npm run verify:provider-sandbox
- npm run verify:provider-real apenas com autoridade
- Cenários reais controlados de secrets/WebAuthn

**Dependências externas:** Provider e destinatário de teste, secret authority, autenticador e limites autorizados

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-26 — Comprovar vertical DeepSeek governada real

**Origem:** AUD13-27. **Achados:** E17, E03, E04. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/deepseek-bridge/`, `packages/deepseek-bridge/`, `packages/harness-adapters/`, `scripts/`, `tests/`, `docs/`.

Critérios de aceite:

- Composição real injeta governor/budget duráveis
- Turno/approval/usage/receipt ligados a mesmo candidato
- Timeout/revogação/restart/overage falham de modo governado
- Engine/model/manifests e custos registrados sem segredo

Verificação:

- npm run verify:deepseek-acp
- npm run verify:deepseek-real com autoridade
- Matriz de falhas no adapter real

**Dependências externas:** Engine/manifest/modelo/credencial e teto de custo autorizados

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-27 — Publicar candidato verificável em CI e staging autorizado

**Origem:** AUD13-34. **Achados:** E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `Dockerfile.api`, `Dockerfile.web`, `.github/`, `scripts/`, `docker/`, `docs/`.

Critérios de aceite:

- CI, SBOM, scan, imagem e staging ligados ao mesmo commit/digest
- Smoke prova startup/shutdown/outbox replay/restart e headers
- Config produção falha fechado; rollback/forward-fix ensaiados
- Nenhuma promoção pública implícita

Verificação:

- npm run build
- npm run verify:release-provenance
- npm run verify:container-smoke
- npm run verify:staging

**Dependências externas:** Runner/registry/staging autorizado e runtime de containers disponível

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-28 — Refatorar e otimizar por perfil observado

**Origem:** AUD13-33. **Achados:** E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `apps/api/src/application/`, `packages/domain/`, `packages/persistence/`, `apps/web/`, `tests/`.

Critérios de aceite:

- Medir hotspots e dependências antes de extração
- Reduzir acoplamento/payload/chunk apenas com benefício medido
- Preservar contratos e invariantes; não substituir requisito por contagem de linhas

Verificação:

- Perfil antes/depois com mesmo dataset
- npm run build
- Regressões das fronteiras alteradas

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-29 — Provar jornadas por persona, browser e tecnologia assistiva

**Origem:** AUD13-35. **Achados:** E05, E06, E07, E08, E09, E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `tests/e2e/`, `apps/web/`, `docs/`.

Critérios de aceite:

- Todas jornadas FR e personas verificadas além de admin/demo
- Chromium/Firefox/WebKit desktop/tablet/mobile com estados adversos
- Leitor de tela, zoom real, teclado e usuários representativos completam tarefas
- Registrar contexto/período e screenshots sem dados reais

Verificação:

- npm run test:e2e:full em ambiente isolado
- Sessões assistivas e usabilidade com registros

**Dependências externas:** Participantes representativos e tecnologias assistivas disponíveis

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-30 — Provar operação adversa e recuperação no candidato

**Origem:** AUD13-36. **Achados:** E17. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `scripts/`, `tests/`, `docs/`, `artifacts/`.

Critérios de aceite:

- Carga/chaos/recurso/backup/restore medidos no candidato integrado
- RLS e red-teams de aplicação/DB independentes conforme barra
- SLO/RTO/RPO e alertas têm conteúdo bruto e autoridade
- Falhas geram reparo e reteste; não apenas relatório

Verificação:

- npm run verify:load
- npm run verify:security-red-team
- npm run verify:resource-pressure
- npm run verify:postgres:concurrency
- Runbooks operacionais

**Dependências externas:** Ambiente e escopo de carga/ataque/chaos, operadores e objetivos autorizados

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-31 — Consolidar dossiê e Gauntlet final fresco

**Origem:** AUD13-37. **Achados:** E10, E17. **Dono proposto:** Lead/Críticos. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `docs/`, `.agent/`, `artifacts/`.

Critérios de aceite:

- Todos E01–E18 e residual AUD13 têm implementação/evidência ou bloqueio explícito
- Matriz FR/NFR, F0–F38,25gates,22dimensões preservada
- Críticos frescos independentes inspecionam artefato imóvel; ausência de revisão não vira score
- Candidato técnico pode ficar pronto com F38 pendente, sem AAA falso

Verificação:

- Verificar hashes e reexecutar gates pertinentes
- npm run verify:triplo-aaa deve falhar enquanto falta requisito obrigatório

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-32 — Obter decisão humana e promover somente artefato aprovado

**Origem:** AUD13-38. **Achados:** E17. **Dono proposto:** Release/Humano. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `docs/`, `.agent/`, `scripts/`.

Critérios de aceite:

- Decisor avalia candidato concreto e riscos residuais
- Atestação/assinaturas e requisitos da barra válidos
- Promoção requer autorização específica e mesmo digest; se negada, registrar sem contornar

Verificação:

- npm run verify:promotion-invariant
- npm run verify:triplo-aaa
- Validar decisão real e receipt de promoção quando autorizada

**Dependências externas:** Aceite humano real e autorização específica de promoção

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.

## AAA2-33 — Completar semântica clínica dos exames

**Origem:** AUD13-15. **Achados:** E18. **Dono proposto:** Builder. **Esforço:** L: decompor em fatias verticais de 1–3 sessões; estimar após descoberta.

**Superfície máxima:** `packages/contracts/`, `packages/domain/`, `packages/persistence/`, `apps/api/`, `apps/web/src/features/diagnostics/`, `tests/`.

Critérios de aceite:

- Pedido preserva amostra/instruções conforme UC03
- Resultado estrutura unidade/referência/horário/origem/versão quando aplicável
- Unidade incompatível e resultado incompleto são rejeitados sem publicação parcial
- Compatibilidade e revisão clínica preservadas

Verificação:

- Jornada pedido→coleta→resultado→revisão
- Teste de unidade incompatível, duplicação e histórico

**Dependências externas:** Nenhuma para a fatia local; efeitos externos seguem autoridade explícita.

**Evidência:** candidato/contrato, comando/exit/dataset, resultados bons e ruins, artefato bruto sanitizado e revisão independente.

**Recuperação:** Preservar alterações preexistentes; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; reconciliar efeitos incertos antes de retry. Registrar próxima ação singular.
