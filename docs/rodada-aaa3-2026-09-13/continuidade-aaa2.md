# Continuidade integral do programa AAA2

Cada contrato mantém todos os aceites, fontes e dependências do [catálogo original](../plano-triplo-aaa-pos-entrega-2026-09-13/backlog.json). AAA3 prioriza uma rodada; não substitui nem reduz o programa. A ponte AAA2→AUD13 continua em [rastreabilidade anterior](../plano-triplo-aaa-pos-entrega-2026-09-13/rastreabilidade.md).

| Contrato | Entrega | Avaliação desta baseline | Trabalho na rodada |
|---|---|---|---|
| AAA2-01 | Reconciliar aceite, estado e trabalho residual | LOCAL_ACCEPTANCE_PRESERVED | AAA3-01 |
| AAA2-02 | Proteger prescrição terminal e dispensação | LOCAL_ACCEPTANCE_PRESERVED_DB_PENDING | AAA3-09 |
| AAA2-03 | Contabilizar uso real e reter orçamento em disputa | REMAINING_REQUIREMENT | AAA3-03 |
| AAA2-04 | Tornar reserva e settlement ACP obrigatórios e duráveis | REMAINING_REQUIREMENT | AAA3-06 |
| AAA2-05 | Revalidar autoridade na conclusão e divulgação da IA | REMAINING_REQUIREMENT | AAA3-05 |
| AAA2-06 | Isolar prontuários e carregar todos os adendos | REMAINING_REQUIREMENT | AAA3-04 |
| AAA2-07 | Entregar dispensação acessível ao perfil de farmácia | REMAINING_REQUIREMENT | AAA3-07 |
| AAA2-08 | Completar admissão de internação planejada | REMAINING_REQUIREMENT | AAA3-08 |
| AAA2-09 | Corrigir foco e leitura de documentos assinados | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-10 | Reconstruir proveniência e gates do candidato | REMAINING_REQUIREMENT | AAA3-02, AAA3-11 |
| AAA2-11 | Provar idempotência e retomada de claims em banco | REMAINING_REQUIREMENT | AAA3-09 |
| AAA2-12 | Migrar escritas primárias residuais com invariantes | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-13 | Completar anexos clínicos governados | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-14 | Completar checklist e consentimento de admissão | REMAINING_REQUIREMENT | AAA3-10 |
| AAA2-15 | Completar fornecedor e custo de estoque | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-16 | Completar orçamento, aprovação e conciliação financeira | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-17 | Completar conhecimento e registry governado | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-18 | Completar automações, workers e comunicação | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-19 | Readiness atual por capacidade e operação manual | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-20 | Completar métricas, causalidade e relatórios reais | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-21 | Renderizar alertas e provar entrega | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-22 | Substituir prova textual de runbook por execução | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-23 | Criar workloads completos e thresholds por jornada | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-24 | Lifecycle e restore útil com reconciliação | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-25 | Preparar e integrar provider, secrets e MFA forte | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-26 | Comprovar vertical DeepSeek governada real | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-27 | Publicar candidato verificável em CI e staging autorizado | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-28 | Refatorar e otimizar por perfil observado | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-29 | Provar jornadas por persona, browser e tecnologia assistiva | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-30 | Provar operação adversa e recuperação no candidato | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-31 | Consolidar dossiê e Gauntlet final fresco | REMAINING_REQUIREMENT | AAA3-11, AAA3-12 |
| AAA2-32 | Obter decisão humana e promover somente artefato aprovado | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |
| AAA2-33 | Completar semântica clínica dos exames | REMAINING_REQUIREMENT | Continuar pelo DAG original; obrigatório |

Regressão dos aceites locais não equivale a reabrir implementação sem defeito novo. Provas de PostgreSQL, externalidades, browsers/assistividade, carga/recovery, Gauntlet e decisão humana continuam exigidas. AAA2-09 (foco) segue o conserto clínico; AAA2-33 (exames) não pode ser omitida por ter ID posterior ao dossiê.

Para cada associação, o estado canônico deve distinguir preparação, implementação local e prova dependente. O próximo agente resolve dependências pelo critério/fatia, não por marcar o pai inteiro DONE para liberar um filho.
