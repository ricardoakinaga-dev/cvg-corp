# Roadmap de melhorias — CVG-AUD20

> **Superseded como plano corrente:** a execução parcial foi reavaliada e contém falsos verdes. Consulte a [auditoria CVG-AUD20](auditoria-resultado-cvg-aud20-2026-09-20.md), o [roadmap AUD21](roadmap-melhorias-cvg-aud21-2026-09-20.md) e o [backlog AUD21](backlog-melhorias-cvg-aud21-2026-09-20.md). Este arquivo permanece como contrato histórico.

**Data-base:** 2026-09-20  
**Origem:** [reauditoria do resultado CVG-AUD19](auditoria-resultado-cvg-aud19-2026-09-20.md)  
**Backlog:** [catálogo CVG-AUD20](backlog-melhorias-cvg-aud20-2026-09-20.md)  
**Estado inicial:** `FAIL / AAA_NOT_PROVEN`

## Objetivo

Transformar o worktree AUD19 em candidato local coerente, reproduzível e fail-closed; depois obter evidência externa same-SHA e decisão humana. O plano separa correção de produto, correção da prova e dependências externas.

## Sequência crítica

```text
R0 contenção e banco
  ↓
R1 fronteiras backend/worker
  ↓
R2 frontend e qualidade web
  ↓
R3 observabilidade + evidência + control plane
  ↓
R4 qualificação local do objeto congelado
  ↓
R5 staging/provedores/recovery gerenciado
  ↓
R6 crítica independente e decisão humana
```

R3 pode avançar em paralelo com R1/R2, mas nenhum receipt de fechamento pode ser emitido antes de R4.

## R0 — Contenção e integridade do banco

**Prioridade:** imediata  
**Saída:** nenhuma escrita runtime contorna terminalidade, fence ou least privilege; readiness exige o schema atual.

- Congelar promoção e reconciliar itens reabertos sem apagar o histórico.
- Separar autoridade de restore da conexão runtime e impedir transição runtime para `QUARANTINED_RESTORE`.
- Exigir `ACTIVE` nos guards memory/PostgreSQL de turn, checkpoint e lease.
- Revogar default privileges amplos e provar tabela futura conhecida-ruim.
- Atualizar readiness para 040/041 ou um manifesto canônico de schema.
- Adicionar contraprovas PostgreSQL para fence antigo, sessão terminal, tabela futura e banco parado em 039.

**Gate:** `CVG-AUD20-002` a `005` verdes em PostgreSQL 16 descartável; known-bad falha; nenhum verificador reconcede privilégios fora da matriz de produção.

## R1 — Fronteiras autoritativas e workers

**Prioridade:** imediata  
**Saída:** identidade, PDP, lifecycle de sessão e efeitos externos fechados.

- Tornar divergência entre `resourceId`, `patientId` e `encounterId` terminal e fail-closed.
- Adequar wrapper/analisador para o gate universal enxergar operações de PDP sem allowlist frouxa.
- Transportar `AbortSignal` do ciclo até relay, sink, mapper e provider.
- Tornar TTL determinístico, sem janelas de dezenas de milissegundos.
- Validar digest semântico e referências internas do bundle de recovery.
- Cobrir crash antes/depois do efeito, ack, restart, duplicidade, lease loss, poison retryable e `OUTCOME_UNKNOWN`.

**Gate:** contraprovas de IDs e pós-terminal rejeitadas; PDP verde com known-bad; provider em voo observa abort; matriz PostgreSQL passa duas vezes.

## R2 — Frontend e qualidade web

**Prioridade:** alta  
**Saída:** contratos semânticos, busca determinística e fallback raiz testado.

- Substituir o ref global de montagem por cancelamento por efeito/`AbortController`, preservando a resposta mais nova sob `StrictMode`.
- Derivar schemas de contratos canônicos com IDs, enums, inteiros, dinheiro, versões e objetos aninhados estritos.
- Trocar inventário regex por catálogo tipado/AST e rejeitar duplicatas/rotas espúrias.
- Injetar falha de render e provar foco, `role=alert`, correlação, retry e telemetria do boundary.
- Adotar ESLint TypeScript/React Hooks/jsx-a11y, budgets de JS/CSS, code splitting, CWV/Lighthouse e contraste automatizado.

