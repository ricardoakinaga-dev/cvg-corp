# Plano executivo — CVG-Corp AAA

## Resultado esperado

Elevar o sistema de **72/100 na auditoria local** a um candidato que satisfaça a barra AAA já existente: todas as 22 dimensões acima de seus limiares de 95–97, **Overall ≥97**, nenhuma falha alta/crítica aberta, provas operacionais atuais e aprovação humana atestada. A qualidade é demonstrada pelo comportamento, integridade e capacidade de recuperação; quantidade de agentes, linhas de código ou testes não é indicador de sucesso.

Os três pilares do produto permanecem os de `docs/06-operacao-qualidade-e-recuperacao.md`: assistência segura, administração íntegra e aceleração governada. O domínio transacional continua sendo a fonte de verdade; o motor de IA continua externo e sujeito a policy, budget, revisão e aprovação.

## Mandato e limite desta entrega

Esta entrega salva e organiza documentação executável para a implementação futura. O relatório original já está em `docs/`. Não muda código, dependências, estado de produção, aprovações ou barra de aceite. O usuário pretende um programa AAA; o planejamento não declara essa condição atingida.

Perfil do programa: evolução brownfield com fronteiras de segurança, dados e operação; tier de execução T4 conforme estado existente. Atividade desta entrega: planejamento. As tarefas distantes precisam de refinamento de superfície e estimativa quando seus pré-requisitos forem observados.

## Baseline confiável

O commit auditado é `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`. A auditoria observou 328 aprovações, uma falha e um skip em 330 testes; build limpo e E2E Chromium aprovados no recorte; defeitos de logout e total financeiro reproduzidos; gate de produção reprovado. Não se presume que PostgreSQL, providers, observabilidade ou recuperação tenham nova prova operacional.

Existe estado anterior em `.agent/` vinculado a outro SHA e uma barra v4 congelada em `.gauntlet/`. A tarefa AAA-000 reconcilia essas informações. Os dois itens históricos do backlog permanecem preservados; o programa novo detalha o escopo do item ativo `CVG-FULL-STATE-OF-THE-ART`.

## Objetivos executivos e indicadores

| Resultado | Indicador de saída | Responsável pela decisão |
|---|---|---|
| Usuário confia em saída e saldo | Logout tem resultado honesto; pago/parcial/estorno conciliam UI/API/ledger | Lead e críticos de segurança/financeiro; regra ambígua com responsável financeiro |
| Jornadas essenciais completas | 100% das jornadas essenciais acordadas em FUN-01 têm caminho UI→policy→commit→receipt e falha recuperável | Responsáveis de produto/área + crítico funcional |
| Domínio e dados íntegros | Zero violação nos cenários negativos de escopo, concorrência, audit e restore | Dados + crítico independente |
| IA e provider realmente governados | Vertical externa e falhas observadas com usage/receipt/replay; sem fallback falso | IA/integrações + segurança |
| Operação detectável e recuperável | Alerta recebido, carga medida, backup/restore/runbook e RTO/RPO demonstrados | SRE + operador independente |
| Release reproduzível | Mesmos SHA/digests em CI, SBOM, staging, provas e promoção | Release + verificador independente |
| AAA elegível | F0–F38, 25 gates, 22 dimensões e Overall ≥97 com autoridade real | Críticos finais + decisor humano |

As metas de área estão nas 16 fichas e na matriz de [qualidade](qualidade.md). A meta agregada de área não substitui cada dimensão do verificador. O resultado de promoção é binário em relação aos gates obrigatórios; média alta não compensa falha.

## Estratégia de investimento e execução

1. **Restaurar confiança e capacidade de medir:** logout, saldo, fixtures determinísticas, árvore de dependências e evidência portátil. Corrigir antes de ampliar a superfície.
2. **Completar jornadas e comprovar domínio:** estoque, clínico, financeiro, contratos, PostgreSQL real e workers. Extrações arquiteturais acompanham fronteiras estáveis, sem reescrita geral.
3. **Retirar incerteza operacional:** preparar acessos no M0, executar providers/IA/segredos/TLS/telemetria/backup assim que os contratos estiverem integrados.
4. **Demonstrar qualidade sob condições adversas:** concorrência, carga, caos, tecnologia assistiva e red-team; corrigir e repetir a reprodução original.
5. **Congelar e avaliar candidato:** prova do mesmo artefato, críticos frescos, dossiê e decisão humana. Alterações posteriores invalidam a evidência afetada e exigem nova avaliação.

## Organização e capacidade

Equipe operacional recomendada por janela: **um Lead/integrador, dois builders e um crítico**, até quatro slots simultâneos no ambiente atual. Especialidades são papéis, não 16 agentes permanentemente ativos. O reviewer entra com contexto novo; o autor nunca aprova a própria entrega.

O Lead controla `.agent/`, contratos compartilhados, integração, disponibilidade das dependências e reserva de recursos. Builders trabalham por tarefa/fatia. Críticos trabalham sobre candidato identificado, em leitura, com critérios definidos antes da mudança. Especialistas humanos decidem regras de negócio e atos reservados que os agentes não podem inventar.

## Esforço, orçamento e compromisso de prazo

