# Reauditoria técnica da entrega CVG-AUD26

**Rodada:** CVG-AUD27
**Data:** 2026-09-21
**Escopo auditado:** entrega CVG-AUD26 e seus artefatos de controle, evidência, código e documentação
**Source SHA informado:** `c990914148a8f375082cd12bbdb2ad20cfe1900f`
**Fingerprint auditado, antes desta atualização documental:** `sha256:585ac671407f924c272bf25d77b96faf29bd8d39f060ef84a558b14368695906`
**Veredito:** `PROMOTION_BLOCKED — AAA_NOT_PROVEN`
**Nota técnica auditada:** **69/100**
**Prontidão para produção:** **40/100**

> Este relatório é uma nova auditoria da entrega AUD26. Ele não substitui nem reescreve os registros históricos da rodada anterior. A inclusão destes documentos altera o subject manifest; portanto, o fingerprint `585ac671...` deve ser tratado como identificador histórico do candidato auditado, e não como fingerprint do worktree após esta publicação.

## 1. Conclusão executiva

A conclusão global da entrega anterior está correta: o candidato **não pode ser promovido**. A contagem de tarefas também foi confirmada: 36 itens, sendo 15 `DONE`, 19 `PARTIAL`, 1 `BLOCKED_EXTERNAL` e 1 `BLOCKED_HUMAN`.

A rodada trouxe melhorias reais e verificáveis em testes, segurança de streaming, SSRF, telemetria, controle de papéis, restore e disciplina de evidência. Contudo, a entrega não pode ser considerada encerrada como programa de melhoria. O estado persistido permanece `IN_PROGRESS`, com `CVG-AUD26-015` ativo, e o plano ainda possui marcos abertos.

O principal problema novo não é um teste quebrado: é a **integridade semântica do control plane**. IDs de tarefas, achados originais, títulos e critérios da quality bar foram deslocados entre si. Os verificadores atuais provam consistência estrutural, mas não provam que cada tarefa continua representando o achado original correto. Isso permitiu, por exemplo, que itens fossem marcados como `DONE` apesar de o próprio relatório classificar o respectivo achado como parcial.

Também permanecem impeditivos materiais: 24 slices ainda dependem primariamente de snapshots, 78 de 80 schemas de resposta catalogados continuam genéricos, o candidato não está consolidado em uma árvore versionada e limpa, a raiz externa de evidências não existe, o smoke real da imagem não está provado, há 10 licenças fora da allowlist e faltam qualificações de staging, provedores, segredos, observabilidade, RTO/RPO, OCI, WebKit/AT e aprovação humana.

## 2. Escopo e método

Foram inspecionados:

- documentação normativa e relatório AUD26;
- `.agent/state.json`, `.agent/backlog.json`, ExecPlan e quality bar AUD26;
- snapshot de evidências e gates locais/externos;
- scripts de subject manifest, controle, evidência, cobertura, contraste e licenças;
- contratos HTTP, persistência, migrações e composição de runtime;
- estado Git e inventário de arquivos da árvore auditada;
- parecer crítico da rodada anterior.

A barra de qualidade desta auditoria foi congelada antes da conclusão:

1. rastreabilidade semântica entre achado, tarefa, critério, evidência e veredito;
2. reprodutibilidade do candidato;
3. correção funcional e contratual;
4. segurança e supply chain;
5. persistência, restore e recuperação;
6. frontend, acessibilidade e browsers;
7. operação, desempenho e observabilidade;
8. independência e durabilidade da evidência.

O trabalho foi read-only até o início desta atualização documental. Um sentinela calculado antes e depois das validações retornou o mesmo digest, `b8fdc762ec6877b6c6af941d8f6269fc584d6f8f384027746032c1aa43438ea3`.

Esta reauditoria foi executada pelo agente da sessão corrente e, portanto, tem grau de independência **I0**. Não foi produzido um novo parecer fresh-context separado. Isso não impede o registro dos defeitos reproduzidos, mas impede usar este relatório como a segunda qualificação independente exigida para promoção.

## 3. Validações frescas

| Verificação | Resultado | Observação |
|---|---:|---|
| `npm run verify:control-plane` | PASS | 307 itens; prova estrutura, não alinhamento semântico |
| `npm run verify:aud26-evidence` | PASS | fingerprint AUD26 `585ac671...`; 4 artefatos |
| `npm run verify:static` | PASS | 240 artefatos e 255 arquivos-fonte |
| `npm test` | PASS | 599 total; 598 pass; 0 fail; 1 skip |
| `npm run typecheck` | PASS | sem erro |
| `npm run lint` | PASS | verificadores customizados em 258 arquivos e ESLint sem warnings |
| `npm run audit:licenses` | FAIL | 10 dependências fora da allowlist |

