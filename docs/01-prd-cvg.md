# CVG-Corp — PRD do programa de gestão veterinária

**Tipo:** Product Requirements Document

**Estado:** TARGET/PROPOSED; requer validação com direção clínica e operação do Centro Veterinário Guarapiranga.

## 1. Visão e resultado

O CVG-Corp deve ser o sistema operacional de trabalho do Centro Veterinário Guarapiranga: uma única experiência para recepção, atendimento clínico, exames, internação, cirurgia, farmácia/estoque, financeiro, comunicação e automação assistida por IA.

O resultado esperado é reduzir retrabalho e perda de contexto sem permitir que automação substitua a responsabilidade profissional, que um tenant veja dados de outro escopo, ou que uma falha técnica produza uma decisão clínica ou financeira silenciosamente.

### Primeira entrega confirmada em 2026-09-08

Somente CVG, preparado para várias unidades. A primeira entrega será M1 local com dados sintéticos: autenticação, organização/unidade, permissões e auditoria. Papéis iniciais: administrador da organização, veterinário, recepção e operador técnico, com os limites confirmados nos [registros DEC-M1-01 a 03](08-rastreabilidade-e-decisoes.md#fechamento-confirmado-em-2026-09-08). As jornadas abaixo permanecem como alvo dos milestones posteriores.

## 2. Problema

O programa precisa resolver a fragmentação entre agenda, cadastro do tutor, paciente animal, prontuário, documentos, exames, estoque, cobrança e comunicação. As fontes de harness corporativo acrescentam um segundo problema: oferecer IA útil com modelos, ferramentas, conhecimento, memória, orçamento e governança centralizados.

O material de referência descreve esse segundo problema, mas não fornece os processos reais do CVG. O workflow veterinário abaixo é, portanto, um desenho inicial `PROPOSED`, não uma descrição da operação atual.

## 3. Objetivos e não objetivos

### Objetivos P0

- Manter identidade, relacionamento tutor–paciente, agenda, atendimento, prontuário, anexos, tarefas e auditoria em uma fonte transacional consistente.
- Permitir que cada papel veja e altere somente recursos autorizados no contexto correto: organização, unidade, workspace, paciente, atendimento e função.
- Oferecer copilotos de recepção, documentação clínica, operação e gestão que produzam rascunhos, resumos, alertas e consultas rastreáveis.
- Exigir revisão humana para diagnóstico, prescrição, dispensação, cirurgia, alta, comunicação sensível, alteração clínica assinada, reembolso e exclusão/exportação de dados.
- Registrar consumo de modelos, tools, mídia e integrações por tenant, workspace, usuário, sessão e operação, com limites hard/soft e reconciliação.
- Permitir continuidade segura durante falha de provider ou conexão, sem criar novos privilégios nem confirmar efeitos desconhecidos.

### Objetivos P1

- Integrar exames, laboratório/imagem, internação, centro cirúrgico, farmácia, fornecedores, pagamentos e comunicação por conectores governados.
- Centralizar processos, manuais e políticas do CVG em uma base de conhecimento com filtros de escopo e citações.
- Automatizar tarefas repetitivas com scheduler, filas, idempotência, janela de execução e relatório de falha.
- Medir qualidade clínica-operacional, uso da IA, custo, tempo de ciclo, incidentes, negações e retrabalho.

### Não objetivos desta definição

- O agente não é um sistema autônomo de diagnóstico, prescrição, anestesia, cirurgia, triagem definitiva ou alta.
- A sessão do DeepSeek Harness não substitui o prontuário assinado, o ledger de estoque, o ledger financeiro ou o log de auditoria do CVG.
- Não serão escolhidos nesta fase fornecedor de nuvem, provedor de pagamento, modelo LLM, integração fiscal ou requisito regulatório específico sem decisão do responsável.
- Não há compromisso com desktop Electron, mobile nativo ou offline completo; a superfície inicial deve ser escolhida por descoberta de operação e risco.

## 4. Atores e escopos

Os quatro papéis iniciais de M1 foram confirmados no recorte acima. A matriz granular, os demais papéis e as alçadas clínicas abaixo permanecem `PROPOSED` até validação aplicável.

| Ator | Objetivo | Escopo padrão | Ações de alto impacto |
|---|---|---|---|
| Direção clínica | Definir protocolos, revisar qualidade e supervisionar profissionais. | Organização e unidades clínicas. | Aprovar protocolos, revisar auditorias, delegar responsabilidade. |
| Médico-veterinário | Avaliar, registrar, prescrever, solicitar exames e acompanhar o paciente. | Seus atendimentos e pacientes autorizados. | Assinar nota, diagnóstico, prescrição, alta e plano clínico. |
| Enfermagem/técnico | Executar cuidados, medições, administração e registros delegados. | Unidade, setor, plantão e pacientes atribuídos. | Registrar administração; não assinar ato reservado ao veterinário. |
| Recepção/atendimento | Cadastrar tutor/paciente, agenda, check-in, comunicação e documentos administrativos. | Unidade e filas de recepção. | Não acessar conteúdo clínico além do mínimo necessário. |
| Financeiro/caixa | Orçamentos, lançamentos, pagamentos, conciliação e relatórios. | Organização/unidade financeira. | Estorno, desconto fora da alçada e fechamento. |
| Estoque/farmácia | Compras, lotes, validade, inventário, dispensação e rastreabilidade. | Almoxarifado, farmácia e unidades. | Dispensação controlada pela prescrição/policy; ajuste de estoque com motivo. |
| Gestor de workspace | Configurar ferramentas, conhecimento, políticas, budget e automações da área. | Um workspace/área. | Publicar policy que afete subordinados, nunca ultrapassar o tenant. |
| Administrador da organização | Gerenciar usuários, unidades, integrações, acessos e parâmetros do CVG. | Organização/tenant. | Conceder privilégios, exportar, revogar e configurar integrações. |
| Operador de plataforma | Operar disponibilidade e componentes compartilhados, sem acesso clínico por padrão. | Plataforma técnica, sem conteúdo por padrão. | Acesso emergencial somente com autorização, janela e auditoria. |
| Tutor/responsável | Receber orientações, autorizar procedimentos e acompanhar o paciente. | Seus vínculos e comunicações. | Consentir, confirmar dados, receber documentos liberados. |
| Agente de IA | Consultar, sintetizar, sugerir e executar tools liberadas. | Sessão, workspace e recursos da solicitação. | Nenhum ato de alto impacto sem aprovação humana válida. |

## 5. Jornadas principais

### UC-01 — Agendar e receber

**Ator:** recepção ou tutor autorizado. **Pré-condições:** identidade autenticada e unidade selecionada.

1. Pesquisar tutor e paciente por identificadores permitidos, evitando criar duplicata sem confirmação.
2. Selecionar serviço, profissional, unidade, recurso e janela disponível.
3. Confirmar contato, consentimentos, motivo resumido e instruções prévias autorizadas.
4. Criar a reserva com chave idempotente, emitir confirmação e criar a fila de check-in.
5. No check-in, confirmar identidade e marcar a presença; divergência bloqueia avanço até correção.

**Negação/erro:** uma recepção fora da unidade, um horário ocupado, um paciente sem vínculo ou uma integração indisponível não pode criar uma reserva parcial. A resposta deve indicar o próximo passo e o registro que permaneceu.

**Recuperação:** em conflito ou timeout, a reserva permanece `NOT_CONFIRMED`/`PENDING_EXTERNAL` com chave idempotente; a recepção pode consultar, corrigir o contexto ou repetir com a mesma chave. O caminho manual registra a decisão e nenhum lembrete é enviado sem receipt.

**Resultado observável:** uma única reserva auditada, com tutor, paciente, serviço, unidade, profissional, horário, status e origem.

### UC-02 — Triagem e atendimento clínico

**Ator:** enfermagem/técnico e médico-veterinário. **Pré-condições:** check-in confirmado e paciente resolvido.

1. Registrar sinais observados, parâmetros, queixa e prioridade conforme protocolo do CVG.
2. Encaminhar para fila, setor ou profissional; toda mudança de prioridade exige ator e motivo.
3. Abrir o atendimento, revisar histórico mínimo necessário e registrar evolução.
4. O copiloto pode organizar informações e apontar campos ausentes, sem concluir diagnóstico ou conduta.
5. O veterinário decide, assina a nota e registra plano, prescrição, solicitação de exame ou encaminhamento.

**Negação/erro:** identidade ambígua, contexto insuficiente, policy ausente ou sugestão sem origem impede que a IA escreva no prontuário. Falha do agente não impede registro manual.

**Recuperação:** o atendimento permanece aberto ou em rascunho, com pendências e versão preservadas; o profissional continua pelo formulário manual. Provider/session indisponível, versão concorrente ou falha de assinatura produz erro acionável, não publicação parcial; uma nova tentativa reutiliza a chave segura ou cria um adendo.

**Resultado observável:** atendimento com linha do tempo, autoria, versão, assinatura, referências e estado clínico-operacional.

### UC-03 — Exame e resultado

**Ator:** veterinário, enfermagem/técnico e laboratório autorizado.

1. Criar pedido com paciente, atendimento, exame, prioridade, amostra e instruções.
2. Registrar coleta com identificador de amostra e cadeia de custódia quando aplicável.
3. Ingerir ou lançar resultado com origem, versão, unidade, referência e horário.
4. Disponibilizar o resultado somente aos papéis autorizados e gerar tarefa de revisão.
5. O agente pode resumir o resultado e apontar divergências; o veterinário interpreta e assina a conclusão.

**Negação/erro:** resultado sem amostra ou paciente, unidade incompatível, reenvio duplicado ou integração sem autenticação não entra como resultado clínico válido.

**Recuperação:** o item fica `QUARANTINED` com motivo, origem e correlação; a equipe corrige o vínculo ou solicita reenvio por uma nova versão. Timeout ou resposta perdida não dispara publicação automática: um worker consulta o identificador externo, reconcilia ou mantém `OUTCOME_UNKNOWN` para decisão humana.

**Resultado observável:** pedido, amostra, resultado e revisão ficam ligados por versão, autoria, timestamps, origem, status e tarefa de revisão.

### UC-04 — Internação, procedimento e alta

**Ator:** equipe clínica, enfermagem/técnico e direção clínica.

1. Abrir episódio de internação/procedimento com leito, responsável, checklist e consentimentos.
2. Registrar sinais, medicações administradas, eventos e handoffs com horário e autoria.
3. O sistema alerta conflito, dose/horário incompleto ou item sem lote; não autoriza silenciosamente.
4. O agente pode preparar resumo de plantão e rascunho de alta a partir de fatos registrados.
5. Profissional autorizado revisa, assina alta e libera o documento; comunicação externa usa o conteúdo aprovado.

**Negação/erro:** leito inexistente, checklist obrigatório incompleto, medicação sem ordem/lote, paciente não resolvido, conflito de procedimento ou assinatura ausente impede a transição. A falha de provider, fila ou agente não fecha o episódio nem publica a alta.

**Recuperação:** o episódio permanece aberto com pendências visíveis e handoff preservado; uma transferência cria nova versão sem apagar tarefas. Se uma integração ficar incerta, o sistema marca `OUTCOME_UNKNOWN`, bloqueia retry cego e oferece consulta/reconciliação ou registro manual autorizado.

**Resultado observável:** episódio fechado somente quando pendências obrigatórias, medicações e plano de retorno tiverem decisão explícita.

### UC-05 — Estoque, farmácia e consumo

**Ator:** estoque/farmácia e equipe clínica.

1. Receber item com fornecedor, lote, validade, quantidade e custo.
2. Reservar/dispensar item vinculado a prescrição, procedimento ou motivo autorizado.
3. Registrar consumo, devolução, perda, ajuste e transferência como movimentos imutáveis.
4. Alertar validade, ruptura, divergência e item sem prescrição quando aplicável.

**Negação/erro:** o sistema não permite saldo negativo, lote inexistente, lote vencido quando proibido ou dispensação sem autorização; a correção é um novo movimento com motivo e responsável.

**Recuperação:** uma reserva/dispensação interrompida mantém o movimento em estado conhecido (`PENDING_RECONCILIATION` ou `QUARANTINED`) e não libera saldo por suposição. O responsável reconcilia a contagem física e o pedido, desfaz uma reserva idempotentemente ou registra ajuste compensatório aprovado; nenhum retry cria uma segunda administração.

**Resultado observável:** cada movimento tem item, lote, localização, quantidade, ator, motivo, chave idempotente, versão e saldo verificável.

### UC-06 — Orçamento, cobrança e fechamento

**Ator:** financeiro/caixa e administrador autorizado.

1. Derivar orçamento de serviços e itens aprovados, apresentando versão e validade.
2. Registrar autorização do tutor, lançamento, pagamento, estorno ou inadimplência.
3. Conciliar o ledger interno com o provedor de pagamento e reportar divergências.
4. O agente pode explicar um lançamento ou montar rascunho de relatório; não estorna nem concede desconto fora de alçada.

**Negação/erro:** valor sem item/serviço aprovado, versão vencida, pagamento não autenticado, webhook duplicado ou estorno fora da alçada não altera o ledger. Indisponibilidade do provedor deixa o lançamento pendente, sem afirmar pagamento ou estorno concluído.

**Recuperação:** o financeiro consulta o provedor por idempotency key, reconcilia a divergência ou registra `OUTCOME_UNKNOWN` para revisão. Correções são movimentos compensatórios; o sistema não apaga o lançamento original e não altera o prontuário para resolver uma pendência financeira.

**Resultado observável:** cada valor possui origem, moeda, ator, timestamp, idempotency key, estado de liquidação e reconciliação.

### UC-07 — Copiloto e automação governada

**Ator:** qualquer papel autorizado, com o agente correspondente.

1. O usuário abre uma sessão ligada a organização, unidade, workspace e contexto de trabalho.
2. O runtime resolve policy, modelo, budget, tools, memória e fontes permitidas antes do turno.
3. O agente consulta dados mínimos, responde com referências e marca incertezas.
4. Uma tool de escrita, comunicação, prescrição, estoque, cobrança ou integração passa por guard e aprovação contextual.
5. O resultado, a decisão e a aprovação ficam auditáveis; falha ou timeout não é convertida em sucesso.

**Offline na V1:** `OFFLINE_READ_ONLY` permite somente leitura de cache D0–D2 já autorizada por lease finito. Não há rascunho local persistido, sincronizado ou aceito como edição offline; o buffer de composição em memória não constitui rascunho offline. Uma queda breve de rede, sozinha, não descarta o texto: a interface entra em `OFFLINE_READ_ONLY`, bloqueia o composer e conserva o texto não enviado somente em memória enquanto o contexto/sessão de composição continuar válido. Preservação não autoriza exibição: somente D0–D2 classificados e autorizados podem permanecer visíveis; D3–D5, conteúdo não classificado ou sem autorização offline ficam ocultos em quarentena, conforme o [contrato de buffer em 05](05-seguranca-privacidade.md#buffer-de-composição-durante-desconexão). O único gatilho canônico de descarte é `COMPOSER_CONTEXT_LOST`, que ocorre ao recarregar, fechar, sair, expirar ou ser revogada a sessão/lease, ou falhar a revalidação; nesse momento o buffer é apagado e nunca é persistido ou sincronizado. Na reconexão, a sessão e a policy devem ser revalidadas antes de reativar o composer; o usuário revisa e envia explicitamente, sem envio automático. Não se criam privilégios, não se confirma efeito externo e não se oculta divergência de sincronização.

**Recuperação:** falha de policy, budget, credencial, provider, sessão ou tool encerra o turno com motivo e mantém o caminho manual. `OUTCOME_UNKNOWN` bloqueia repetição cega; o operador consulta o recurso, reconcilia ou registra a decisão. Se o log não puder ser persistido conforme a policy, não há novo contexto clínico model-visible.

## 6. Regras de negócio e invariantes

| ID | Regra determinística | Exceção/controlador |
|---|---|---|
| BR-01 | Todo registro pertence a uma organização e, quando aplicável, a unidade, workspace e paciente; ausência de escopo é inválida. | Migração aprovada pode usar estado de quarentena, nunca acesso normal. |
| BR-02 | Uma reserva ocupa um recurso em uma janela e não pode ser confirmada em conflito. | Alteração exige nova versão e ator autorizado. |
| BR-03 | Um registro clínico assinado não é sobrescrito; correção cria adendo ligado ao original. | Direção clínica define o fluxo de retificação. |
| BR-04 | Rascunho gerado por IA não é fato clínico nem comunicação enviada. | Só a confirmação de papel autorizado promove o conteúdo. |
| BR-05 | Prescrição, administração e dispensação são fatos distintos e devem manter autoria, horário e vínculo. | Protocolos do CVG podem adicionar campos obrigatórios. |
| BR-06 | Nenhum movimento de estoque deixa saldo negativo ou perde lote/validade; uma operação que produziria saldo negativo é rejeitada atomicamente. | Ajuste autorizado corrige uma discrepância por movimento compensatório sem criar saldo negativo e exige motivo, alçada e auditoria. |
| BR-07 | Cobrança é um ledger append-only lógico; estorno e correção são movimentos compensatórios. | Política fiscal/financeira do CVG permanece UNKNOWN. |
| BR-08 | A policy mais específica restringe a mais ampla; falta ou corrupção de policy nega a operação governada. | Nunca ampliar por fallback silencioso. |
| BR-09 | Budget é pré-verificado antes do turno e medido por tipo de consumo; atraso de consolidação não concede crédito ilimitado. | Unidade final de cobrança deve ser aprovada. |
| BR-10 | `allowed-once` autoriza somente a primeira nova execução pedida; rejeição, cancelamento ou indisponibilidade negam. Repetição da mesma `idempotencyKey`, localizada pela chave server-scoped de identidade + escopo + tipo de comando, com digest compatível, devolve o resultado já persistido sem nova approval ou dispatch. | Nova chave ou digest divergente exige decisão nova; a role/resource policy e a autorização de leitura do receipt devem passar antes. `actionId` de transporte não define a identidade da repetição. |
| BR-11 | Conteúdo de usuário, documento, e-mail, web ou tool result é dado não confiável, não instrução de autoridade. | Parser e policy podem extrair fatos com proveniência. |
| BR-12 | Toda escrita relevante possui idempotency key e resultado determinístico para repetição segura; resposta perdida não transforma um efeito já persistido em segunda execução. | Operações não idempotentes exigem verificação externa antes de retry; `IN_FLIGHT`/`OUTCOME_UNKNOWN` retorna o mesmo estado e reconcilia. |

## 7. Requisitos funcionais

| ID | Prioridade | Requisito observável |
|---|---|---|
| FR-01 | P0 | O sistema deve autenticar usuários e manter a organização/unidade/workspace no contexto de toda operação. |
| FR-02 | P0 | O sistema deve cadastrar, pesquisar, mesclar com aprovação e desativar tutores e pacientes sem apagar histórico clínico por acidente. |
| FR-03 | P0 | O sistema deve criar, reagendar, cancelar e confirmar reservas sem dupla alocação. |
| FR-04 | P0 | O sistema deve operar check-in, fila, triagem, atribuição e handoff com estados e autoria. |
| FR-05 | P0 | O sistema deve manter prontuário estruturado, anexos, evolução, adendos, assinaturas e linha do tempo. |
| FR-06 | P0 | O sistema deve separar rascunho, revisão, assinatura e publicação de conteúdo clínico. |
| FR-07 | P0 | O sistema deve controlar pedidos, amostras, resultados e revisão de exames. |
| FR-08 | P1 | O sistema deve controlar internação, leitos, procedimentos, checklist, administração e alta. |
| FR-09 | P1 | O sistema deve controlar produtos, lotes, validade, entradas, saídas, transferências, devoluções e inventário. |
| FR-10 | P0 | O sistema deve registrar orçamento, cobrança, pagamento, estorno, conciliação e alçada. |
| FR-11 | P0 | O sistema deve emitir auditoria de acesso, leitura, criação, alteração, aprovação, negação, exportação e exclusão lógica. |
| FR-12 | P0 | O sistema deve aplicar autorização por ator, ação, recurso, estado e condição no servidor, não apenas na interface. |
| FR-13 | P0 | O sistema deve oferecer sessões de IA vinculadas a contexto e escopo, com histórico reconstruível e referências. |
| FR-14 | P0 | O sistema deve registrar catálogo de modelos, tools, skills, MCPs, policies, versões e escopos habilitados. |
| FR-15 | P0 | O sistema deve calcular budget antes e depois de cada turno e separar tokens, mídia, transcrição e integrações. |
| FR-16 | P0 | O sistema deve pedir confirmação contextual para operações classificadas como reversíveis de impacto ou alto impacto. |
| FR-17 | P0 | O sistema deve negar uma operação quando policy, autorização, credencial, sandbox ou approval estiver ausente ou inconsistente. |
| FR-18 | P1 | O sistema deve ingerir conhecimento com origem, versão, classificação, escopo e estado de indexação. |
| FR-19 | P1 | O sistema deve executar automações com agenda, janela, limite, idempotência, retry, cancelamento e relatório. |
| FR-20 | P1 | O sistema deve integrar canais e sistemas externos por credenciais referenciadas, escopo mínimo e revogação. |
| FR-21 | P1 | O sistema deve oferecer relatórios de operação, qualidade, consumo, custo, auditoria e incidentes com filtros de escopo. |
| FR-22 | P0 | O sistema deve preservar registro manual e acesso seguro à operação quando o runtime de IA estiver indisponível. |

## 8. Requisitos não funcionais

Os targets numéricos a seguir são `PROPOSED` e precisam de baseline e aprovação no planejamento.

| ID | Prioridade | Requisito e evidência futura |
|---|---|---|
| NFR-SEC-01 | P0 | Toda tentativa fora do escopo deve resultar em `DENIED` sem revelar existência indevida; validar matriz allow/deny em API e tool. |
| NFR-SEC-02 | P0 | Nenhuma chave de provider chega à superfície cliente; validar pacote, tráfego, logs e erro. |
| NFR-SEC-03 | P0 | Conteúdo externo marcado como não confiável não pode alterar policy, tool allowlist ou autoridade; validar casos de prompt injection. |
| NFR-DATA-01 | P0 | Dados clínicos, pessoais, credenciais e auditoria têm classificação, criptografia, retenção e acesso definidos antes do piloto. |
| NFR-DATA-02 | P0 | Escritas transacionais são atômicas e repetíveis; validar crash/retry/concurrency com fixtures representativas. |
| NFR-AI-01 | P0 | Toda sugestão clínica mostra origem, modelo, versão, timestamp e estado de revisão; validar replay e auditoria. |
| NFR-AI-02 | P0 | Nenhuma tool de alto impacto executa sem policy, role e aprovação válidas; validar ausência de answerer como deny. |
| NFR-REL-01 | P0 | O sistema fornece readiness, health, correlação, métricas e alertas capazes de explicar falhas de provider, DB, fila e integração. |
| NFR-REL-02 | P1 | RTO/RPO, backup, restore e teste de desastre são aprovados antes de produção; targets numéricos permanecem PROPOSED. |
| NFR-PERF-01 | P1 | Registrar p50/p95/p99 por fluxo e workload; metas iniciais são propostas em `06-operacao-qualidade-e-recuperacao.md`. |
| NFR-UX-01 | P1 | Fluxos de recepção, medicação, alerta e assinatura são utilizáveis com teclado, contraste, foco, linguagem clara e estados de erro. |
| NFR-TRACE-01 | P0 | Cada comando de alto impacto liga ator, recurso, policy, aprovação, sessão, request id, resultado e evidência. |
| NFR-COMP-01 | P1 | Mudanças de contrato versionadas mantêm compatibilidade ou têm migração/roll-forward e plano de retorno. |

## 9. Métricas de sucesso

Todas são `PROPOSED` até obter baseline e dono.

| Métrica | Definição | Decisão que orienta |
|---|---|---|
| Tempo de ciclo de recepção | Mediana e p95 entre check-in e atendimento encaminhado por unidade/turno. | Ajustar agenda, fila e staffing. |
| Completude do prontuário | Percentual de atendimentos com campos obrigatórios, autoria e fechamento válidos. | Treinamento, UX e policy. |
| Retrabalho clínico | Adendos/correções atribuídos a dado ausente ou transcrição incorreta. | Limitar automação e melhorar captura. |
| Sugestão aceita com edição | Rascunhos de IA revisados, aceitos, modificados ou rejeitados. | Medir utilidade sem tratar aceitação como verdade clínica. |
| Incidentes de autorização | Negações, bypass tentados, cross-scope e ferramentas bloqueadas. | Reforçar policy e detectar abuso. |
| Divergência de estoque | Diferença entre saldo registrado e contagem por lote/validade. | Ações de inventário e compra. |
| Reconciliação financeira | Valor e quantidade de itens sem conciliação por período. | Parar automações financeiras e investigar. |
| Custo por jornada | Consumo por atendimento, sessão, tool, mídia e provider. | Ajustar budget, modelo e catálogo. |
| Disponibilidade segura | Tempo em que operações críticas manuais continuam disponíveis, separado de disponibilidade da IA. | Priorizar resiliência e fallback. |

## 10. Critérios de aceite do PRD

| ID | Dado | Quando | Então |
|---|---|---|---|
| AC-PRD-01 | Usuário pertence à organização A e não à B | Tenta buscar ou editar paciente de B | A API e a tool negam, não revelam o recurso e registram a tentativa. |
| AC-PRD-02 | Dois atendentes escolhem a mesma janela | Confirmam quase simultaneamente | Uma única reserva é confirmada; a outra recebe conflito sem registro parcial. |
| AC-PRD-03 | Agente produz rascunho de nota | Veterinário não revisou | O conteúdo permanece rascunho e não altera o prontuário assinado nem envia comunicação. |
| AC-PRD-04 | Tool tenta prescrever, dispensar, estornar ou enviar mensagem | Falta role, policy ou approval | A execução é negada e o resultado explícito chega ao usuário/agente. |
| AC-PRD-05 | Policy cache está ausente/corrompido | Agente pede nova tool ou novo privilégio | O dispatch falha fechado; recursos previamente autorizados não são ampliados. |
| AC-PRD-06 | Worker de uso recebe o mesmo evento duas vezes | Consolida consumo | O ledger permanece idempotente e a reconciliação é auditável. |
| AC-PRD-07 | Resultado de exame chega fora de ordem | Resultado não corresponde a pedido/amostra | O item vai para quarentena/erro e não entra como fato clínico válido. |
| AC-PRD-08 | O processo perde a rede brevemente e, em outro cenário, o contexto de composição é encerrado | Usuário tinha texto não enviado no composer | Na queda breve, o sistema entra em `OFFLINE_READ_ONLY`, bloqueia edição/envio, mantém o texto apenas no buffer volátil e não o persiste nem sincroniza. D0–D2 classificados/autorizados podem continuar visíveis; texto clínico D3–D5 ou não classificado fica oculto, inclusive para cópia e acessibilidade. Após reconexão com sessão, recurso, classificação e policy revalidados, permite revisão e envio explícito; conteúdo desconhecido permanece oculto até classificação autorizada. Em `COMPOSER_CONTEXT_LOST` — recarregar, fechar, sair, expirar/revogar a sessão/lease ou falhar a revalidação — apaga o buffer, sem autoenvio. |
| AC-PRD-09 | Documento contém instrução maliciosa | Agente recupera o trecho | O trecho é tratado como conteúdo não confiável e não altera system policy, tools ou autorização. |
| AC-PRD-10 | Operador precisa investigar incidente | Acessa uma sessão clínica | O acesso excepcional tem escopo, motivo, janela, aprovação e trilha; não vira acesso padrão. |
| AC-PRD-11 | Resposta se perde depois de uma execução autorizada | Usuário repete a mesma chave com identidade, escopo, tipo de comando e digest compatíveis, mesmo que a tentativa tenha outro `actionId` | A API localiza o registro pela chave estável, devolve o receipt/resultado persistido, os IDs originais ou o mesmo estado `IN_FLIGHT`/`OUTCOME_UNKNOWN`, sem consumir approval, budget ou dispatch novamente; digest divergente retorna conflito. |
| AC-PRD-12 | Processo cai ou uma dependência nega depois da reivindicação da idempotência | Há concorrência com `unitId`, `workspaceId` ou `resourceId` ausentes e crash imediatamente após o claim | A reivindicação é única; negação/abandono sem intent finaliza `FAILED/PRE_DISPATCH`, enquanto intent ou envio possível vira `OUTCOME_UNKNOWN` para reconciliação, sem dispatch automático duplicado. |

## 11. Gate do produto

O documento alcança `PRODUCT_DEFINED` somente após direção clínica, operação, financeiro, privacidade e segurança confirmarem atores, escopos, regras, retenção, alçadas e critérios de aceite. Até lá, requisitos específicos do CVG permanecem `PROPOSED` ou `UNKNOWN` e não autorizam implementação de produção.