O catálogo usa S/M/L: 1, 2–3 ou 4–6 sessões de 2–4 horas por tarefa especializada, antes de esperas externas. É estimativa inicial de esforço, não calendário ou garantia. Tarefa L é decomposta em fatias independentes antes de execução, mantendo rastreabilidade ao ID pai.

Em AAA-000, somar faixas por caminho de dependência, reservar **25% da capacidade para revisão/integração** e **20–30% de contingência** sobre implementação estimada. Não calcular prazo apenas dividindo o esforço por número de agentes: arquivos exclusivos, banco, ambientes e decisões humanas criam trechos seriais. Reestimar no fim de M0 com duas ou três tarefas medidas; no fim de cada marco, publicar esforço realizado, restante, espera externa e maior risco.

Custos de infraestrutura, API de modelo, provider, retenção e testes de carga são variáveis em aberto; DEV-02/PER-01 produzem cenário e limite antes de consumo externo. O roadmap usa marcos e gates, sem datas de término fictícias.

## Decisões e recursos a resolver cedo

| Item | Dono esperado | Pode avançar antes? | Bloqueia |
|---|---|---|---|
| Semântica de estorno, reabertura de dívida e alçadas ausentes | Responsável financeiro, FIN-04 | Sim: excluir PAID do total incorreto e demais casos já definidos | Aceite financeiro integral |
| Jornadas essenciais e regras clínicas ainda ambíguas | Responsável clínico/produto, FUN-01/FUN-03 | Sim: inventário, regras existentes e correções técnicas | Novos atos clínicos e validação funcional final |
| Staging, TLS, PostgreSQL, referências de segredos e ambientes separados | Responsável infraestrutura, DEV-02 | Sim: manifests, scripts, fixtures e banco local próprio | Prova operacional externa |
| DeepSeek/provider, destinatários de teste e teto de custo | Responsável integrações, AIG-02/WRK-03 | Sim: contrato e sandbox local | Vertical real e falhas externas |
| SLO/capacidade, RTO/RPO e retenção | Operação/produto, PER-01/OPS-02/OPS-03 | Sim: baseline e proposta técnica | Aceite das medições finais |
| Usuários, operador assistivo e avaliadores independentes | Produto/operação, UX-03/A11Y-02/DEV-04 | Sim: preparar roteiros e automação | Prova humana/assistiva e Gauntlet final |
| Aprovação do candidato e eventual deploy | Decisor humano, DEV-05 | Sim: candidato, dossiê e plano de rollback | F38 e promoção autorizada |

As exigências de aprovação final vêm da barra v4 e de F38 do prompt final existente. Não são um pedido de confirmação nesta entrega de planejamento. O trabalho local já especificado e autorizado na futura execução deve continuar sem repetir perguntas já resolvidas.

## Riscos executivos

| Risco | Controle | Gatilho de replanejamento |
|---|---|---|
| Estado/evidência histórica produzir falso verde | AAA-000 + QUA-01/02; hashes, fixtures controladas e prova por candidato | SHA/contrato/bytes alterados ou teste ligado a dirty tree |
| Agentes sobrescreverem arquivos, migrations ou estado | Dono exclusivo, worktrees, reservas de recursos e integração única | Qualquer colisão ou diff fora do contrato |
| Testes excessivamente sintéticos ocultarem integração incompleta | Separar LOCAL, REAL_TEST e PROMOTION; exigir receipt do efeito | Mock usado como prova de provider/DB/recovery real |
| Refatoração extensa atrasar correções de usuário | Entregar SEC-01/FIN-02 antes de ARC-02/03 | Extração sem benefício verificável ou regressão de contrato |
| Nova regra financeira/clínica ser inferida sem autoridade | Registrar ambiguidade e pedir apenas decisão específica quando necessária | Alteração sem fonte em FUN-01/FIN-04 |
| Infraestrutura/custo/acesso atrasar caminho crítico | DEV-02 no início, dono e data de disponibilidade registrados | Pré-requisito continua ausente ao iniciar M3 |
| Reduzir barra ou atualizar baseline para passar | Critério congelado, crítico independente e histórico de falhas | Threshold alterado sem mudança legítima de requisito/método |

## Governança, recuperação e conclusão

Uma atualização de tarefa segue: artefato/contrato → backlog canônico → registro de evidência/log → ponteiro de estado. O Lead é o único escritor desses registros. Cada handoff inclui SHA, dirty tree, ID, último comando/resultado, recursos criados, efeito incompleto e próxima ação única.

Reverter somente mudanças próprias não integradas; migrations aplicadas usam forward-fix; provider com resultado desconhecido exige consulta/reconciliação. Um reviewer que escreve invalida sua revisão e o Lead inspeciona o diff preservado. Uma falha nova reabre a tarefa e a prova afetada fica STALE.

**Conclusão do planejamento:** pacote disponível, cobertura e DAG validados; nenhum resultado futuro alegado. **Conclusão do programa:** todos os gates e autoridades exigidos satisfeitos pelo candidato atual. Até lá o estado global permanece AAA_NOT_PROVEN/FAIL_WITH_LIMITATIONS, mesmo com marcos locais aprovados.

Próxima ação executável da futura implementação: **AAA-000**, seguida das frentes prontas definidas no roadmap. O detalhe dos contratos pertence ao [backlog](backlog.json); este documento não mantém uma segunda lista de status.
