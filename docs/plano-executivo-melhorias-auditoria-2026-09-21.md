# Plano executivo de melhorias — CVG-AUD26

**Programa proposto:** `CVG-AUD26`
**Data:** 2026-09-21
**Classe:** T4 — evolução brownfield crítica
**Atividade inicial:** PLAN
**Overlays obrigatórios:** SECURITY, MIGRATION e AUDIT
**Origem:** [auditoria profunda do repositório](./auditoria-profunda-repositorio-2026-09-21.md)
**Estado deste documento:** PROPOSTO; ainda não importado para o estado canônico em `.agent`

## 1. Decisão executiva

Executar um programa único de remediação e qualificação para elevar a nota técnica de **65/100** e a prontidão de produção de **38/100** até um estado comprovadamente promovível. A ordem de execução privilegia integridade, menor privilégio e evidência honesta antes de produtividade, estética ou otimização.

A promoção permanece bloqueada durante o programa. Nenhum score-alvo, teste local isolado ou item marcado como concluído substitui os gates externos e a aprovação humana.

## 2. Objetivo e resultados esperados

Ao final do programa, o repositório deverá:

- representar com fidelidade, no control plane, o que está realmente implementado e comprovado;
- executar restore PostgreSQL com autoridade mínima e com prova adversarial de atomicidade, replay, concorrência e falhas ambíguas;
- ter telemetria limitada, sem identificadores brutos em dimensões e com lifecycle correto dos spans;
- reduzir a dependência de snapshots por meio de comandos autoritativos e transações explícitas;
- validar contratos de egress e limitar incrementalmente respostas de provedores;
- possuir suíte de qualidade semântica, cobertura, E2E estável e budgets de frontend;
- produzir imagens mínimas, reproduzíveis, rastreáveis e assináveis;
- disponibilizar logs duráveis, SLOs, alertas e evidência de recuperação;
- emitir evidências correntes e reproduzíveis para o mesmo fingerprint;
- separar de forma inequívoca conclusão local, gates externos e aprovação humana.

## 3. Escopo

### Incluído

- Os 39 achados enumerados no relatório de auditoria.
- Código, migrations forward-only, testes, scripts de verificação, CI e documentação necessários à remediação.
- Refatorações que preservem comportamento e reduzam o risco dos quatro arquivos monolíticos.
- Qualificação local e preparação automatizada para staging/produção.
- Atualização append-only do control plane quando a execução do programa começar.

### Fora do escopo sem nova autorização

- Deploy em produção.
- Uso, rotação ou exposição de credenciais reais.
- Operações destrutivas em bancos compartilhados.
- Compra de serviços, criação de contas ou aumento de custo externo.
- Aprovação humana substituída por decisão do agente.
- Reescrita destrutiva do histórico Git ou descarte das mudanças já existentes.

## 4. Invariantes do programa

1. **Verdade única:** durante a execução, `.agent` continua sendo a fonte canônica de status; estes documentos são especificação e proposta.
2. **Append-only:** itens já concluídos incorretamente são reabertos por evento corretivo, nunca apagados ou reescritos silenciosamente.
3. **Migrations forward-only:** migrations possivelmente aplicadas não são editadas; correções entram em nova migration monotônica.
4. **Menor privilégio real:** testes não podem fabricar permissões superiores às usadas pelo runtime.
5. **Known-bad e known-good:** correções críticas exigem reprodução anterior ou teste que falhe sem a correção e passe com ela.
6. **Mesmo sujeito:** evidências só qualificam o fingerprint exato do artefato testado.
7. **Sem falso verde:** `DONE`, `PASS` e aprovação somente após todos os critérios objetivos e evidências correntes.
8. **Preservação brownfield:** mudanças existentes pertencem ao usuário e não podem ser descartadas, sobrescritas ou “limpas” para facilitar o trabalho.
9. **Autoridade correta:** gates externos e humanos são registrados pelo executor, mas só suas autoridades legítimas podem aprová-los.
10. **Privacidade por desenho:** URLs, IDs clínicos, prompts, mensagens ou segredos não entram em dimensões de telemetria de alta cardinalidade.

## 5. Frentes de trabalho

