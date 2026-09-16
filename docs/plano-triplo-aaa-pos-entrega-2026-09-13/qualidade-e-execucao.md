# Contrato de execução e qualidade

## Autoridade e estado

Este plano autoriza planejamento; a futura instrução de implementação define a autorização executiva. O PRD e os contratos continuam sendo fontes de comportamento. A barra v4 permanece inalterada. Os aceites do [catálogo AUD13](../plano-melhorias-2026-09-13/backlog.json) são herdados através da [rastreabilidade](rastreabilidade.md), sem redução silenciosa.

`.agent/backlog.json` é o único dono de status; `.agent/state.json` mantém ponteiros; o ExecPlan ativo em `.agent/plans/` mantém a narrativa. AAA2-01 associa contratos, reabre apenas aceites contraditos e cria filhos quando necessário. Preservar histórico; não duplicar IDs/status. Este pacote não altera o estado ativo nem implementa produto.

## Preparação por tarefa

Ler contrato e dependências, reproduzir o comportamento, reservar arquivos exatos e recursos antes de RUNNING. Paths são teto de superfície. Novos arquivos/migrations/portas/banco/filas devem ser nomeados na reserva. Integrador resolve conflitos em API, sessão, shared UI, domínio, persistência e lockfile; dois worktrees não tornam concorrência semântica segura.

Dividir tarefas L em fatias verticais sem reduzir o aceite do pai. Builder retorna implementação/evidências; crítico fresco julga, não edita nem cria descendentes. Adapte paralelismo ao limite real do host. Se revisão independente não estiver disponível, registre a limitação; não invente aprovação.

## Verificação e evidência

Reproduzir antes, implementar, testar o boundary correto, revisar, corrigir e integrar. Use browser para contexto/foco/persona, API e banco para transações, múltiplos processos para claim/fence, serviços reais autorizados para integrações e operador/relógio para recovery.

Os probes da auditoria demonstram defeitos e podem terminar com exit0 mesmo quando imprimem comportamento incorreto. Convertê-los em testes de regressão exige assertions do comportamento correto. Não tratá-los como testes de aceite verdes.

Registrar comando, início/fim/exit, versões, dataset, candidato (SHA mais delta quando dirty), hash do contrato, log/receipt/screenshot sanitizado. PASS/FAIL/NOT_RUN/BLOCKED/STALE/INVALID são distintos. Preservar tentativas inválidas e explicar a causa; não reexecutar até verde sem hipótese.

A matriz atual de 76 testes de browser passou em dois projetos Chromium, mas perdeu os casos adversariais de adendo. Cobertura deve crescer por invariantes e personas; quantidade não substitui suficiência. Build passou com alerta de chunk: medir impacto antes de refatorar e não aumentar limiar apenas para apagar aviso.

## Ambientes e aprovação

Usar dados sintéticos e ambientes isolados. Não consumir credenciais, gerar custo, contatar destinatários, afetar finanças ou promover produção sem autoridade aplicável. Autorizações explícitas válidas da sessão prevalecem sobre convenções históricas que peçam reconfirmação automática. Perguntar somente pela decisão/recurso faltante que impeça a ação dependente, após preparar a entrega concreta.

Falta externa bloqueia a fatia dependente. Contratos, testes locais e tarefas independentes continuam. Nunca converter preparação de recursos em prova operacional, fixture em provider real ou evidência arquivada em Git em bundle externo de promoção.

## Conclusão e recuperação

Preservar a barra: Overall≥97, limiares individuais, 39 fases, 25 gates, 22 dimensões e requisitos de assinatura/revisão/humanos. Scores8.x de gates locais não satisfazem esses critérios.31 consolida candidato técnico;32 exige decisão humana real e promoção separadamente autorizada.

Ao interromper, registrar tarefa, candidato, resultados, recursos, efeitos incertos e próxima ação singular. Reverter somente delta próprio não aplicado; usar forward-fix em migrations aplicadas e reconciliar efeitos antes de retry. Nunca limpar trabalho alheio. A conclusão integral só existe com implementação e evidência de todos os requisitos obrigatórios.
