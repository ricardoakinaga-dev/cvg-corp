# Backlog da rodada AAA3

12 contratos focados; todos os 33 contratos AAA2 continuam obrigatórios via [continuidade](continuidade-aaa2.md). Escopo e aceites herdados não são substituídos por estes resumos. A correção E01 local é preservada. Estado de execução permanece somente em `.agent/backlog.json`.

| ID | Entrega | Dependências da rodada | Herança |
|---|---|---|---|
| AAA3-01 | Reparar retomada e limitar bloqueios à fatia dependente | — | AAA2-01 |
| AAA3-02 | Validar estado semântico além do catálogo | AAA3-01 | AAA2-10 |
| AAA3-03 | Corrigir uso real e hold de orçamento | AAA3-01 | AAA2-03 |
| AAA3-04 | Isolar prontuário e carregar histórico completo | AAA3-01 | AAA2-06 |
| AAA3-05 | Revalidar autoridade ao concluir IA | AAA3-01 | AAA2-05 |
| AAA3-06 | Durabilizar budget obrigatório do ACP | AAA3-03, AAA3-05 | AAA2-04 |
| AAA3-07 | Concluir dispensação acessível ao perfil estoque | AAA3-01 | AAA2-07 |
| AAA3-08 | Concluir atribuição de leito de episódio planejado | AAA3-01 | AAA2-08 |
| AAA3-09 | Comprovar medicação e claims em PostgreSQL multiprocesso | AAA3-01 | AAA2-02, AAA2-11 |
| AAA3-10 | Preparar decisão D-02 para aceite clínico | AAA3-01 | AAA2-14 |
| AAA3-11 | Vincular logs brutos ao candidato e ao julgamento | AAA3-02 | AAA2-10, AAA2-31 |
| AAA3-12 | Fechar rodada local e seguir todo o programa residual | AAA3-01, AAA3-02, AAA3-03, AAA3-04, AAA3-05, AAA3-06, AAA3-07, AAA3-08, AAA3-09, AAA3-10, AAA3-11 | AAA2-31 |

## AAA3-01 — Reparar retomada e limitar bloqueios à fatia dependente

**Prioridade:** P1. **Dono:** Lead. **Superfície máxima:** `.agent/`, `docs/`.

Aceite:

- Primeiro passo executável coincide com ação ativa; histórico fica em Progress
- Parent/child não gera espera circular de conclusão
- D-02 bloqueia somente aceites clínicos dependentes; selecionar tarefa local pronta por risco
- Não reabrir aceite temporal histórico nem promover AUD13-16 por reparar estado

Verificação:

- Probe C01–C03 deve passar após correção
- Fixture scheduler com pai parcial e decisão ausente/presente
- git diff --check

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-02 — Validar estado semântico além do catálogo

**Prioridade:** P1. **Dono:** Lead. **Superfície máxima:** `scripts/`, `tests/`, `docs/`.

Aceite:

- Verificador diferencia catálogo/execução/histórico
- Detectar primeiro passo stale mesmo com comentário correto
- Detectar ciclo de conclusão pai-filho e WAIT indevido quando existe tarefa pronta
- Um check não gera verificação recursiva interminável de seu próprio append

Verificação:

- Casos negativos: marker correto/step errado; filho exige pai que depende do filho; tarefa independente pronta
- Caso bom com decisão legítima bloqueando só um filho

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-03 — Corrigir uso real e hold de orçamento

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `packages/domain/`, `packages/persistence/`, `packages/harness/`, `tests/`.

Aceite:

- Herdar integralmente AAA2-03
- Uso900 não vira100; excedente/late/unknown impedem nova despesa indevida
- Caps sintéticos explícitos permitem correção local sem inventar D-04
- Concorrência e settlement têm ledger e reconciliação verificáveis

Verificação:

- Reproduzir probe IA e inverter assertions
- npm test
- Teste PostgreSQL efêmero na fatia persistente

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-04 — Isolar prontuário e carregar histórico completo

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `apps/web/src/features/clinical/`, `apps/web/src/api/`, `tests/e2e/`.

Aceite:

- Herdar AAA2-06
- Troca A/B e resposta fora de ordem nunca mostram adendo de outro paciente
- Todos documentos corrigidos aparecem após reload; erro não vira vazio silencioso

Verificação:

- Browser do componente e UI→API com dois pacientes/dois documentos
- Regressão de erro/loading/troca de contexto

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-05 — Revalidar autoridade ao concluir IA

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `packages/harness-adapters/`, `apps/api/src/application/`, `packages/agent-policy/`, `tests/`.

Aceite:

- Herdar AAA2-05
- Revogação impede COMPLETED autorizado/draft/disclosure e preserva uso
- Sessão/revisão de policy/recurso atuais verificados antes do efeito e retorno

Verificação:

- Probe residual com revogação durante await
- Teste negativo na aplicação e regressão de aprovação válida

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-06 — Durabilizar budget obrigatório do ACP

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `packages/harness-adapters/`, `packages/deepseek-bridge/`, `packages/persistence/`, `apps/deepseek-bridge/`, `tests/`.