| Frente | Resultado executivo | Itens do backlog |
|---|---|---|
| A. Governança e verdade operacional | Control plane reconciliado e evidências atribuíveis | 001, 007, 008, 030, 036 |
| B. Restore e integridade PostgreSQL | Menor privilégio, atomicidade e comportamento distribuído provados | 002–006 |
| C. Telemetria e limites de recursos | Cardinalidade e lifecycle controlados | 009–014 |
| D. Contratos e persistência autoritativa | Egress validado e snapshots substituídos por comandos | 015–020 |
| E. Qualidade e frontend | Lint, cobertura, E2E e budgets efetivos | 021–025 |
| F. Runtime e supply chain | Imagens mínimas, imutáveis e atestáveis | 026–028, 031 |
| G. Operação e resiliência | Logs duráveis, alertas, carga, caos e DR | 032–034 |
| H. Qualificação externa | Staging e aceite humano sem automação indevida | 035–036 |
| I. Manutenibilidade | Módulos menores, documentação e governança sustentáveis | 029–031 |

## 6. Sequenciamento executivo

O programa será executado em nove marcos, detalhados no [roadmap](./roadmap-melhorias-auditoria-2026-09-21.md):

1. reconciliar a verdade e congelar o baseline;
2. fechar autoridade e atomicidade de restore;
3. controlar telemetria e fronteiras externas;
4. migrar persistência e contratos;
5. fortalecer qualidade, E2E e frontend;
6. endurecer runtime e supply chain;
7. estabelecer operação observável e recuperação mensurável;
8. renovar evidências e executar qualificação repetida;
9. submeter gates externos e humanos.

O trabalho pode ser paralelizado apenas entre frentes sem dependência e com ownership de arquivos claramente separado. Restore, migrations e control plane devem permanecer serializados devido ao risco de conflito e à necessidade de uma única narrativa de evidência.

## 7. Governança da execução

### Papel do agente Codex

- descobrir o estado real antes de editar;
- registrar o baseline e preservar a árvore de trabalho;
- implementar tarefas na ordem das dependências;
- executar testes proporcionais ao risco após cada mudança;
- manter a rastreabilidade achado → tarefa → alteração → prova;
- atualizar o control plane somente com fatos verificáveis;
- parar em limites de autoridade externa ou humana.

### Papel humano

- decidir sobre trade-offs que mudem escopo, contrato público ou risco clínico;
- fornecer ambientes, contas e segredos quando apropriado;
- revisar resultados de staging, acessibilidade visual e risco residual;
- autorizar promoção.

### Cadência de decisão

- **Por tarefa:** critérios de aceite e teste focalizado.
- **Por marco:** regressão da frente, atualização de risco e evidência.
- **Antes da qualificação:** árvore limpa ou sujeito explicitamente congelado.
- **Para promoção:** duas execuções verdes do mesmo fingerprint, gates externos e aprovação humana.

## 8. Quality bar congelada

O programa não pode reduzir as garantias existentes. A barra mínima de saída é:

- typecheck, lint semântico, testes, build, catálogo de rotas, PDP e schema manifest aprovados;
- zero vulnerabilidades conhecidas acima do limite formal definido pelo projeto;
- thresholds de cobertura aprovados, com thresholds maiores para fronteiras críticas;
- restore PostgreSQL aprovado em matriz real de atributos e nos cenários adversos;
- telemetria sem crescimento proporcional a URLs/IDs únicos e sem spans órfãos;
- respostas externas limitadas durante streaming, não após buffering;
- E2E sem portas fixas frágeis e sem skip incondicional de WebKit;
- budgets de bundle, design tokens e contraste realmente bloqueantes;
- imagem de runtime compilada, mínima e sem fontes/ferramentas desnecessárias;
- SBOM e proveniência OCI gerados, verificáveis e associados ao digest;
- logs duráveis pesquisáveis, alertas exercitados, RTO/RPO medidos;
- documentação e evidências sincronizadas com o mesmo fingerprint;
- duas qualificações completas consecutivas aprovadas.

## 9. Estratégia de verificação por risco

