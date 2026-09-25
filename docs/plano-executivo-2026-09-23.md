# Plano executivo de melhorias — 23/09/2026

**Base:** [auditoria de 23/09](./auditoria-repositorio-2026-09-23.md), 68/100 técnico e 35/100 de prontidão para produção.  
**Inventário:** [50 melhorias](./melhorias-50-priorizadas-2026-09-23.md).  
**Sequência e aceite:** [roadmap](./roadmap-2026-09-23.md) e [backlog](./backlog-2026-09-23.md).  
**Estado:** `PROPOSTO`; não importado para `.agent`. O programa AUD27 existente continua sendo a fonte de verdade operacional até uma reconciliação explícita.

## 1. Decisão executiva

Executar a remediação em sete marcos com gates de saída, começando pela verdade do control plane e terminando em qualificação independente e decisão humana. A promoção continua bloqueada. A meta é obter um candidato cuja implementação, revisão Git, testes, migrações, imagens e evidências correspondam ao **mesmo conjunto de bytes**. A nota não é um gate de aprovação: uma falha obrigatória não pode ser compensada por melhora em outra dimensão.

As 50 propostas refinam itens do [backlog AUD27](./backlog-melhorias-cvg-aud27-2026-09-21.md); não criam um programa paralelo ativo. Antes de importar qualquer ID para `.agent`, mapear a proposta ao item AUD27 existente, registrar duplicidade ou lacuna e preservar o histórico append-only. Trabalho já observado deve ser revalidado para o candidato atual antes de receber `DONE`.

## 2. Resultado esperado e medidas

| Resultado | Medida de saída |
|---|---|
| Controle confiável | `verify:control-plane` e suíte completa verdes; ponteiros de estado na cauda correta; known-bads rejeitados. |
| Candidato reproduzível | revisão limpa, checkout novo reproduz build/fingerprint e evidência externa confere com o candidato final. |
| Dados autoritativos | 0/32 coleções `SNAPSHOT_PRIMARY`; 24 cutovers com backfill, paridade, concorrência, replay, rollback e restore registrados. |
| Contratos e segurança | 105 rotas testadas com resposta real; 80/80 schemas específicos mantidos; isolamento e PDP preservados. |
| Supply chain | gate de licenças verde ou decisão formal aplicável, licença de raiz, imagem real exercitada, SBOM/scan/proveniência ligados ao digest. |
| Operação e experiência | E2E completo, WebKit/assistividade, observabilidade, carga, caos e RTO/RPO comprovados no ambiente exigido. |
| Decisão de release | duas qualificações independentes do mesmo fingerprint e autorização humana registrada; qualquer gate não provado mantém `PROMOTION_BLOCKED`. |

## 3. Escopo e limites

Inclui código, migrations forward-only, testes, scripts, CI, documentação, imagens e ensaios necessários às 50 melhorias. O uso de staging, provedores, segredos e revisão humana depende das autoridades correspondentes; preparação local pode avançar sem inferir sua aprovação. A execução não autoriza deploy em produção, tratamento de dados reais, alteração destrutiva de banco compartilhado, descarte de trabalho preexistente ou reescrita de registros históricos.

## 4. Frentes e responsáveis por função

| Frente | IDs MEL23 | Responsável funcional | Vínculo principal com AUD27 |
|---|---|---|---|
| Verdade, documentação e rastreabilidade | 001–003, 040–046 | Engenharia de qualidade / governança | AUD27-001..006, 023–024 |
| Candidato e evidência | 004–007 | Engenharia de release | AUD27-004..006, 025 |
| Persistência e contratos | 008–012, 021–024, 031–033, 047, 049 | Backend / dados | AUD27-007..014, 020 |
| Licenças, imagens e ferramentas | 013–016, 039, 048, 050 | Plataforma / supply chain | AUD27-015..017, 024 |
| Qualidade, experiência e worker | 025–030, 034–035 | QA / frontend / worker | AUD27-018..020, 022 |
| Qualificação externa | 017–019, 036–038 | Operações / segurança / donos de integração | AUD27-021..022, 026 |
| Revisão e decisão | 020 | Revisores independentes / autoridade de release | AUD27-023, 025..027 |

Os responsáveis são **funções propostas**, não pessoas nomeadas ou aceite atribuído. A capacidade da equipe e a disponibilidade de ambientes não foram informadas; por isso o roadmap não fixa datas de entrega.

## 5. Sequência de decisão

1. **M0 — Verdade operacional:** fechar a falha da suíte, o estado append-only e a semântica das provas.
2. **M1 — Reprodutibilidade:** estabelecer checkout limpo, fingerprint e evidence root; repetir este gate sempre que o candidato mudar.
3. **M2 — Dados e contratos:** migrar os 24 slices, provar resposta das rotas e reduzir os grandes boundaries sem regressão.
4. **M3 — Supply chain:** resolver licenças, imagem, Compose e proveniência.
5. **M4 — Qualidade profunda:** browsers, acessibilidade, cobertura, mutações e falhas de worker/integrações.
6. **M5 — Operação real:** staging, segredos, provedores, observabilidade, carga, caos e DR.
7. **M6 — Qualificação e decisão:** congelar novamente o candidato final, obter duas revisões independentes e decisão humana.

M2, M3 e partes de M4 podem avançar em paralelo depois de M0, desde que um dono coordene alterações em contratos, banco e CI. O caminho crítico de promoção é **M0 → M2/M3/M4 → M5 → congelamento final M1 → M6**. Não encerrar M1 definitivamente com um fingerprint anterior às mudanças subsequentes.

## 6. Regras de execução e evidência

- Cada item do backlog tem ID estável, dependências e critério de aceite. `DONE` exige comportamento observado, teste focal, regressão aplicável e prova vinculada ao candidato; `PARTIAL` registra o que falta.
- Correções em `.agent` são append-only. Rebind de sujeito é metadado, não prova de execução do critério.
- Migrations aplicadas não são editadas; novas mudanças usam migration monotônica e ensaio descartável antes do ambiente de destino.
- Cutover só avança quando leitura, escrita, backfill, paridade, replay e rollback da coleção passam. Divergência coloca a coleção em quarentena e impede remoção do fallback.
- Toda alteração posterior ao freeze invalida as provas afetadas. Refazer fingerprint, testes e evidence root antes de qualificar de novo.
- Prova sintética/local e prova externa recebem estados separados. Falta de staging, Secret Authority, provider, AT ou decisão humana permanece `BLOCKED_EXTERNAL`/`BLOCKED_HUMAN` conforme o caso.

## 7. Acompanhamento executivo

Revisar por marco: itens `DONE/PARTIAL/BLOCKED`, resultados de gates, idade da evidência, fingerprint em uso, riscos abertos e próxima decisão. A métrica principal é **critérios obrigatórios comprovados no mesmo candidato**, não porcentagem de tarefas fechadas. Reavaliar notas apenas após nova auditoria de código e provas; não usar nota projetada como evidência de conclusão.

**Próxima ação executável:** reconciliar os ponteiros do control plane e o teste `missing_transition` (MEL23-001/002), então repetir `npm test` (MEL23-003).
