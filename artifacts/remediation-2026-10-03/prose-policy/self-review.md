# Revisão própria separada da implementação

## Critérios e inspeção

A implementação substituiu a lista de descrições por um predicado de formato
do valor sem aspas. Dígitos, símbolos que não sejam simples pontuação de frase
e transições internas de minúscula para maiúscula são sinais heurísticos.
Palavras inteiramente em maiúsculas ou com apenas inicial maiúscula não são
consideradas credenciais por isso. Os padrões de atribuição e valores entre
aspas preservam o sinal explícito, inclusive para palavras comuns.

Os dois padrões de prosa usam o mesmo predicado e a mesma função de inspeção
que a admissão. A continuação opcional com segundo fragmento é um lookahead:
não consome o início de uma eventual próxima declaração de senha. Não há
exceção aplicada ao prompt inteiro. O mínimo de seis caracteres permanece,
com contagem combinada para o caso simples de dois fragmentos.

Foram inspecionados o `catch` de construção de contexto em `AgentKernel.run`
e a conversão de `runState.taskQuarantined` para status `QUARANTINED` e aviso
fixo no runtime. O erro interno é capturado; não é lançado diretamente pelo
handler HTTP no percurso exercitado. Os testes reais `app.inject` observam
HTTP 201 nas variantes sem ferramenta e com ferramenta inicial, ausência
de despacho, ausência de nomes internos de erro no corpo e replay HTTP 200.
Isso não promete que qualquer outra falha de infraestrutura nunca produza 5xx.

Os hashes confirmaram que domínio/MFA, runtime e script do scanner não foram
modificados nesta tarefa. A revisão não alterou critérios do controle AUD23.

## Evidência e limites

`regression-before.json` preserva a execução dos testes antes da correção.
`initial-checks.json` contém os 208 testes focais aprovados, TypeScript e lint.
Os resultados gerais e a investigação da falha de mensageria ficam nos logs
e JSONs próprios; a execução anterior não é apagada por uma reexecução.

A detecção deliberadamente pode não reconhecer palavras simples sem aspas,
passphrases somente alfabéticas, valores curtos e outras formas de linguagem.
Pontuação terminal isolada não serve como evidência de segredo. A combinação
de dois fragmentos também é ambígua e pode produzir falsos positivos em outras
frases. A mudança resolve o corpus e os formatos especificados; não comprova
detecção universal nem substitui minimização/redação de dados na origem.

Esta revisão foi feita pelo implementador. O parecer independente desta
iteração, quando produzido, é `independent-review.md` e deve ser interpretado
somente dentro do escopo e identidade de fontes que ele registrar.
