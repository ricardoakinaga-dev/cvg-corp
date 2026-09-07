# CVG-Corp — Registro de Gauntlet e veredito

**Estado:** CONDITIONAL PASS documental; fechado para esta fase e bloqueado para BUILD até as decisões pendentes.

**Data da execução:** 2026-09-07 (America/Sao_Paulo)

## 1. Escopo e autorização

Objetivo: produzir somente a documentação da arquitetura-alvo do CVG-Corp, usando o corpus corporativo inspecionado durante a preparação e o `deepseek-harness` como motor proposto. A autorização desta fase permitiu escrita apenas em `harness-corp/docs/`; não autorizou código, configuração de runtime, banco, segredo, deploy ou integração externa.

Quality Bar ativo: v1.1, registrado em [`00-quality-bar-v1.md`](00-quality-bar-v1.md). `PASS` neste documento significará, quando fechado, qualidade da documentação desta fase; nunca aprovação de produção.

## 2. Estado do artifact

| Item | Evidência |
|---|---|
| Escopo de arquivos | documentos Markdown em `harness-corp/docs/` |
| Fingerprint antes do rework (artefato sem este relatório) | `4135f7b8223a3bb16ecccbfa3b553478494d5079d7e588bfa7e24a258e65613c` |
| Fingerprint após o primeiro rework (artefato sem este relatório) | `6e6af164b41f77d41a863deb6a3df82ed4ac4ecd3ebd883ee562a231bf54fc19` |
| Fingerprint após o segundo rework (artefato sem este relatório) | `a29fe34e287cc3d2da8bcc870bd5166179b44b4e98348412f17fe7a30bbf3a19` |
| Fingerprint após a normalização final do README (artefato sem este relatório) | `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483` |
| Fingerprint após a correção de empacotamento/proveniência (artefato sem este relatório) | `abaa05e1b8ce864b68a9e95570299b6e8d4358f2d616a5839fd1cb96f17052b1` |
| Motor | commit `6454e3270642c3a7551dcae4f7447e4032febd77`, manifesto `0.1.1-rc.2`, `git status` limpo |
| Runtime CVG | não existe nesta fase |

O fingerprint é calculado sobre os arquivos Markdown de primeiro nível em `harness-corp/docs/`, excluindo este relatório para evitar auto-referência; ele é um sentinel de escopo, não uma assinatura de release.

## 3. Rodadas executadas

### Discovery e scouts

Três scouts read-only independentes inspecionaram produto, motor e adversarial risks. Não alteraram arquivos nem executaram subagentes. Suas conclusões foram incorporadas como hipóteses, restrições e gates, sem transformar o domínio veterinário em fato observado nas fontes.

### Critic round I1-A — arquitetura

**Critic:** `CRITIC-ARCH-20260907-A` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: os vinte critérios do addendum v1.1 não estavam individualmente ligados a design, contrato, risco, owner e verificação; havia referências de IDs não definidos. Gaps associados: lifecycle por store, isolamento, budget, auditoria e versionamento. O critic informou não ter observado mutação do artifact.

### Critic round I1-B — segurança

**Critic:** `CRITIC-SAFETY-20260907-B` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: ausência de contratos negativos executáveis para `DATA-02`, `ISO-01/02`, `BUD-01/02`, `TRACE-01` e lifecycle de dispositivo. Também apontou jornadas sem recuperação explícita e distinção insuficiente entre telemetry e auditoria. O critic informou não ter observado mutação do artifact.

### Critic round I1-C — arquitetura pós-rework 1

**Critic:** `CRITIC-ARCH-20260907-C` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: os vinte gates v1.1 já estavam individualizados, mas os gates v1 ainda eram agregados no plano; os três gates AAA estavam combinados no documento de rastreabilidade; e os claims `SRC-DSH-*` não apareciam junto às linhas de uso em 02/04. Também classificou como parciais a recuperação explícita de UC-01/02/07, o binding de versão de sessão/credencial e a instanciação dos contratos de integração. Sentinel antes informado: `f6b62b5d44699c96cf994324ac77e9a766cc69e9b93cc7c64ecdaa994508038f`; depois não calculado por interrupção, sem mutação observada.

### Critic round I1-D — segurança pós-rework 1

**Critic:** `CRITIC-SAFETY-20260907-D` — contexto novo, não herdado, packet selado. **Decisão:** `REJECT`.

Maior gap: a figura ainda mostrava rota privilegiada direta, a matriz combinava provider/telemetry e não tinha linha própria para audit ledger. Também exigiu contrato formal para coordenador de lifecycle, canonicalização/consumo one-shot do approval, ledger de settlement, registry fail-closed e autoridade independente de break-glass. Sentinel antes/depois: `6e6af164b41f77d41a863deb6a3df82ed4ac4ecd3ebd883ee562a231bf54fc19`/o mesmo valor; delta zero. Nenhum arquivo foi alterado pelo critic.

### Critic final I1-E — fechamento

**Critic:** `FINAL-CVG-20260907-E` — contexto novo, não herdado, packet selado. **Decisão documental:** `PASS`.

