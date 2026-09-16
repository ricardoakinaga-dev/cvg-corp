# Plano executivo — evolução para Triplo AAA

## Resultado e decisão

Eliminar as falhas de integridade clínica e governança, concluir as jornadas obrigatórias e comprovar a operação do candidato integrado segundo a barra v4. A auditoria resultou em **FAIL para Triplo AAA**, apesar dos avanços locais e das suítes aprovadas. Não há nota numérica nova nem estimativa de percentual pronto.

A entrega tem 17 contratos declarados DONE, 11 PARTIAL e 10 PLANNED, mais 6 filhos planejados. AUD13-21 e AUD13-15 exigem revisão do aceite. O investimento deve preservar os resultados válidos e fechar os limites demonstrados, sem reconstruir o produto.

## Prioridades e entregas executivas

| Prioridade | Resultado observável | Responsabilidade proposta |
|---|---|---|
| 1. Integridade e autoridade | Paciente correto em cada leitura; prescrição terminal não dispensa; uso real contabilizado; revogação impede conclusão autorizada | Domínio clínico, segurança e IA; Lead integra |
| 2. Jornada por usuário real | Farmácia dispensa com permissões próprias; internação sai de PLANNED; exames/anexos/consentimento/financeiro completos | Produto e responsáveis funcionais |
| 3. Persistência e recuperação | Claims recuperáveis, escritas autoritativas, lifecycle e restore útil | Dados e backend |
| 4. Operação demonstrável | Readiness por capacidade, alertas recebidos, workloads reais, CI e staging do mesmo candidato | SRE, integrações e release |
| 5. Julgamento independente | Matriz completa, críticos atuais, participantes humanos e decisão sobre candidato concreto | Qualidade e decisor autorizado |

## Arquitetura e abordagem

Manter o monólito modular, worker separado e portas governadas para IA/efeitos externos. Reforçar o limite HTTP→aplicação→domínio→persistência e o vínculo entre contexto, operação, reserva, receipt e auditoria. Usar migrações graduais por domínio para as 24 coleções ainda primárias em snapshot. Não exigir microsserviços ou reescrita por preferência estética.

Primeiro corrigir segurança/integridade e provar os caminhos; depois completar regras/fluxos, infraestrutura e otimização baseada em perfil. Schemas clínicos/financeiros precisam de decisão explícita quando o PRD não a contém. Identificar a decisão faltante sem bloquear correções já determinadas.

## Capacidade e estimativa

33 contratos não equivalem a 33 sessões. Tarefas M têm estimativa inicial de 1–3 sessões técnicas; tarefas L devem ser decompostas em fatias com demonstração própria antes de receber prazo. Usar sessões de 2–4 horas apenas como unidade de planejamento, não garantia de produtividade ou custo.

Equipe sugerida, conforme capacidade do host: Lead, até dois builders e um crítico. Reservar capacidade explícita para integração, revisão e retrabalho. Medir tempo e taxa de retrabalho após AAA2-02/03/06 e reestimar o caminho crítico. Não prometer data de AAA antes de confirmar ambientes e participantes externos.

## Gates de investimento

- R0: estado reconciliado e provas reproduzíveis; sem duplicação de tarefa ou hash cosmeticamente ajustado.
- R1: casos E01–E09/E12 relevantes corrigidos e reprováveis por testes negativos.
- R2: jornadas completas e invariantes no banco; contratos de runbook/carga discriminam execução real.
- R3: candidato integrado com serviços externos autorizados e provas observáveis.
- R4: uso, adversidade e recuperação executados sobre o candidato.
- R5: dossiê, Gauntlet e decisão humana conforme barra, com promoção somente autorizada.

## Riscos e decisões externas

| Risco | Tratamento |
|---|---|
| Testes verdes ocultarem erro clínico | Regressões de troca de paciente, transições terminais, personas e contratos de exame |
| Budget local aparentar governança durável | Falhas entre reserva/dispatch/settle, overage real e hold obrigatório |
| Migração disputar duas fontes | Ownership explícito, CAS/RLS/backfill e forward-fix por domínio |
| Sucesso histórico ser reutilizado no candidato errado | Manifesto de worktree e bundle vinculado a SHA/digest; invalidação após mudança |
| Serviços externos indisponíveis | Preparar contratos locais e registrar dependência exata; continuar frentes independentes |
| Critérios serem reduzidos para encerrar | Barra v4 congelada, revisão independente e ausência de evidência como ausência |

Provider/destinatário, modelo/custo, secret authority, storage/retention, staging, carga/ataque, participantes assistivos e promoção exigem autoridade aplicável. Autorizações explícitas válidas persistem; não pedir novamente por convenção documental. Preparação local é distinta da execução externa.

## Retomada e conclusão

O plano novo é um delta do programa anterior, não uma segunda execução. AAA2-01 associa cada critério à tarefa existente ou cria filho justificado. Preservar o histórico e o trabalho concorrente. Atualizar o estado canônico apenas quando a implementação for iniciada.

Concluir exige todos os achados resolvidos, cobertura funcional e não funcional comprovada, gates atuais e decisão humana real. Se houver dependência externa, entregar candidato local com limites explícitos; não declarar Triplo AAA. A meta não é uma nota arbitrária: é cumprir a barra com evidência válida.
