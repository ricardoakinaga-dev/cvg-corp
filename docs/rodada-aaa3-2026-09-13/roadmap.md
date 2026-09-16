# Roadmap da rodada AAA3 e continuidade

O [backlog](backlog.json) define dependências da rodada. Os aceites e dependências AAA2 continuam válidos; associações novas refinam fatias e não promovem o contrato pai inteiro. A preparação de uma decisão não satisfaz sua aprovação.

| Marco | Trabalho | Gate de saída |
|---|---|---|
| A — Retomada executável | AAA3-01/02; preparar10 | Primeira ação correta; dependência pai/filho sem ciclo; tarefas independentes continuam |
| B — Integridade imediata | AAA3-03/04/05; depois06 | Probes de orçamento/contexto/revogação passam a exigir e observar o comportamento correto |
| C — Jornada e persistência | AAA3-07/08/09 | Estoque conclui dispensação; episódio planejado retoma; corrida em banco tem evidência real ou lacuna explícita |
| D — Evidência e passagem | AAA3-11/12 | Logs atuais, revisão e mapa integral; próxima tarefa executável selecionada |
| Continuidade obrigatória | Demais critérios AAA2 | Completar jornadas/autoridade/infraestrutura e provas da barra; não encerrar em D como se fosse AAA |

## Ordem inicial recomendada

1. Corrigir apenas a retomada observada em AAA3-01, preservando E01 e o aceite local anterior.
2. Selecionar AAA3-03 (budget) no domínio e AAA3-04 (adendos) na UI, caso arquivos e recursos sejam disjuntos. Lead pode preparar D-02 e o verificador sem editar código desses builders.
3. Integrar03;05 pode avançar com owner separado do adapter se não houver conflito.06 depende03/05.
4.07 pode reutilizar E01 local já validado; a ausência de prova multiprocesso fica em09. Não esperar todo AUD13-16 concluir para construir uma UI independente de farmácia.
5.08 separa atribuição técnica de leito das regras clínicas ainda desconhecidas.09 usa PostgreSQL exclusivo; se indisponível, preparar harness e prosseguir nas demais frentes.
6. Após04, executar também AAA2-09 (foco) pelo contrato herdado. Não adiar essa correção até produção.

## Tratamento de D-02

AAA3-10 prepara o material de decisão e pode concluir essa preparação. Somente resposta da autoridade clínica libera os aceites dependentes de AUD13-16A/AAA2-14. O filho não deve exigir conclusão integral do pai que depende dele; requer apenas as fatias técnicas antecedentes e a decisão aplicável.

Se não houver resposta, registrar o bloqueio específico. Não inferir autorização por tempo, não inventar regra e não suspender orçamento, revogação ou correção de contexto clínico.

## Continuidade após a rodada

A [matriz dos 33 contratos](continuidade-aaa2.md) mantém o programa completo. Prosseguir por tarefas prontas no DAG: fontes autoritativas e claims; anexos/consentimento/estoque/financeiro; registry/workers/exames; readiness/telemetria/alertas/harnesses; integrações/CI/staging; browsers/assistividade/carga/recovery; dossiê/Gauntlet e decisão humana.

AAA2-33 de exames continua obrigatória antes do dossiê, mesmo com ID posterior. AAA2-31 não ganha DONE porque AAA3-12 encerrou uma rodada local. AAA2-32 continua exigindo decisão humana e autorização específica para promoção.

## Estimativa e replanejamento

Não há data prometida. Medir esforço/retrabalho das primeiras fatias e disponibilidade do banco, serviços externos e responsáveis. Replanejar por dependência e risco real; não reduzir a barra, substituir prova por fixture nem repetir verificações sem nova alteração ou hipótese.