Resultado: v1 `PASS-DOC` em 14/14 e v1.1 `PASS-DOC` em 20/20. O critic confirmou contratos de lifecycle/stores, proveniência, jornadas com sucesso/negação/recuperação, isolamento, binding revogável, break-glass, admission comum, aprovação canônica one-shot, integrações instanciadas, budget/ledger, audit write, telemetry, registry de IA e versionamento/restore.

Gap residual: `INT-02/U8` — fornecedores, endpoints/regiões, versões externas e algumas fontes de verdade permanecem `PROPOSED/UNKNOWN`. É um bloqueador explícito do BUILD e não um overclaim. Runtime, implementação e testes continuam `NOT_RUN`.

Sentinel do critic: `a29fe34e287cc3d2da8bcc870bd5166179b44b4e98348412f17fe7a30bbf3a19` antes e depois, delta zero; nenhuma mutação observada.

### Revisor final de consistência I1-F

**Revisor:** `FINAL-CVG-20260907-F` — contexto novo, não herdado, packet selado. **Decisão:** `PASS`.

O revisor confirmou que a normalização do README não criou contradição, que os 14 critérios v1 e 20 critérios v1.1 permanecem cobertos, e que a documentação continua distinguindo `NOT_RUN` de evidência operacional. Sentinel antes/depois: `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483`, delta zero.

## 4. Rework aplicado após os critics

- Proveniência individual `SRC-DSH-*` para seams de plugins, session, tools, approval, credentials, sandbox, jobs, workflow, subagents, remote e telemetry.
- Recuperação explícita para exames, internação, estoque e financeiro no PRD.
- Lifecycle ponta a ponta e `DataRef` para DB, audit, object, vector, session, cache, provider, telemetry, backup e export.
- `SecurityContextSnapshot`, `PolicyBinding`, revocation epoch, TTL, binding de credencial e separação concreta de Admin Master/break-glass.
- Matriz negativa de isolamento em cada store/fluxo, inclusive session, billing, export e restore.
- `CvgToolAdmission`/`ActionEnvelope` comum para tool nativa/local, MCP, skill, Code Mode, subagente e remote.
- Reserva atômica, hard stop, sub-reservas nested, settlement e hold de late usage.
- `IntegrationContract` por laboratório/imagem, pagamento, mensageria, calendário e provider.
- `TelemetryPolicy` com redaction, retenção, perda e deduplicação, independente do audit ledger.
- `GovernedArtifact` registry com avaliação, admissão, rollback e kill switch; `ContractDescriptor` com migração, mixed-version e restore seguro.
- Propagação individual dos gates v1 no plano, separação dos três gates AAA e IDs `SRC-DSH-*` junto aos claims de arquitetura e motor.
- Rota privilegiada sem acesso direto a dados; audit ledger separado e boundary universal para Admin Master, break-glass, restore, export, workers e plugins.
- Canonicalização, consumo one-shot e atomicidade do approval binding; registry/digest/revision fail-closed no dispatch.
- `LifecycleCoordinator`, `AuditWrite`, ledger de usage/settlement e schemas versionados individuais por integração.

## 5. Checks locais atuais

| Check | Resultado |
|---|---|
| marcadores de scaffold nos Markdown | PASS — nenhum encontrado |
| IDs aposentados ou órfãos nas matrizes | PASS — nenhum encontrado |
| status do motor DeepSeek | PASS — `master...v2/master`, sem alterações |
| links relativos Markdown | PASS — todos os destinos locais presentes resolvem; as duas fontes corporativas ausentes estão marcadas como metadados, sem links quebrados |
| cobertura de gates v1/v1.1 em plano, AAA e rastreabilidade | PASS — 34 IDs presentes |
| newline final nos Markdown | PASS |
| fingerprint pós-crítica | PASS — `1b11642178ca977ffd6524ce995d18726b91a5608552eef66c77ce2fe4890483` antes/depois do revisor final |
| fingerprint do artifact empacotado | PASS — `abaa05e1b8ce864b68a9e95570299b6e8d4358f2d616a5839fd1cb96f17052b1` |

## 6. Evidência que continua ausente

Além da ausência de implementação CVG, schema executável, endpoint, profile dump, adapter, credencial, provider, benchmark, teste de autorização, cross-scope, red-team, fault injection, budget ledger, auditoria durável, restore, migração, kill switch ou aprovação humana executada, os dois arquivos-fonte corporativos usados nas sínteses não estão presentes no artifact atual. Por isso `VERIFIED` e `RELEASE_READY` permanecem fora do escopo desta fase; os claims que dependem exclusivamente dessas fontes exigem restauração e nova inspeção.

## 7. Veredito final da fase

`CONDITIONAL PASS` documental. A documentação atingiu a barra v1.1 nesta fase, mas não autoriza produção nem BUILD automático. Antes do próximo ciclo, direção clínica, produto, segurança, privacidade, operações, financeiro e integração precisam decidir U1–U15; em especial, fechar U8/U12/U14, transformar os contratos em schemas/adapters e executar os testes listados em 06/07.