Coverage, build, E2E/browser e PostgreSQL não foram reexecutados nesta auditoria para evitar substituir artefatos e recursos da rodada auditada. Foram revisados os recibos existentes:

- coverage: 87,85% linhas, 75,39% branches e 85,69% funções;
- browser: 336 aprovados e 24 skips condicionais;
- WebKit: indisponível por dependência ausente no host;
- PostgreSQL descartável, restore e replay: aprovados localmente;
- build: aprovado no recibo AUD26.

## 4. Pontuação detalhada

A escala é: 90–100 excelente; 75–89 bom com lacunas controladas; 60–74 parcial; 40–59 frágil; abaixo de 40 insuficiente.

| Dimensão | Peso | Nota | Contribuição | Fundamentação |
|---|---:|---:|---:|---|
| Documentação e rastreabilidade | 6 | 48 | 2,88 | registros extensos, mas mapeamento tarefa/achado/barra divergiu |
| Arquitetura e fronteiras | 7 | 66 | 4,62 | melhorias reais; módulos centrais continuam muito grandes |
| Domínio e invariantes | 7 | 82 | 5,74 | boa cobertura funcional e invariantes testadas |
| API e contratos | 6 | 58 | 3,48 | envelope seguro, mas 78/80 schemas continuam genéricos |
| Segurança e privacidade | 10 | 82 | 8,20 | SSRF, streaming e papéis melhorados; gates externos ausentes |
| Persistência e migrações | 12 | 64 | 7,68 | restore local forte; 24 slices ainda snapshot-primary |
| Backup, restore e recuperação | 11 | 76 | 8,36 | evidência local existe; RTO/RPO e staging não provados |
| IA e governança | 6 | 80 | 4,80 | limites e telemetria melhoraram; qualificação externa pendente |
| Workers e integrações | 6 | 80 | 4,80 | disciplina local boa; provedores reais ainda bloqueados |
| Frontend e acessibilidade | 6 | 68 | 4,08 | E2E Chromium/Firefox forte; WebKit, AT e contraste renderizado faltam |
| Testes e verificabilidade | 8 | 82 | 6,56 | 598 testes aprovados; cobertura/critérios ainda têm lacunas |
| CI/CD e supply chain | 5 | 54 | 2,70 | licenças falham; imagem/OCI e candidato limpo não provados |
| Observabilidade | 5 | 52 | 2,60 | telemetria local presente; coletor, retenção e alertas ausentes |
| Desempenho e resiliência | 3 | 60 | 1,80 | controles unitários existem; carga/caos/staging faltam |
| Manutenibilidade | 2 | 55 | 1,10 | monólitos e dívida de contratos persistem |
| **Total ponderado** | **100** | **69,40** | **69,40** | **arredondado para 69/100** |

### Interpretação das notas

- A nota **77,1/100** do relatório AUD26 é uma medição interna de evidência local. Ela não deve ser usada como nota de prontidão para produção.
- A nota **69/100** desta auditoria inclui integridade da rastreabilidade, reprodutibilidade e qualidade da prova.
- A nota **40/100** de produção reflete a ausência de gates externos, do segundo qualificador independente e da aprovação humana.

## 5. Achados completos e priorizados

### Alto impacto — resolver antes de qualquer nova candidatura

1. **A27-F01 — Mapeamento semântico corrompido entre achados, tarefas e quality bar.** O backlog AUD26, a quality bar e o relatório usam IDs iguais para assuntos diferentes. Exemplo: `CVG-AUD26-022` descreve browser/E2E, mas referencia `F25`, originalmente cobertura; `CVG-AUD26-024` descreve tokens/contraste, mas referencia `F26`, originalmente bundle. O verificador atual aceita essa combinação porque valida forma, não significado. **Prioridade P0.**

2. **A27-F02 — O achado original F38 foi reportado como `PASS_LOCAL` sem `LICENSE` ou `COPYING`.** `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md` e `CHANGELOG.md` existem, mas o critério normativo incluía uma licença de raiz. **Prioridade P0.**

