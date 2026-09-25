# Roadmap executivo de melhorias CVG-AUD27

**Origem:** reauditoria técnica da entrega CVG-AUD26
**Estado inicial:** `PROMOTION_BLOCKED — AAA_NOT_PROVEN`
**Nota inicial:** 69/100 técnica; 40/100 de prontidão para produção
**Modelo de execução:** fases com gates; nenhum marco é encerrado por prazo ou por porcentagem de tarefas
**Backlog normativo:** [backlog-melhorias-cvg-aud27-2026-09-21.md](./backlog-melhorias-cvg-aud27-2026-09-21.md)

## 1. Objetivo executivo

Transformar a entrega AUD26, hoje tecnicamente promissora mas não qualificável, em um candidato:

- semanticamente rastreável do achado à evidência;
- versionado, limpo, reproduzível e imutável;
- sem contratos de resposta genéricos nas rotas catalogadas;
- sem snapshots como persistência primária de domínio;
- qualificado em container, supply chain, browsers e acessibilidade;
- observado e exercitado em staging com carga, falhas e recuperação;
- revisado duas vezes de modo independente no mesmo fingerprint;
- apto a receber decisão humana de promoção.

O objetivo não é elevar artificialmente a contagem de `DONE`. O objetivo é tornar cada decisão reproduzível e falsificável.

## 2. Princípios de execução

1. **Histórico append-only:** erros de status e mapeamento são corrigidos por novos eventos; evidências antigas não são reescritas.
2. **Um candidato, um fingerprint:** qualquer alteração abrangida pelo subject manifest invalida a qualificação anterior.
3. **Evidência focal antes do status:** `DONE` exige comando, resultado, artefato, fingerprint e critério de aceitação correspondentes.
4. **Rebind não é reexecução:** rebind pode explicar identidade; nunca substitui prova comportamental.
5. **Bloqueios não são inferidos:** gates externos e humanos permanecem bloqueados até existir evidência real.
6. **Slices pequenos e reversíveis:** contratos e persistência avançam por domínio, com compatibilidade, reconciliação e rollback.
7. **Crítico não constrói:** revisores independentes recebem pacote selado e não alteram o candidato.

## 3. Sequência de marcos

```text
M0 Verdade do controle
   ↓
M1 Candidato e evidência reproduzíveis
   ↓
M2 Contratos HTTP + persistência por domínio
   ↓
M3 Runtime, container e supply chain
   ↓
M4 Qualidade profunda, browsers e manutenibilidade
   ↓
M5 Staging, observabilidade, resiliência e DR
   ↓
M6 Dupla qualificação independente
   ↓
M7 Decisão humana de promoção
```

## 4. Roadmap por fase

### M0 — Restaurar a verdade do control plane

**Backlog:** AUD27-001 a AUD27-003
**Achados cobertos:** A27-F01, F02, F03, F18 e F20

Entregas:

- matriz canônica entre achados originais F01–F39, tarefas AUD26, critérios e evidências;
- eventos de correção para status incorretos, sem editar o histórico;
- manifest semântico versionado e verificador com casos negativos;
- separação explícita entre `observed`, `planned`, `blocked` e `done`;
- documentação de estado alinhada com `.agent/state.json`.

Gate de saída:

- zero colisão semântica entre ID, título, achado e critério;
- o verificador falha deliberadamente para mapeamentos conhecidos como incorretos;
- `CVG-AUD26-024`, `CVG-AUD26-026` e F38 recebem correção append-only.

### M1 — Tornar candidato e evidência reproduzíveis

**Backlog:** AUD27-004 a AUD27-006
**Achados cobertos:** A27-F05, F06, F10, F11, F12 e F19

Entregas:

- inventário e commit do candidato, sem arquivos relevantes fora do versionamento;
- subject manifest congelado e worktree limpo durante a qualificação;
- evidence root externo existente, testado e protegido contra regravação silenciosa;
- pacote de evidência exportável, com hash ancorado fora do repositório;
- evidência focal para todos os itens concluídos e evidência tipada para parciais.

Gate de saída:

- outra máquina/checkout reproduz o subject fingerprint e valida o pacote;
- nenhum `DONE` depende apenas de `SUBJECT_REBIND`;
- nenhuma tarefa `PARTIAL` afirma progresso sem referência observável.

### M2 — Fechar contratos HTTP e persistência de domínio

**Backlog:** AUD27-007 a AUD27-014
**Achados cobertos:** A27-F04 e F07

Entregas:

- inventário mecanicamente verificável dos 80 schemas de resposta;
- schemas específicos, limites, redaction e contract tests para todas as 105 rotas;
- migração dos 24 slices snapshot-primary em quatro ondas de domínio;
- backfill idempotente, dual-read/dual-write apenas quando necessário, comparação de paridade e rollback;
- remoção comprovada do fallback a snapshot após cada cutover.

Gate de saída:

- zero schema catalogado cai no envelope genérico por omissão;
- `snapshot-primary = 0` para os 32 slices;
- restore e replay passam sobre o modelo final no mesmo candidato.

### M3 — Qualificar runtime, container e supply chain

**Backlog:** AUD27-015 a AUD27-017
**Achados cobertos:** A27-F02, F08, F13 e F14

Entregas:

- build e smoke da imagem real, healthcheck, non-root, shutdown e persistência;
- SBOM e scan do artefato construído;
- remediação ou decisão formal para as 10 licenças;
- `LICENSE` ou `COPYING` de raiz compatível com a decisão do owner;
- pin de imagens por digest e, quando houver registry, assinatura e proveniência OCI.

Gate de saída:

