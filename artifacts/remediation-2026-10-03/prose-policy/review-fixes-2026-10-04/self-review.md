# Revisão própria separada — PROSE-IR-1 / PROSE-IR-2

Data: 04/10/2026. Revisão realizada pelo implementador após a correção e os
testes; não é o parecer independente.

## Inspeção dos critérios

PROSE-IR-1: os padrões agora consomem somente a introdução da frase. Os valores
são capturados por lookahead, inclusive o primeiro fragmento. Quando o valor é
rejeitado, uma introdução que comece naquele fragmento continua pesquisável.
Cada ocorrência consumida tem comprimento positivo; não há reposicionamento
do cursor para trás nem mudança no iterador dos outros sinais. Os três casos
da revisão e dois equivalentes imperativos entraram no corpus compartilhado,
exercitado pela admissão HTTP, contexto, runtime direto e retomada de aprovação.

PROSE-IR-2: a remoção da pontuação percorre apenas o sufixo de trás para frente.
Uma letra após uma sequência extensa de pontuação encerra essa remoção na
primeira inspeção. O mesmo helper é aplicado ao primeiro e segundo fragmentos,
preservando exatamente os quatro caracteres ASCII anteriores. Não há limite
artificial de entrada, corte de texto ou alteração da política heurística.

Os testes verificam três famílias em subprocessos limitados a 20 segundos:
pontuação no primeiro fragmento, no segundo e introduções sobrepostas repetidas.
Usam medianas de CPU e critérios de crescimento, além das decisões dos dois
exports. Os casos longos preservam credenciais posteriores e palavras entre
aspas. O teste antigo de escalabilidade de URLs também foi reexecutado.

## Evidência observada

Os seis testes selecionados antes do patch falharam. Depois, 227 testes focais
passaram, sem falhas ou ignorados. No caso original com 32.781 caracteres,
a mediana de CPU para o par de exports caiu de 1.549,476 ms para 1,013 ms.
São observações locais; não representam SLA nem prova geral de complexidade.

TypeScript, lint, build e arquitetura passaram. A suíte completa teve 961
testes: 959 passaram, um falhou e um foi ignorado. A falha é a validação do
controle AUD23, com recibo inconsistente e seis fingerprints divergentes.
Esse verificador e os registros históricos não foram alterados.

## Limites

Permanecem as ambiguidades já documentadas da política de formato de valor:
palavras simples sem aspas, passphrases somente alfabéticas, valores curtos,
espaços Unicode e gramática não coberta. Esta continuação resolve os dois
defeitos de implementação relatados, sem afirmar detecção universal. Não houve
alteração de MFA, runtime, configuração do scanner, dependências ou implantação.
O parecer independente e a execução final do scanner têm registros separados.
