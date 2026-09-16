# Plano executivo — melhorias da auditoria de 13/09/2026

**Entrega atual: planejamento. Execução do produto: não iniciada por este pedido.** Este programa converte os 15 achados H e 6 achados M do [relatório](../auditoria-2026-09-13.md) em resultados verificáveis, preservando o código e o planejamento preexistentes.

## Resultado esperado

Entregar jornadas clínicas, administrativas e de IA que concluam operações reais e apresentem resultados corretos, com autorização, transações, recuperação e evidência operacional. Corrigir as falhas identificadas e comprovar o resultado do candidato integrado. A nota atual de 59/100 é uma baseline consultiva; não é meta, percentual de implementação ou índice comparável automaticamente à auditoria anterior.

## Contexto e arquitetura

O worktree observado está baseado em `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`, com modificações locais em contratos, ADRs e estado. ADR029 mapeia fronteiras; ADR030 prepara novos contratos de sessão/saldo. As duas não equivalem à adoção completa. Existem 329 testes aprovados/1skip no snapshot auditado, build limpo aprovado, static reprovado e defeitos de interface reproduzidos. Esses dados são históricos a partir de qualquer mudança posterior: AUD13-01 deve revalidá-los.

Preservar o monólito modular e o fluxo HTTP→aplicação→PDP/domínio→persistência; worker separado e runtime IA acessando o domínio por portas governadas. O objetivo é completar boundaries e jornadas, reduzir uso operacional primário de snapshot e provar as invariantes. Não há proposta de reescrita geral ou microsserviços por estética.

## Prioridades executivas

| Resultado | Entrega verificável | Dono de decisão proposto |
|---|---|---|
| Confiança imediata | Logout honesto, MFA concluível, saldo correto, toast estável e contexto verdadeiro | Produto/segurança/financeiro; Lead integra |
| Evidência confiável | Instalação, fixtures e gates reproduzíveis, sem dependência acidental do dirty tree | Qualidade/release |
| Jornadas completas | FR01–22 com UI→API→policy→commit→receipt, sucesso/negação/recuperação | Responsáveis funcionais + domínio |
| Integridade sob concorrência | Escrita autoritativa, claim recuperável, RLS e lifecycle comprovados | Dados/segurança |
| IA governada de fato | Registry, budget e governance duráveis; modelo/provider real com limites e receipts | IA/integrações |
| Operação recuperável | Telemetria limitada, alertas recebidos, carga/chaos, restore útil e RTO/RPO medidos | SRE/operador independente |
| Candidato defensável | Mesmo SHA/digest em CI/staging/provas, críticos atuais e decisão humana real | Release + decisor autorizado |

## Investimento e capacidade

Usar marcos demonstráveis, não datas artificiais. Cada tarefa M representa inicialmente 1–3 sessões técnicas; cada L,3–6 sessões, com duração orientativa de 2–4h por sessão. São estimativas de decomposição, não promessa de prazo, custo ou autonomia total. Refinar tarefas L em fatias verticais antes da execução, sem eliminar seus critérios.

Equipe sugerida por janela: Lead/integrador, até 2 builders e 1 crítico; máximo 4 slots quando o ambiente permitir. Reservar 25% da capacidade para integração/revisão e 20–30% de contingência de implementação. Não dividir esforço total pelo número de agentes: contratos, persistência, sessões, DB e staging são recursos serializados. Medir throughput/retrabalho nas primeiras tarefas e então estimar o caminho crítico e prazos reais.

Custos externos de modelo/provider, infraestrutura, carga e retenção não foram autorizados por este planejamento. AUD13-26 identifica disponibilidade, donos e tetos; ausência de serviço bloqueia a parte dependente, enquanto contratos/código/fixtures locais continuam avançando.

## Gates de saída

1. **M0 — Base executável:** plano reconciliado, dependências e fixtures isoladas, inventário funcional, ambientes identificados. Recursos externos podem continuar pendentes sem impedir trabalho local.
2. **M1 — Confiança recuperada:** reproduções de logout/MFA/saldo/toast exigem o comportamento correto; hashing/telemetria/readiness e gates corrigidos; nenhum sucesso falso nos cenários locais exercitados.
3. **M2 — Produto funcional:** jornadas documentadas concluíveis, contratos adotados, catálogo/budget/idempotência e fontes autoritativas verificadas em banco efêmero.
4. **M3 — Operação integrada:** runtime/provider/secrets, worker, alertas, staging e recuperação integrados; extrações justificadas por fronteira/perfil, sem regressão.
5. **M4 — Adversidade e uso:** carga/chaos/red-team/restore/assistividade e usuários reais de teste comprovam os critérios; falhas corrigidas e reexecutadas.
6. **M5 — Julgamento do candidato:** dossiê, críticos e gates técnicos atuais; aprovação humana separada e produção apenas se autorizada.

DAG e demonstrações detalhadas: [roadmap](roadmap.md). Contratos executáveis: [backlog](backlog.md) e [JSON](backlog.json). Metas e evidência: [qualidade e execução](qualidade-e-execucao.md).

## Decisões e riscos

| Risco/decisão | Controle e ação |
|---|---|
| Corrigir apenas UI e deixar semântica errada | AUD13-04/09/18 ligam payload, domínio, ledger e receipt; estorno desconhecido fica explícito até decisão financeira |
| Bloquear correções esperando todas decisões clínicas | AUD13-11 separa regras já definidas de ambiguidades; PAID/logout/toast não dependem de inventar regra clínica |
| Nova sessão duplicar efeito por lookup divergente | AUD13-22 reconcilia docs 04/ADR019 e testa replay após re-login antes de migrar lookup |
| Múltiplos agentes alterarem persistência/API simultaneamente | Reserva exclusiva por tarefa; worktree não substitui sequenciamento de contratos/migrations |
| Confundir fixture com operação real | Separar LOCAL, REAL_TEST e PROMOTION; hashes e receipts vinculados ao sujeito |
| Stack existente sem entregabilidade real | AUD13-26/31/34 provam configuração renderizada, alerta e smoke/restart no artefato executado |
| Dados/credenciais reais tratados sem autoridade | Referências fora de docs, ambientes sintéticos e confirmação apenas para decisão/ação ainda não autorizada |
| Plano antigo e novo criarem dois status | AUD13-01 mescla critérios por legacy_tasks; estado singular em `.agent/backlog.json` |
| Planejamento distante virar implementação superficial | Refinar L em fatias antes de iniciar, mantendo todos aceites e relações com FR/NFR |

## Progresso e retomada

Em 13/09/2026, foram arquivados o relatório/evidências e criado este catálogo de 38 tarefas. Nenhuma tarefa de melhoria foi marcada concluída por esta entrega. O estado de execução preexistente permanece preservado; o primeiro agente deve reconciliá-lo, sem assumir que suas notas ou próximos passos já satisfazem a auditoria atual.

Próxima ação da futura implementação: **AUD13-01 — ler o estado ativo, verificar o worktree, relacionar os contratos legados aos novos critérios e escolher a primeira tarefa pronta com ownership exato**. Depois, iniciar frentes locais independentes de base/defeitos, sem esperar o ambiente externo.

A conclusão do planejamento é a existência de contratos, DAG e rastreabilidade validados. A conclusão do programa exige melhorias implementadas e verificadas. Enquanto a barra integral não for satisfeita, o produto permanece AAA_NOT_PROVEN, independentemente de progresso parcial ou notas locais.