**Gate:** E2Es 018–020 verdes em Chromium e Firefox sem retries; payload corrupto rejeitado; boundary exercitado com axe; build falha ao exceder budget. WebKit, leitor de tela e zoom assistido pertencem ao gate externo R5 e não bloqueiam a saída local de R2.

## R3 — Observabilidade, evidência e control plane

**Prioridade:** alta  
**Saída:** falhas observáveis e receipts vinculados aos bytes executados.

- Backend durável de logs com retenção, health, consulta após restart e redaction/PII known-bad.
- Drill local do Alertmanager com receiver sintético: firing, entrega, resolved e receiver indisponível. A entrega real em staging continua em R5.
- Fingerprint de HEAD + tracked diff + untracked relevante + hashes de artefato.
- Receipts com ambiente, comando, exit status, observed-at real, freshness e fingerprint.
- Separar comando de relatório de gate; ausência de credencial deve ser exit não zero.
- Tornar verificadores `--structural` read-only ou renomeá-los.
- Reconciliar plano, backlog, state, checkpoint e next actions em um ponteiro ativo.

**Gate:** source/untracked/artifact drift conhecidos-ruins rejeitados; timestamps válidos; `verify:static`, proveniência e exit semantics verdes no mesmo fingerprint; logs sobrevivem restart.

## R4 — Qualificação local integrada

**Dependência:** R0–R3  
**Saída:** candidato local imutável e repetível.

Executar no mesmo fingerprint, duas vezes consecutivas:

- typecheck, ESLint, testes, build e budgets;
- guards de arquitetura, PDP, segurança, writes, agent runtime e worker;
- instalação limpa e upgrade das migrations 001–latest;
- PostgreSQL concurrency, schema, isolation, restore, privileges e worker effects;
- Playwright completo nos runners locais suportados (Chromium e Firefox), viewports e stress, sem retries; WebKit permanece explicitamente fora do gate local e em R5;
- axe, contraste, keyboard e zoom automatizável;
- carga, chaos e recovery locais com budgets pré-declarados.

**Gate:** zero falha/flaky; skips apenas por caso inaplicável; artefatos imutáveis depois do manifesto; receipts no mesmo fingerprint.

## R5 — Evidência externa e recovery gerenciado

**Dependência:** ambiente, credenciais e autoridades externas  
**Saída:** candidato production-like same-SHA.

- Imagens imutáveis e SBOM/provenance same-SHA.
- Staging com TLS, secret authority, egress/callback e telemetria reais.
- Entrega real de alertas em receiver autorizado, incluindo firing, resolved e falha observável.
- DeepSeek/provider reais com receipts, reconciliação e falhas controladas.
- Carga/chaos representativos e backup/restore gerenciado com RTO/RPO medidos.
- WebKit em runner compatível, leitor de tela e zoom 200%/400%.

**Gate:** nenhum `BLOCKED_EXTERNAL` ou `NOT_RUN` obrigatório; evidência ligada ao candidato de R4.

## R6 — Reauditoria e decisão de release

**Dependência:** R4 e R5  
**Saída:** veredito independente e decisão humana.

- Crítico read-only e fresco contra o candidato congelado.
- Reconciliação de todos os AUD20 e AUD19 reabertos.
- F23 e F24 executados como red teams separados, com artefatos e assinaturas independentes.
- Scorecard final com todas as fases F0–F38 em `PASS`, zero hard blocker, nota geral ≥97 e cada dimensão no threshold congelado de 95–97.
- Revisão independente assinada e decisão humana `APPROVE`, `REJECT` ou `DEFER` criptograficamente atestada, com escopo e rollback.

## Política de status

- `READY`: trabalho local executável agora;
- `BLOCKED_BY_DEPENDENCIES`: depende de tarefa identificada;
- `BLOCKED_EXTERNAL`: exige ambiente, credencial ou autoridade ausente;
- `BLOCKED_HUMAN`: exige decisão humana;
- `DONE`: aceite executado e receipt válido do objeto exato.

`BLOCKED` genérico não deve ser usado.