- `audit:licenses` verde;
- smoke executado sobre a mesma imagem que será promovida;
- nenhuma imagem de produção depende exclusivamente de tag mutável;
- OCI externo fica `PASS` ou permanece explicitamente bloqueado, nunca presumido.

### M4 — Elevar qualidade profunda e reduzir blast radius

**Backlog:** AUD27-018 a AUD27-020
**Achados cobertos:** A27-F15, F16 e F17

Entregas:

- cobertura com statements ou justificativa técnica equivalente, thresholds por risco e mutation testing seletivo;
- WebKit em ambiente suportado, contraste renderizado, estados, zoom/reflow e leitor de tela;
- extração incremental de `persistence`, `app`, `domain` e `contracts` para módulos coesos.

Gate de saída:

- thresholds não podem cair silenciosamente;
- zero violação crítica WCAG 2.2 AA no fluxo priorizado;
- limites de tamanho/complexidade impedem a recomposição dos monólitos.

### M5 — Provar operação e recuperação em staging

**Backlog:** AUD27-021 e AUD27-022
**Achados cobertos:** A27-F09

Entregas:

- logs estruturados entregues a coletor durável, dashboards e alertas;
- SLOs e runbooks com ownership e exercício;
- provedores e segredos reais controlados em staging;
- testes de carga, soak, degradação, caos, restore e DR;
- medição de RTO/RPO em vez de declaração documental.

Gate de saída:

- alertas disparam e são reconhecidos em exercício;
- RTO/RPO medidos ficam dentro dos limites aprovados;
- nenhum segredo de staging aparece em logs ou artefatos;
- integrações reais têm evidência de sucesso, timeout, retry e circuit breaking.

### M6 — Dupla qualificação independente

**Backlog:** AUD27-023 a AUD27-025
**Achados cobertos:** A27-F05, F06, F10, F11, F12, F18 e F20

Entregas:

- documentação consolidada e snapshot final;
- pacote selado enviado a dois revisores fresh-context;
- sentinela de mutação antes e depois de cada revisão;
- duas execuções completas no mesmo commit/fingerprint e ambientes declarados;
- comparação das decisões e tratamento de divergências.

Gate de saída:

- os dois revisores produzem veredito compatível no mesmo sujeito;
- todos os critérios obrigatórios têm prova current e aplicável;
- nenhum arquivo do candidato muda durante a crítica.

### M7 — Decisão humana

**Backlog:** AUD27-026 e AUD27-027
**Achados cobertos:** A27-F09

Entregas:

- dossiê final com riscos residuais, rollback e evidências externas;
- decisão explícita do owner: aprovar, rejeitar ou aprovar com exceção temporal.

Gate de saída:

- somente uma aprovação humana registrada pode alterar `BLOCKED_HUMAN`;
- exceções precisam de owner, justificativa, expiração e plano de remediação.

## 5. Ordem de execução recomendada

| Ordem | Faixa | Itens | Motivo |
|---:|---|---|---|
| 1 | P0 | 001–006 | sem verdade e evidência confiáveis, qualquer novo `DONE` é frágil |
| 2 | P0 | 007–017 | fecha contratos, dados, runtime e supply chain |
| 3 | P1 | 018–022 | amplia qualidade e prova operação real |
| 4 | P1 | 023–025 | consolida documentação e qualifica independentemente |
| 5 | P0 externo/humano | 026–027 | libera ou mantém bloqueada a promoção |

O trabalho dentro de uma fase pode ser paralelo quando os arquivos e contratos não se sobrepõem. A promoção, porém, continua serial: todos os gates anteriores precisam estar fechados.

## 6. Metas mensuráveis

| Indicador | Baseline AUD26 | Meta AUD27 |
|---|---:|---:|
| Nota técnica auditada | 69/100 | ≥ 90/100 |
| Prontidão de produção | 40/100 | ≥ 90/100 e sem gate obrigatório aberto |
| Schemas específicos | 2/80 | 80/80 |
| Slices snapshot-primary | 24/32 | 0/32 |
| Tarefas parciais sem evidência | 14 | 0 |
| Dependências fora da política | 10 | 0 sem decisão; exceções somente documentadas |
| Browsers qualificados | Chromium/Firefox | Chromium/Firefox/WebKit |
| Qualificações independentes no mesmo sujeito | 0 demonstráveis | 2 |
| Worktree limpo no freeze | não exigido | obrigatório |
| Gates externos/humanos inferidos | 0 | 0 |

## 7. Riscos de execução

| Risco | Probabilidade | Impacto | Mitigação |
|---|---:|---:|---|
| migração de snapshots altera semântica | alta | alto | golden datasets, paridade, canary e rollback por slice |
| schema específico quebra clientes | alta | alto | compatibilidade, contract tests e rollout por domínio |
| refactor de monólitos aumenta blast radius | média | alto | extração mecânica, diffs pequenos e characterization tests |
| evidência é invalidada por nova mudança | alta | médio | freeze tardio, manifest determinístico e invalidação automática |
| staging/registry/provedores atrasam a rodada | alta | alto | abrir bloqueios cedo e manter gates explicitamente separados |
| aprovação jurídica de licença demora | média | médio | separar remediação técnica de decisão legal e preparar alternativas |

## 8. Regra de decisão

Uma melhoria de nota não autoriza promoção. O veredito só pode mudar para `PROMOTION_ELIGIBLE` se:

- todos os P0 estiverem `DONE` com prova current;
- não houver gate externo obrigatório aberto;
- as duas qualificações independentes concordarem;
- o owner humano registrar aprovação.

Na falta de qualquer um desses elementos, o estado permanece **`PROMOTION_BLOCKED`**.
