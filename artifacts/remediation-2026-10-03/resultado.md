# Correções locais de segurança — 03/10/2026

## Resultado

Implementadas as correções locais dos achados **SEC-AI-01** e **SEC-AI-02**.
Os testes das alterações passaram. A suíte completa ainda reprova o controle
de evidências da auditoria; este trabalho não libera uma versão para produção.

### SEC-AI-01 — conteúdo sensível no contexto da IA

A reprodução inicial mostrou que uma credencial fictícia era removida da
conversa, mas reaparecia no objetivo da tarefa como conteúdo confiável de
classe D0. O provedor recebia o conteúdo e o histórico armazenava o prompt.

O objetivo agora passa pelo mesmo filtro como entrada do usuário, de classe
D2. Conteúdo reconhecido pelo detector como segredo é retirado também das
cópias em resultados de ferramentas, mensagens anteriores e dados de negócio.
A aplicação e o runtime embarcado recusam prompts com esses sinais antes de
registrar comandos, criar estado de IA ou chamar ferramentas/modelos. Isso
inclui a rota de retomada por aprovação. A resposta explica a recusa sem
repetir o texto sensível. Solicitações válidas mantêm idempotência e replay.

A API passou a declarar sua dependência do pacote já existente
`@cvg/agent-context`. O lockfile foi regenerado offline, sem scripts de
instalação nem novas dependências de terceiros; o npm também sincronizou o
campo de licença que já existia no manifesto raiz.

### SEC-AI-02 — desafio MFA invalidado durante a verificação

O consumo do desafio agora consulta novamente o usuário e o desafio
armazenados. Além do estado pendente, exige usuário ativo, mesma versão de
credencial e prazo ainda válido. Essa checagem ocorre depois da espera pelo
resolver MFA, sem uma nova espera entre consumo e criação da sessão.

Os testes exercitam login válido, replay, duas verificações concorrentes,
troca de senha, expiração, desativação do usuário, bloqueio por tentativas e
alteração da cópia do desafio pelo chamador. As recusas não emitem cookies nem
novas sessões.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Reprodução HTTP inicial da falha de IA | Confirmada com dados fictícios; `context-before.log` |
| Regressões de contexto/HTTP antes da correção | 13 testes: 7 passaram e 6 falharam; `context-regression-before.log` |
| Contexto e runtime após a correção | 37 passaram; `context-tests.log` |
| HTTP, incluindo teste adicional de retomada | 3 passaram; `http-tests.log` |
| MFA | 7 passaram; `mfa-tests.log` |
| Suíte completa, incluindo todos os testes acima | **779 testes: 777 passaram, 1 falhou, 1 ignorado** |
| Build, incluindo TypeScript | Passou |
| Lint | Passou |
| Verificação de arquitetura | Passou |

Foram adicionados 14 testes. Os testes focais somam 45 casos distintos; parte
deles aparece em mais de uma execução da tabela. O primeiro typecheck apontou
uma assinatura incorreta no observador do modelo usado pelo teste; ela foi
corrigida e a compilação TypeScript do build posterior passou. Dois testes
HTTP também precisaram serializar os valores BigInt presentes no estado de
teste. Os logs anteriores permanecem como histórico.

`integrated-checks.json` registra comandos, códigos de saída, horários e hashes
dos logs de build, lint, arquitetura e suíte completa.

## Pendências e limites

A falha em `tests/unit/control-plane-aud23.test.ts:141` reúne o recibo anterior
incoerente (`COMPOSITE_EXIT_DIVERGENT`) e fingerprints que não correspondem ao
código agora alterado. O recibo antigo já era um achado da auditoria. Os novos
erros de fingerprint indicam a necessidade de qualificar o código modificado;
não são apresentados como falhas preexistentes. Não foram alterados o
verificador, os registros históricos ou os critérios de liberação.

O agente de implementação MFA salvou o patch e os testes, mas terminou com
timeout. O responsável principal revisou esses arquivos e executou os testes.
A tentativa separada de revisão independente também terminou com timeout e
não produziu parecer. Portanto, **não há aprovação independente** nesta entrega.

Uma execução adicional, que restauraria o método MFA antigo somente em um
processo de teste descartável, foi bloqueada pela revisão automática da
ferramenta: ela não conseguiu determinar a segurança da solicitação. Essa
execução **não ocorreu**; não há resultado novo de regressão MFA contra o
método antigo. A reprodução anterior da auditoria não foi refeita por esse meio.

Os testes usam dados sintéticos e armazenamento em memória. Não estabelecem
garantias sobre concorrência entre processos PostgreSQL, provedores reais ou
produção. O detector de segredos continua heurístico: esta correção elimina os
caminhos de escape dos sinais reconhecidos, sem afirmar detectar qualquer
segredo. Não houve limpeza retroativa de dados nem implantação.

## Continuação

Reconciliar o recibo antigo de forma append-only, qualificar novamente o
fingerprint do código e obter revisão independente. O próximo achado funcional
de segurança registrado é **SEC-AI-03**, sobre a associação entre a chave de
assinatura e o provedor do webhook.