Aceite:

- Herdar AAA2-04
- Sem budget não admite dispatch
- Recriação/restart não perde vínculo de reserva e não marca SETTLED sem settle
- Reserva/efeito/usage/receipt têm identidade estável e recovery

Verificação:

- Probe sem budget e após recriação
- Falhas entre reserva, dispatch e commit; multiprocesso na fatia persistente

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-07 — Concluir dispensação acessível ao perfil estoque

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `apps/web/src/features/stock/`, `apps/web/src/features/hospital/`, `apps/api/src/application/`, `tests/`.

Aceite:

- Herdar AAA2-07 e preservar E01 corrigido
- Farmácia dispensa sem buscar prontuários/leitos proibidos
- Receipt e negativa sem ampliar permissão clínica

Verificação:

- Browser autenticado como estoque; API local
- Ativa versus terminal; conflito, replay e saldo

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-08 — Concluir atribuição de leito de episódio planejado

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `apps/web/src/features/hospital/`, `apps/api/`, `packages/domain/`, `packages/persistence/`, `tests/`.

Aceite:

- Herdar AAA2-08
- Episódio sem leito retoma mantendo identidade/histórico
- Concorrência pelo leito nega segundo ator atomicamente
- Preparar fluxo técnico sem inventar regra D-02; aceite clínico dependente permanece explícito

Verificação:

- PLANNED→atribuição→ADMITTED no mesmo episódio
- Conflito/retry e teste do gate clínico configurado

**Autoridade/disponibilidade:** Somente regras clínicas ainda indefinidas dependem de D-02; a fatia técnica já especificada pode avançar

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-09 — Comprovar medicação e claims em PostgreSQL multiprocesso

**Prioridade:** P1. **Dono:** Builder especializado; integração pelo Lead. **Superfície máxima:** `packages/persistence/`, `apps/api/src/application/`, `db/migrations/`, `tests/`, `scripts/`.

Aceite:

- Preservar E01 local; encerrar somente a lacuna de prova persistente quando executada
- Duas instâncias disputam dispensação/status/estoque com uma ordem linearizável
- Replay após commit e perda de resposta não duplica movimento/receipt
- Não copiar limitação como nova falha do domínio

Verificação:

- Preparar banco efêmero isolado e migrations001–037
- Corrida de duas chaves, mesma chave, status terminal e crash/restart
- Conferir tabelas/receipts após reinício

**Autoridade/disponibilidade:** Disponibilidade de PostgreSQL local isolado; preparar harness se runtime indisponível

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-10 — Preparar decisão D-02 para aceite clínico

**Prioridade:** P1. **Dono:** Lead. **Superfície máxima:** `docs/adr/`, `docs/rodada-aaa3-2026-09-13/`.

Aceite:

- Preparar pacote com campos/regra pendente, alternativas e consequências
- Separar contrato técnico conhecido de decisão clínica não feita
- Dono clínico recebe material concreto; registrar resposta somente quando ocorrer
- Preparação concluída não significa D-02 aprovada nem filho implementado

Verificação:

- Revisão contra PRD/ADR031 e matriz de impacto
- Vincular decisão aos critérios exatos de16A/14

**Autoridade/disponibilidade:** Decisão clínica real é necessária para o aceite dependente, não para preparar o pacote

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-11 — Vincular logs brutos ao candidato e ao julgamento

**Prioridade:** P2. **Dono:** Lead. **Superfície máxima:** `scripts/`, `docs/`, `artifacts/`, `.agent/`.

Aceite:

- Logs sanitizados por comando com exit/tempo/candidato/contrato
- Separar inspeção I1 de execução independente e não inventar evidência histórica
- Preservar limites aceitos; bundle externo só quando exigido para promoção
- Testes sem mutação seguem log verificável; hashes sozinhos não provam resultado

Verificação:

- Mutação de log/candidato invalida admissão
- Consultar receipts sem depender de /tmp de sessão antiga

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.

## AAA3-12 — Fechar rodada local e seguir todo o programa residual

**Prioridade:** P1. **Dono:** Lead. **Superfície máxima:** `docs/`, `.agent/`, `artifacts/`.

Aceite:

- Todos critérios locais da rodada satisfeitos ou impedimento concreto registrado sem PASS indevido
- Produzir matriz dos 33 contratos AAA2 preservando cada requisito e próximo gate
- Selecionar próxima tarefa executável; não parar globalmente por um bloqueio isolado
- Não executar AAA2-32 nem declarar AAA sem todos requisitos e autoridade

Verificação:

- Validação de contratos, fontes, evidências e estado
- Crítico fresco do candidato imóvel
- Regressão pertinente e passagem para remanescentes

**Autoridade/disponibilidade:** Nenhuma dependência humana adicional para a fatia local já especificada.

**Evidência:** comando, tempo, exit, seed, candidato/contrato, log bruto sanitizado e crítica com limites explícitos.

**Recuperação:** Preservar trabalho alheio; corrigir estado por registro datado sem apagar história; reverter somente delta próprio não aplicado; migrations aplicadas usam forward-fix; efeitos incertos exigem reconciliação.