3. **A27-F03 — `CVG-AUD26-024` está `DONE`, mas o próprio relatório classifica contraste/tokens como parcial.** O script estático cobre 12 pares e declara não validar estilos computados, temas e estados. O status deve ser corrigido por evento append-only. **Prioridade P0.**

4. **A27-F04 — Contratos de resposta por rota estão substancialmente incompletos.** O catálogo tem 105 rotas e 80 nomes de schemas de resposta; apenas dois desses schemas têm validação específica no mapa efetivo. Os outros 78 usam `ENVELOPE_BOUNDED`, isto é, cerca de 97,5% dos tipos únicos permanecem genéricos. **Prioridade P0.**

5. **A27-F05 — O candidato não é uma revisão Git limpa e reproduzível.** O `sourceSha` aponta para o commit anterior enquanto a entrega depende de dezenas de alterações tracked e 94 arquivos untracked. O fingerprint identifica a árvore local, mas não substitui uma revisão versionada, empacotada e reproduzível. A quality bar ainda define `clean_worktree_required: false`. **Prioridade P0.**

6. **A27-F06 — A raiz externa e durável de evidências não existe.** O default resolve para `../cvg-aud24-evidence`, diretório ausente. O verificador comprova apenas que o caminho está fora do repositório, não que existe nem que os recibos foram persistidos ali. Os artefatos efetivos estão dentro de `artifacts/`, excluído do subject manifest e regravável junto com seu snapshot. **Prioridade P0.**

7. **A27-F07 — A migração de snapshots ainda é um framework, não 24 cutovers executados.** A infraestrutura e o plano de migração existem, mas 24 de 32 slices continuam `snapshot-primary`. Não há backfill, reconciliação e remoção do fallback comprovados slice a slice. **Prioridade P0.**

8. **A27-F08 — O container foi marcado `DONE` sem smoke real da imagem.** A evidência associada a `CVG-AUD26-026` é um rebind de `build:runtime`; ela não prova build da imagem, start, healthcheck, non-root, persistência e shutdown. **Prioridade P0.**

9. **A27-F09 — Os gates externos e humanos continuam impeditivos.** Faltam staging, provedores reais, segredos reais, coletor e alertas, carga/caos, RTO/RPO, registry/OCI, WebKit/AT e aprovação do owner. A classificação como bloqueio foi honesta, mas o risco permanece alto. **Prioridade P0 para promoção.**

### Médio impacto — resolver na rodada AUD27

10. **A27-F10 — Evidências de itens `DONE` apontam predominantemente para recibos `SUBJECT_REBIND`.** Há uma revalidação integrada posterior, mas os links das tarefas não conduzem diretamente à prova focal. O rebind demonstra identidade do sujeito, não substitui a execução do critério. **Prioridade P1.**

11. **A27-F11 — Quatorze tarefas `PARTIAL` não têm `evidence_refs` nem `candidate_fingerprint`.** Isso mistura progresso observado com trabalho apenas planejado e impede auditoria item a item. **Prioridade P1.**

12. **A27-F12 — A independência do parecer crítico anterior é declarada, mas não demonstrável.** O Markdown informa contexto fresco e review-only, porém não há pacote selado, identificador do executor, registro bruto ou sentinela de não mutação associado ao parecer. **Prioridade P1.**

13. **A27-F13 — O gate de licenças local falha e foi agregado como bloqueio externo.** Dez dependências estão fora da allowlist. A decisão jurídica pode ser humana, mas atualizar dependências, substituir pacotes ou corrigir a política são ações locais; os dois aspectos precisam ser separados. **Prioridade P1.**

14. **A27-F14 — Imagens continuam mutáveis e a proveniência OCI não foi provada.** PostgreSQL e componentes de observabilidade ainda dependem de tags ou defaults mutáveis. Digest, SBOM, assinatura, scan e proveniência do artefato final faltam. **Prioridade P1.**

15. **A27-F15 — O gate de coverage não mede statements e usa thresholds modestos.** O runner nativo gera linhas, branches e funções; `statements` fica ausente. Também faltam mutation testing e metas de cobertura por área crítica. **Prioridade P1.**

16. **A27-F16 — Acessibilidade e compatibilidade ainda são parcialmente estáticas.** Contraste renderizado, estados interativos, zoom/reflow, leitor de tela e WebKit não estão comprovados. **Prioridade P1.**

17. **A27-F17 — Módulos centrais permanecem monolíticos.** `packages/persistence/src/index.ts` (~5.166 linhas), `apps/api/src/app.ts` (~2.708), `packages/domain/src/index.ts` (~2.317) e `packages/contracts/src/index.ts` (~2.000) mantêm alto blast radius. **Prioridade P1.**

