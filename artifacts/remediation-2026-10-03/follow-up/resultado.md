# Complemento da remediação de segurança — 03/10/2026

## Alterações

O detector compartilhado de credenciais foi ampliado para atribuições em texto,
JSON com chaves entre aspas, nomes em camelCase e variáveis de ambiente; senhas,
tokens de acesso/renovação e segredos de cliente; autorização Bearer/Basic;
prefixos de tokens de API; JWT; blocos de chave privada; e URLs com credenciais.
A matriz final contém 28 casos sintéticos e nove controles sem segredo,
incluindo senhas com aspas incompletas e campos com prefixo.

Os testes verificam a mesma matriz na montagem de contexto, entrada HTTP,
execução direta do runtime e retomada por aprovação. Conteúdo reconhecido não
chega ao modelo nem aparece nos registros de IA ou nas respostas de erro. As
cópias em tarefa, conversa, ferramenta, recuperação de documentos e contexto
de negócio são removidas. As recusas preservam o estado de aprovações e os
recibos de comandos; prompts normais continuam com idempotência e replay.

O MFA agora consulta o bloqueio da conta tanto na busca do desafio quanto no
consumo após a espera pelo resolver. As verificações usam o usuário armazenado,
inclusive `security.lockedUntil`, sem uma nova espera antes da criação da sessão.
Uma conta bloqueada não recebe sessão/cookies e seu bloqueio não é apagado.
O bloqueio do desafio por códigos errados e o bloqueio da conta por tentativas
de senha são cobertos separadamente.

Foram acrescentados testes para bloqueio da conta antes e durante a verificação,
usando falhas reais do handler HTTP de login, além de controles para preservar
desafios de recuperação e permitir um desafio pendente após o fim do bloqueio.

## Evidências executadas

| Verificação | Resultado |
| --- | --- |
| Regressões antes da correção | 77 testes: 27 passaram e 50 falharam, incluindo o teste pai dos subtestes HTTP; os dois cenários de conta bloqueada reproduziram a falha |
| Três casos adicionais encontrados na revisão manual | Os três falharam antes do ajuste; `edge-before.log` |
| Quatro arquivos de testes focais na versão final | 107 passaram, nenhum falhou ou foi ignorado |
| TypeScript | Passou; também executado pelo build final |
| Lint final | Passou |
| Build | Passou |
| Verificação de arquitetura | Passou |
| Scanner de segredos do histórico e árvore atual | Passou |
| `git diff --check` | Passou |
| Suíte completa final | 841 testes: 839 passaram, um falhou e um foi ignorado |

`regression-before.log` e `regression-before-sources.sha256` preservam a
reprodução anterior. `focused-checks.json` e `integrated-checks.json` preservam
as rodadas intermediárias. **`final-checks.json` registra a versão final**, com
comandos, códigos de saída, horários, hashes dos logs e dos sete arquivos de
código/teste do complemento. Os logs finais usam o prefixo `final-`. O primeiro lint
encontrou um escape desnecessário na expressão regular; o escape foi removido
e o lint final passou.

## Falha geral preservada

A falha restante está em `tests/unit/control-plane-aud23.test.ts:141`. O teste
encontrou `COMPOSITE_EXIT_DIVERGENT` e seis ocorrências de
`FINGERPRINT_DIVERGENT`, quando esperava um baseline sem achados. O recibo
inconsistente já constava do relatório anterior. Os fingerprints precisam de
requalificação para o código modificado; não são apresentados como evidência
válida desta versão. Nenhum verificador, recibo histórico ou critério de
liberação foi alterado para obter um resultado verde.

## Revisão e limites

A revisão independente deste complemento terminou com o erro
`stream disconnected before completion: ChatGPT browser stage timed out: send`.
O agente não escreveu parecer; portanto, não há aprovação independente.

Uma revisão manual posterior, feita pelo próprio implementador, encontrou
três casos de borda: JSON incompleto, senha com aspas incompletas e nome de
campo com prefixo. Os três foram reproduzidos em testes, corrigidos e incluídos
em todos os pontos exercitados pela matriz compartilhada. A expressão de
atribuição passou a aceitar colagens parciais e a preservar os prefixos sem a
repetição de grupos usada na primeira versão. A suíte focal e as verificações
gerais foram executadas novamente após esse ajuste. Esta revisão é própria,
não independente, e não concede aprovação de produção.

Os testes usam dados sintéticos, handlers reais e armazenamento em memória.
Não qualificam concorrência entre processos PostgreSQL, provedores externos ou
produção. O detector permanece heurístico: a matriz comprova os formatos
cobertos, não a detecção universal de qualquer segredo. Não houve implantação,
limpeza retroativa de dados, alteração de dependências ou commit.

Duas leituras em lote foram recusadas pela revisão automática da ferramenta
por indeterminação de segurança. Elas não foram executadas; inspeções pontuais
subsequentes forneceram os trechos usados nesta verificação.
