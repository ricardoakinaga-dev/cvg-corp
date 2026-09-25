# Roadmap de melhorias — CVG-AUD21

> **SUPERSEDED em 2026-09-20:** este plano é histórico. A auditoria de `CVG-AUD21-013` encontrou contraprovas abertas; a retomada corrente está no [roadmap CVG-AUD22](roadmap-melhorias-cvg-aud22-2026-09-20.md).

**Data-base:** 2026-09-20
**Origem:** [reauditoria do resultado CVG-AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md)
**Backlog:** [catálogo CVG-AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md)
**Estado inicial:** `FAIL / REJECT / AAA_NOT_PROVEN`

## Objetivo

Converter o worktree AUD20 em um candidato local coerente e reproduzível, fechando primeiro as contraprovas P0, depois as lacunas de recuperação, frontend e operação. Somente então congelar os bytes, executar a qualificação local duas vezes e buscar as autoridades externas e humana.

O programa preserva migrations 042/043, manifesto 043, correções de busca e contratos já válidos. `REOPEN` significa corrigir o residual comprovado; não significa descartar o trabalho anterior.

## Sequência crítica

```text
R0 contenção append-only e higiene
  ├─ R1 invariantes P0 backend/worker
  ├─ R2 contratos e resiliência frontend ─→ R4a toolchain/qualidade web
  ├─ R3 banco, TTL, recovery e crash matrix
  ├─ R4b alertas e logs locais
  └─ R5a manifesto, exits e verificador do control plane
          ↓ convergência
R5b reconciliar, vincular receipts e congelar candidato
          ↓
R6 qualificação local 2× no mesmo fingerprint
          ↓
R7 evidência externa same-candidate
          ↓
R8 críticos finais técnicos
          ↓
R9 decisão humana
```

R1, R2, R3, R4b e a fundação R5a podem avançar em paralelo depois da contenção; R4a depende das correções web de R2. R5b só ocorre após a convergência de R1–R4 e R5a. Implementação e testes intermediários são permitidos antes de R5b, mas nenhum item fica `DONE` sem receipt exact-subject emitido após essa convergência.

## R0 — Contenção, reconciliação e higiene

**Prioridade:** imediata
**Saída:** nenhum `DONE` falso controla execução ou promoção.

- Registrar por eventos append-only a reabertura de 001, 002, 006, 007, 009, 012 e 013.
- Corrigir os ponteiros state/backlog/ExecPlan/checkpoint/event/evidence sem reescrever o histórico.
- Remover trailing whitespace e tornar `git diff --check` gate obrigatório.
- Manter `AAA_NOT_PROVEN` e promoção bloqueada enquanto qualquer P0/P1 local estiver aberto.

**Gate:** control plane coerente por inspeção explícita, sem declarar que o verificador atual já prova o contrato completo.

## R1 — Invariantes P0 de sessão, identidade, PDP e efeitos

**Prioridade:** imediata
**Saída:** as quatro contraprovas backend falham fechado.

- Exigir `ACTIVE` em acquire/renew/release/turn/checkpoint/complete conforme a matriz de transições.
- Criar autoridade de restore separada do runtime e do owner genérico, com procedure transacional e auditoria.
- Definir precedência semântica para IDs e retornar `DIVERGENT` para qualquer combinação contraditória antes de `NOT_FOUND` observável.
- Substituir heurística de wrappers PDP por uma fronteira estrutural que só aceite chamadas síncronas comprovadas; callbacks desconhecidos falham fechado.
- Propagar o sinal do `runCycle()` ao relay e revalidar abort/fence depois do provider e antes de outcome/ack.

**Gate:** known-bads terminal-renew, Promise microtask, abort-during-deliver e matriz completa de IDs rejeitados em memory e PostgreSQL quando aplicável.

## R2 — Contratos e resiliência frontend

**Prioridade:** imediata
**Saída:** nenhuma resposta inválida chega aos componentes e as rotas primárias não caem.

- Derivar schemas de resposta dos contratos canônicos, com `.strict()`, UUID, enums, timestamps, inteiros, centavos, versões e relações aninhadas.
- Modelar todos os campos consumidos; proibir que parsing remova dados necessários como `createdAt`.
- Adicionar regressão da rota Conhecimento em Chromium+Firefox e property/fixture tests por família.
- Completar o aceite da busca com component test sob `StrictMode`, unmount, erro, abort e resposta invertida.
- Trocar inventário regex por catálogo tipado/AST e mutantes para rota/verbo/placeholder/duplicata.
- Ligar o error boundary a telemetria redigida e correlation ID do evento de erro, com foco, teclado, axe e recuperação.

**Gate:** jornada axe primária verde nos dois engines locais, zero known-bad semântico aceito e boundary com evento correlacionado.

## R3 — Banco, TTL, workers e recovery

**Prioridade:** alta
**Saída:** concorrência e recuperação provadas sem tempo de parede frágil ou mocks que substituam crash.

- Remover TTL de 80 ms; controlar relógio/borda no banco e executar 20 repetições com dois pools e owners.
- Consolidar matriz fence stale/future/historical, terminalidade, tenant, clean install, upgrade e privilégios futuros sem grants de teste fora das migrations.
- Executar crash real antes/depois do efeito, antes/depois do commit/ack, restart de processo/container, lease loss, poison retryable, duplicidade e outcome unknown.
- Recalcular digest semântico de checkpoints e validar FKs lógicas, sequências, tenants, fences e `session.checkpointDigest` no bundle.
- Requalificar migrations 042/043 e readiness N-2/N-1/N depois das correções.

**Gate:** corpus adulterado rejeitado atomicamente; matriz PostgreSQL e worker passa duas vezes sem flake.

## R4 — Qualidade web e observabilidade local