18. **A27-F18 — O estado formal não representa uma execução encerrada.** `.agent/state.json` continua `IN_PROGRESS`, com tarefa ativa, e o ExecPlan mantém marcos abertos. O encerramento informado deve ser entendido como fim de uma rodada/handoff, não conclusão do programa. **Prioridade P1.**

### Baixo impacto — corrigir para reduzir ambiguidade

19. **A27-F19 — O nome default da raiz de evidência ainda referencia AUD24.** Além de ausente, `cvg-aud24-evidence` gera ambiguidade operacional numa rodada AUD26/AUD27. **Prioridade P2.**

20. **A27-F20 — Algumas conclusões usam linguagem mais forte do que a prova.** Expressões como “schemas incompletos em parte” minimizam 78/80 schemas genéricos; “execução concluída” conflita com `IN_PROGRESS`. **Prioridade P2.**

## 6. Ranking consolidado

| Ranking | Faixa | Achados | Ação |
|---:|---|---|---|
| 1 | Alto/P0 | A27-F01, F02, F03, F04, F05, F06, F07, F08, F09 | bloquear promoção e corrigir primeiro |
| 2 | Médio/P1 | A27-F10 a F18 | concluir na AUD27 antes da qualificação final |
| 3 | Baixo/P2 | A27-F19 e F20 | corrigir junto da consolidação documental |

## 7. Correção dos status da entrega anterior

Sem reescrever o histórico, a próxima rodada deve emitir eventos de correção:

| Item AUD26 | Status registrado | Status auditado recomendado | Motivo |
|---|---|---|---|
| `CVG-AUD26-024` | DONE | PARTIAL | contraste/tokens não passaram por validação renderizada |
| `CVG-AUD26-026` | DONE | PARTIAL | build existe, smoke real do container não está provado |
| F38 no relatório | PASS_LOCAL | PARTIAL | falta `LICENSE`/`COPYING` |
| Programa AUD26 | “execução concluída” | IN_PROGRESS/HANDOFF | estado e plano ainda estão abertos |

Os demais 13 itens `DONE` não foram rebaixados nesta revisão, mas precisam receber ligações diretas para evidèncias focais atuais antes da qualificação final.

## 8. Dependências fora da allowlist

O gate local reportou:

1. `@typescript-eslint/typescript-estree` — `minimatch` — BlueOak-1.0.0;
2. `argparse` — Python-2.0;
3. `damerau-levenshtein` — BSD-2-Clause;
4. `eslint-scope` — BSD-2-Clause;
5. `espree` — BSD-2-Clause;
6. `esrecurse` — BSD-2-Clause;
7. `estraverse` — BSD-2-Clause;
8. `esutils` — BSD-2-Clause;
9. `language-subtag-registry` — CC0-1.0;
10. `uri-js` — BSD-2-Clause.

Isso não significa automaticamente que as licenças são incompatíveis. Significa que a política atual não as aceita e que não existe decisão documentada para substituição, exceção ou ampliação da allowlist.

## 9. Critérios de saída da AUD27

A AUD27 só pode terminar como candidata a promoção quando, no mesmo candidato limpo e imutável:

1. o mapa semântico de todos os achados e tarefas estiver reconciliado e testado com casos negativos;
2. nenhum item `DONE` depender apenas de rebind ou de evidência genérica;
3. todos os schemas de resposta catalogados forem específicos e validados em runtime;
4. os 24 slices tiverem cutover, reconciliação e rollback comprovados;
5. container, imagens, licenças e OCI estiverem qualificados;
6. WebKit, acessibilidade renderizada, observabilidade, carga, caos e DR estiverem provados;
7. dois validadores independentes reproduzirem a mesma decisão no mesmo fingerprint;
8. o owner humano aprovar explicitamente a promoção.

Até lá, o único veredito correto permanece **`PROMOTION_BLOCKED — AAA_NOT_PROVEN`**.

## 10. Documentos derivados

- [Roadmap executivo AUD27](./roadmap-melhorias-cvg-aud27-2026-09-21.md)
- [Backlog executável AUD27](./backlog-melhorias-cvg-aud27-2026-09-21.md)
- [Prompt de execução Codex](./prompt-codex-execucao-cvg-aud27-2026-09-21.md)
- [Relatório histórico AUD26](./auditoria-resultado-cvg-aud26-2026-09-21.md)
