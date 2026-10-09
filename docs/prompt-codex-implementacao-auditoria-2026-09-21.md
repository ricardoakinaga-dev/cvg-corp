# Prompt copia e cola para Codex — execução do CVG-AUD26

Copie todo o conteúdo do bloco abaixo para um agente Codex aberto na raiz do repositório.

```text
Você está na raiz do repositório CVG-Corp. Sua missão é executar integralmente o programa de melhorias CVG-AUD26, com base na auditoria de 2026-09-21, até que todos os itens localmente executáveis estejam implementados e comprovados e que reste, no máximo, algum gate verdadeiramente externo ou humano claramente registrado.

FONTES OBRIGATÓRIAS

Leia integralmente, nesta ordem:

1. docs/auditoria-profunda-repositorio-2026-09-21.md
2. docs/plano-executivo-melhorias-auditoria-2026-09-21.md
3. docs/roadmap-melhorias-auditoria-2026-09-21.md
4. docs/backlog-melhorias-auditoria-2026-09-21.md
5. este arquivo de prompt
6. todas as instruções AGENTS.md aplicáveis, se existirem
7. README.md, docs/README.md, package.json, tsconfig.json, workflows de CI e o estado atual em .agent
8. planos, backlog, logs e evidências AUD25 relacionados aos itens reabertos

Use o skill engineering-framework porque este é um trabalho brownfield T4 com overlays SECURITY, MIGRATION e AUDIT. Use também skills especializados de backend/frontend quando uma decisão transversal realmente exigir, seguindo as instruções locais disponíveis. Não presuma que os documentos substituem o código ou o estado canônico: confirme tudo na árvore de trabalho atual.

OBJETIVO DE SAÍDA

- Implementar as 36 tarefas CVG-AUD26-001 a CVG-AUD26-036 e fechar os 39 achados F01 a F39.
- Preservar ou elevar as garantias existentes.
- Produzir rastreabilidade achado → tarefa → mudança → teste → evidência.
- Obter duas qualificações completas, limpas e consecutivas do mesmo fingerprint quando todos os pré-requisitos locais e externos estiverem disponíveis.
- Não declarar release aprovado. A aprovação final é humana.

AUTORIZAÇÃO E LIMITES

Você está autorizado a:

- inspecionar e modificar arquivos locais do repositório;
- criar código, testes, migrations forward-only, documentação e scripts;
- instalar dependências do projeto pelo gerenciador já adotado quando necessário e seguro;
- executar build, lint, testes, containers e bancos descartáveis locais;
- atualizar o control plane .agent de forma append-only e compatível com seu schema;
- criar artefatos locais de evidência sem incluir segredos ou dados pessoais.

Você NÃO está autorizado, sem instrução humana explícita, a:

- descartar, sobrescrever ou “limpar” mudanças existentes do usuário;
- usar git reset --hard, checkout destrutivo, clean, force push ou reescrever histórico;
- fazer push, abrir/mesclar PR, publicar imagem ou realizar deploy;
- acessar produção, banco compartilhado ou dados reais;
- criar/rotacionar/expor credenciais, aumentar custo ou contratar serviço;
- aprovar gates humanos, legais, clínicos ou externos em nome de alguém;
- editar migration que possa ter sido aplicada; use sempre uma migration posterior.

Se um passo exigir autoridade externa, conclua toda a preparação local, registre exatamente o que falta e use o estado BLOCKED_EXTERNAL ou BLOCKED_HUMAN previsto pelo schema/processo. Nunca use DONE ou PASS para contornar esse limite.

REGRAS INEGOCIÁVEIS

1. A árvore de trabalho já pode estar suja. Considere todas as mudanças preexistentes como pertencentes ao usuário. Comece com inventário e trabalhe por diffs escopados.
2. Não crie uma segunda fonte de verdade. Estes documentos são proposta/especificação; durante a execução, .agent é a fonte canônica de status.
3. Corrija falsos verdes por novos eventos append-only. Não apague nem reescreva silenciosamente o histórico de AUD25.
4. Não marque uma tarefa DONE sem satisfazer todos os critérios de aceite e registrar evidência corrente.
5. Mudança crítica exige known-bad e known-good: o teste deve demonstrar a falha sem a correção e o sucesso com ela.
6. Evidência só vale para o fingerprint exato. Toda mudança posterior invalida a qualificação anterior quando afetar o sujeito.
7. Migrations são forward-only. Descubra o estado da migration 044 e crie a próxima migration monotônica para qualquer correção; não altere a 044 como solução de upgrade.
8. Testes de menor privilégio não podem conceder privilégios artificiais apenas para passar.
9. Não reduza thresholds, checks ou cobertura para fabricar verde. Exceções precisam de justificativa, owner e expiração.
10. Nunca exponha PHI, IDs, URLs brutas, prompts, tokens ou segredos em logs, métricas, spans ou artefatos.
11. Use bancos e serviços locais descartáveis para testes destrutivos. Valide o alvo antes de qualquer cleanup.
12. Preserve interfaces públicas sempre que possível; mudanças de contrato exigem migração explícita e testes dos consumidores.

MODO DE EXECUÇÃO

Trabalhe de forma autônoma e persistente pelo roadmap e pela DAG do backlog. Para cada tarefa:

1. UNDERSTAND: leia o código, contrato, testes e histórico relacionado.
2. REPRODUCE: crie ou execute o known-bad quando aplicável.
3. PLAN: confirme dependências, blast radius, migrations e arquivos que serão alterados.
4. IMPLEMENT: faça a menor mudança coesa que cumpra todo o contrato da tarefa.
5. VERIFY: rode testes focados, regressão da área e checks de segurança/migração apropriados.
6. RECORD: atualize .agent de forma append-only com comandos, resultados, artefatos, fingerprint e risco residual.
7. CONTINUE: siga para a próxima tarefa desbloqueada sem pedir confirmação rotineira.

Faça checkpoints ao final de cada tarefa e marco. Se houver compactação/interrupção, retome do estado canônico, confirme o fingerprint e não refaça trabalho já comprovado.

ORDEM OBRIGATÓRIA

Marco M0 — verdade operacional

- Execute CVG-AUD26-001 primeiro.
- Inventarie tracked/untracked, toolchain, migrations e baseline.
- Verifique objetivamente AUD25-002 e AUD25-003; se os critérios seguirem incompletos, reabra-os por evento corretivo.
- Importe CVG-AUD26 no schema vigente de .agent, mantendo PROMOTION BLOCKED.

Marco M1 — restore e PostgreSQL

- Execute CVG-AUD26-002 a 006 em ordem.
- Feche os sete atributos relevantes da role, incluindo NOCREATEDB, NOCREATEROLE e NOREPLICATION.
- Use migration forward-only.
- Expanda a matriz real de atributos, memberships, ownership e grants.
- Remova GRANT ALL, CREATE e ownership artificiais do verificador.
- Prove falha tardia/rollback, replay, concorrência, base não vazia, desconexão e outcome unknown.

Marco M2 — telemetria e integrações

- Execute CVG-AUD26-009 a 014.
- Troque URL bruta por route template/operação estável e imponha budget de cardinalidade.
- Feche spans idempotentemente em response, error, abort, timeout e close.
- Adicione lifecycle aos buckets de rate limit.
- Implemente leitura incremental com limite e cancelamento para modelos e mensageria.
- Endureça DNS/SSRF e redirects com testes controlados.

Marco M3 — contratos e persistência

- Execute CVG-AUD26-015 e depois 016 a 020.
- Valide respostas da API em runtime antes do egress.
- Crie ADR/harness de migração snapshot → comando.
- Migre todas as coleções snapshot-primary em slices verticais, com backfill idempotente, concorrência, replay, autorização e reconciliação.
- Não remova caminhos legados antes de demonstrar equivalência e uma transição segura.

Marco M4 — qualidade e frontend

- Execute CVG-AUD26-021 a 025 e 029, coordenando refatorações com as alterações funcionais para reduzir conflitos.
- Adote ESLint semântico e scanner de segredos dedicado.
- Meça cobertura e imponha thresholds.
- Elimine portas E2E fixas frágeis, isole estado, corrija o flake tablet e habilite WebKit real.
- Divida o bundle e imponha budgets.
- Faça tokens strict e contraste renderizado bloquearem regressões reais.
- Modularize persistence, API, domain e contracts por seams, com testes de caracterização; evite reescrita big-bang.

Marco M5 — runtime e supply chain

- Execute CVG-AUD26-026 a 028 e 031.
- Crie .dockerignore seguro, compile API/worker e use imagem final mínima, não root e sem tsx/fontes desnecessários.
- Pine bases por digest com processo de atualização.
- Gere SBOM/proveniência OCI e implemente assinatura/verificação onde houver autoridade de CI; prepare e marque o gate externo corretamente caso publicação não esteja disponível.
- Fixe packageManager, crie arquivos de governança e endureça TypeScript. Conteúdo legal/licença exige validação humana quando não houver decisão prévia.

Marco M6 — operações e DR

- Execute CVG-AUD26-032 a 034.
- Configure logs duráveis com retenção, controle de acesso, redaction e correlação.
- Defina SLIs/SLOs, alertas, runbooks e drills.
- Faça carga, caos e restore em ambiente representativo e meça RTO/RPO. Se infraestrutura equivalente não estiver disponível, entregue harness, instruções, validações locais e marque somente a parte externa como bloqueada.

Marcos M7 e M8 — evidências e qualificação

- Execute CVG-AUD26-007 e 030: diagnósticos completos, documentação coerente, hashes e freshness atuais.
- Congele o sujeito e execute CVG-AUD26-008.
- Execute CVG-AUD26-035 para staging/provedores/segredos/collector/AT/zoom manual com as autoridades corretas.
- Finalize CVG-AUD26-036 com reauditoria dos 39 achados e pacote para decisão humana.

VERIFICAÇÃO

Descubra os scripts atuais no package.json e adapte os comandos à implementação real. Como baseline, considere executar nos marcos apropriados:

- npm run typecheck
- npm run lint
- npm test
- npm run build
- npm run verify:pdp
- npm run verify:control-plane
- npm run verify:schema-manifest
- npm run verify:static
- npm run test:e2e
- npm run verify:production
- npm audit --include=dev
- verificações de licença, contraste e design tokens existentes
- verificadores PostgreSQL em instância descartável
- scanners, cobertura, budgets, SBOM, proveniência e containers criados pelo programa

Não rode a suíte cega em toda microalteração: use teste focalizado primeiro e regressão progressiva. Antes da qualificação final, rode o conjunto completo em ambiente limpo/isolado e preserve logs integrais. Resolva colisões de porta com alocação segura, não encerrando processos desconhecidos do usuário.

CONTRATO DE EVIDÊNCIA

Cada tarefa concluída deve registrar:

- ID da tarefa e achados cobertos;
- resumo da mudança e arquivos afetados;
- known-bad/known-good quando aplicável;
- comandos exatos, exit codes e resultados;
- caminho dos artefatos/receipts;
- fingerprint do sujeito e ambiente/toolchain;
- riscos residuais, exceções e autoridade necessária;
- próxima tarefa desbloqueada.

Não inclua artefatos enormes no Git sem necessidade; mantenha manifestos/receipts pequenos e use armazenamento adequado quando previsto. Nunca grave segredos.

CRITÉRIO DE PARADA

Não pare apenas porque a tarefa é longa. Continue enquanto houver trabalho local seguro e desbloqueado. Pare somente quando:

A) todas as 36 tarefas estiverem comprovadamente concluídas, duas qualificações do mesmo fingerprint estiverem verdes e a decisão humana tiver sido registrada; ou

B) todo o trabalho local possível tiver sido concluído e o restante depender exclusivamente de autoridade/infraestrutura externa ou aprovação humana. Nesse caso, entregue uma matriz precisa de bloqueios, comandos/runbooks prontos, evidência já obtida, responsável esperado e condição objetiva de desbloqueio.

FORMATO DA ENTREGA FINAL

Entregue em português:

1. veredito atual e scores recalculados;
2. tarefas concluídas, bloqueadas e pendentes por prioridade;
3. matriz completa F01–F39 com estado e evidência;
4. mudanças principais por área;
5. migrations e compatibilidade de upgrade;
6. testes/checks executados com resultado e fingerprint;
7. riscos residuais e exceções;
8. gates externos/humanos ainda necessários;
9. recomendação explícita PROMOTE ou PROMOTION BLOCKED, deixando claro que a autoridade final é humana.

Comece agora por CVG-AUD26-001. Não peça confirmação para inspeções, edições locais reversíveis, testes ou outras ações já autorizadas. Se surgir uma decisão que mude materialmente escopo, contrato público, risco clínico/legal ou exija ação externa, apresente evidência e solicite apenas essa decisão específica.
```