| Risco | Known-bad exigido | Known-good exigido | Regressão mínima |
|---|---|---|---|
| Restore/roles | Role com cada atributo proibido e falha tardia | Rejeição/rollback íntegro sob role mínima | Integração PostgreSQL descartável + matriz completa |
| Concorrência/replay | Duplicidade, desconexão e estado não vazio | Estado terminal único e ledger íntegro | Testes concorrentes e crash/restart |
| Telemetria | Milhares de URLs/IDs distintos | Cardinalidade limitada por route template | Teste de carga unitário/integrado e abortos |
| Provedores/SSRF | Chunked infinito, oversized e DNS hostil | Corte incremental e resolução pública validada | Testes com servidor controlado e DNS stub |
| Persistência | Escritas concorrentes em snapshots | Comandos transacionais idempotentes | Migração, rollback lógico e equivalência |
| Supply chain | Tag mutável/artefato sem atestado | Digest, SBOM, proveniência e verificação | CI sobre imagem publicada em ambiente seguro |
| Operação | Falha sem log/alerta e restore lento | Evento pesquisável, alerta recebido, RTO/RPO registrados | Drill controlado e recibo imutável |

## 10. Riscos de execução e controles

| Risco | Probabilidade | Impacto | Controle |
|---|---|---|---|
| Alterar migration já aplicada | Média | Crítico | Descobrir estado e usar migration forward-only |
| Confundir worktree sujo com regressão própria | Alta | Alto | Inventário inicial, diffs escopados e ausência de comandos destrutivos |
| Refatoração monolítica ampliar o blast radius | Média | Alto | Extrair por seam, preservar API, testar antes e depois |
| Migração snapshot perder compatibilidade | Média | Crítico | Dual-read temporário quando necessário, backfill idempotente e reconciliação |
| Testes E2E continuarem flakey | Alta | Médio | Recursos efêmeros, isolamento de estado e repetição controlada |
| Evidência ficar obsoleta durante o programa | Alta | Médio | Gerar somente após congelar sujeito e registrar fingerprint |
| Gate externo ficar indisponível | Média | Alto | Concluir preparação local e marcar `BLOCKED_EXTERNAL`, sem falso verde |
| Escopo crescer sem controle | Média | Médio | Todos os achados mapeados; novos achados entram com ID, impacto e decisão |

## 11. Estimativa relativa e capacidade

Este é um programa de múltiplas iterações, não uma correção pontual. O backlog contém tarefas S, M, L e XL. A estimativa serve para planejamento relativo, não como promessa de calendário:

- **S:** alteração localizada, verificação focalizada e baixo blast radius;
- **M:** múltiplos arquivos ou nova automação, com testes de integração;
- **L:** mudança transversal, migration ou CI com qualificação dedicada;
- **XL:** migração de domínio ou prova operacional que exige várias entregas.

As tarefas XL de persistência devem ser quebradas em slices verticais sem alterar a definição de concluído do épico correspondente.

## 12. Métricas executivas

- achados abertos por severidade;
- tarefas concluídas com evidência corrente;
- porcentagem das 32 coleções com comando autoritativo;
- cardinalidade máxima por operação e quantidade de spans órfãos;
- cobertura global e das fronteiras críticas;
- taxa de flake E2E em repetições controladas;
- tamanho do bundle e da imagem de runtime;
- tempo de build e tamanho do contexto Docker;
- MTTD/MTTA de drills, RTO e RPO medidos;
- quantidade de execuções completas verdes do mesmo fingerprint;
- gates locais, externos e humanos separados por estado.

## 13. Critérios de encerramento

`CVG-AUD26` somente pode ser considerado concluído quando:

1. as 36 tarefas do backlog tiverem estado e evidência atualizados;
2. os 39 achados estiverem cobertos por implementação ou decisão formal aceita;
3. nenhum achado alto permanecer aberto;
4. todos os checks locais e CI estiverem verdes no mesmo fingerprint;
5. duas qualificações consecutivas do mesmo sujeito estiverem verdes;
6. os gates de staging, provedores, segredos, observabilidade e aceitação estiverem comprovados;
7. a aprovação humana de promoção estiver registrada;
8. uma reauditoria independente confirmar o novo score e o risco residual.

O score pretendido é consequência dessas garantias, não um critério substituto. Até lá, o status executivo continua **PROMOTION BLOCKED**.