**Prioridade:** alta; R4a depende de R2, R4b depende apenas de R0
**Saída:** falhas detectáveis antes da qualificação e observáveis após runtime.

**R4a — toolchain e qualidade web**

- Adotar ESLint TypeScript, React Hooks e jsx-a11y com known-bads.
- Implementar route-level code splitting, budgets JS/CSS e Lighthouse/CWV executável.
- Derivar contraste de tokens/componentes renderizados.

**R4b — alertas e logs locais**

- Executar Prometheus→Alertmanager→receiver sintético para `firing` e `resolved`, inclusive indisponibilidade.
- Persistir logs com health, retenção, consulta por correlação, acesso auditado e restart survival.
- Redigir por classificação e padrão de valor, com corpus de e-mail, bearer, chaves e segredos sob nomes benignos.

**Gate:** gates negativos falham; alert drill e log drill geram transcripts vinculáveis ao candidato.

## R5 — Identidade do candidato e control plane forte

**Prioridade:** P0; fundação em paralelo após R0 e integração final após R1–R4
**Saída:** cada claim nomeia exatamente os bytes e o estado que prova.

- Criar manifesto canônico para commit, tracked diff, untracked relevante, lockfile, configuração e hashes.
- Separar saída informativa de gate; `BLOCKED_EXTERNAL` retorna código não zero documentado antes de escrever.
- Armazenar evidência externa fora da árvore de source.
- Expandir `verify:control-plane` para conteúdo do ExecPlan, checkpoints, last event, current evidence, fingerprint, transições, refs e timestamps de state/backlog.
- Adicionar unit tests com um known-bad para cada relação, integrar o gate à CI e invalidar receipts quando qualquer byte relevante muda.
- Depois da convergência com R1–R4, reconciliar os ponteiros, emitir receipts current e congelar o candidato que entra em R6.

**Gate:** todas as mutações artificiais são rejeitadas; checkout limpo reproduz o mesmo manifesto.

## R6 — Qualificação local congelada

**Prioridade:** após R1–R5
**Saída:** candidato local único, sem retries e sem drift.

- Congelar fingerprint e executar duas rodadas idênticas de typecheck, ESLint, testes, build/budgets, PDP, segurança, contratos, browser, PostgreSQL, worker, recovery, alertas, logs, diff e proveniência.
- Proibir escrita de gates no source e comparar fingerprint entre cada etapa.
- Exigir zero P0/P1 local aberto e receipts por gate com stdout/stderr, exit, ambiente, início/fim e hashes.

**Gate:** `CVG-AUD21-022` em `DONE` somente após as duas rodadas no mesmo objeto.

## R7 — Evidência externa same-candidate

**Prioridade:** dependência externa
**Saída:** preencher os hard blockers da barra sem converter ausência em pass.

- Staging, DeepSeek/provider reais autorizados, secret authority e observabilidade real.
- Browser completo, WebKit, AT e zoom.
- Carga production-like, chaos infra, recovery gerenciado, backup, RTO/RPO.
- CI, SBOM, imagens, scans, provenance e container smoke no mesmo candidato de R6.

**Gate:** receipts externos verificáveis fora do source; ausência permanece `BLOCKED_EXTERNAL`.

## R8 — Red teams e crítica final técnica

**Prioridade:** final
**Saída:** decisão verificável, não autoatribuída.

- Executar F23 segurança e F24 banco em relatórios independentes.
- Executar crítica fresca dos gates técnicos F0–F37 com barra congelada, objeto imutável e mutation sentinel.
- Corrigir achados e repetir enquanto houver alto/crítico.
- Fechar `CVG-AUD21-027` somente com 38/38 fases técnicas F0–F37 em `PASS`.

**Gate:** `CVG-AUD21-027` em `DONE`, com 38/38 fases técnicas F0–F37 em `PASS` e nenhum achado alto/crítico aberto.

## R9 — Decisão humana

**Prioridade:** final, após R8
**Saída:** decisão verificável, não autoatribuída.

- Solicitar a autoridade humana nomeada para F38 somente depois do fechamento técnico.
- Vincular a atestação ao mesmo candidato imutável qualificado em R6–R8.

**Gate final:** `CVG-AUD21-028` valida F38; somente após a atestação humana criptográfica podem existir 39/39 fases em `PASS`, thresholds atendidos e zero hard blocker.

## Marcos e ordem sugerida

| Marco | Tarefas | Critério de saída |
|---|---|---|
| M0 contenção | 001, 021 | Histórico preservado, ponteiros coerentes, diff limpo. |
| M1 P0 runtime | 002–005 | Quatro contraprovas backend fechadas. |
| M2 frontend seguro | 006–009 | Schemas canônicos, rota Knowledge e boundary verdes. |
| M3 dados/recovery | 010–014 | PostgreSQL/worker/recovery determinísticos. |
| M4 qualidade/ops | 015–017 | Toolchain, alertas e logs executáveis. |
| M5 evidência | 018–020 | Manifesto, exits e control plane robustos. |
| M6 qualificação local | 022 | Duas rodadas same-fingerprint. |
| M7 externo | 023–026 | Autoridades externas same-candidate. |
| M8 encerramento | 027 | Red teams e 38/38 fases técnicas F0–F37. |
| M9 decisão humana | 028 | F38 atestado e, se aprovado, fechamento global 39/39. |

## Regra de parada

Interromper promoção imediatamente se houver contraprova P0, fingerprint mutado, receipt sem subject exato, gate com exit semântico incorreto, fase `NOT_RUN`, crítico alto/critical ou ausência de autoridade externa/humana. O resultado correto nesses casos é `FAIL_WITH_LIMITATIONS` ou o bloqueio específico, nunca `PASS`.
