# Ajuste da detecção de senhas em prosa

## Resultado funcional

A lista crescente de palavras de exceção foi removida. Em prosa sem aspas,
o filtro agora exige sinais no valor: dígitos, símbolos que não sejam simples
pontuação terminal de frase, ou transições internas de minúscula para maiúscula.
Uma palavra em maiúsculas ou com apenas inicial maiúscula não basta. Valores
entre aspas e atribuições explícitas conservam suas verificações anteriores.

As cinco frases do relatório sobre importância, armazenamento, rotação,
expiração e gerenciamento de senhas são aceitas na admissão HTTP e preservadas
no contexto. Os três novos casos de credencial — possessivo `senha dele é`,
`password is:` e o exemplo de dois fragmentos separados por espaço — são
detectados pela mesma regra utilizada na admissão e montagem de contexto.
Os testes compartilhados também verificam execução direta e retomada por
aprovação, sem despacho, persistência de IA ou consumo de aprovação na recusa.

O segundo fragmento é apenas observado; não é consumido pela busca. Uma frase
legítima não mascara uma senha posterior. A busca não percorre uma frase
inteira à procura de números distantes que possam falar de política de senha.

## Quarentena e HTTP

O percurso foi inspecionado: o kernel captura o erro da montagem de contexto,
e o runtime converte a retenção do objetivo em `QUARANTINED` com aviso fixo.
Nos testes HTTP, as variantes sem ferramenta e com ferramenta inicial
devolvem **201**, sem chamada ao modelo ou efeito da ferramenta. O replay
devolve **200** e mantém o aviso. Os nomes internos
`TASK_OBJECTIVE_QUARANTINED` e `CONTEXT_BUILD_FAILED` não aparecem no corpo HTTP.
Não houve alteração do runtime nem do domínio/MFA nesta tarefa.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| Regressões novas antes da alteração | 88 testes: 33 passaram, 55 falharam; inclui subtestes e falhas dos testes-pai |
| Seis arquivos focais depois da alteração | 208 passaram; nenhuma falha ou teste ignorado |
| TypeScript, lint, build e arquitetura | Passaram |
| Primeira suíte completa, junto com build | 942 testes: 939 passaram, dois falharam, um foi ignorado |
| Mensageria em execução isolada, sem alterações | Passou |
| Suíte completa repetida sem build simultâneo | 942 testes: 940 passaram, um falhou, um foi ignorado |
| Scanner de segredos no código final | Passou no histórico Git e na árvore atual; código de saída 0 |

A falha adicional da primeira suíte foi `OUTCOME_UNKNOWN` em vez de
`DELIVERED` no teste loopback de mensageria. O verificador usa prazo de 500 ms;
o cenário passou isoladamente e na reexecução completa sem mudar código nem
limiar. Isso é compatível com sensibilidade a temporização/carga, mas a causa
não foi conclusivamente demonstrada. O resultado inicial permanece preservado.

A falha restante da suíte está em `tests/unit/control-plane-aud23.test.ts:141`:
`COMPOSITE_EXIT_DIVERGENT` e seis `FINGERPRINT_DIVERGENT`. O recibo anterior
inconsistente e a qualificação das fontes alteradas continuam pendentes.
Nenhum verificador, recibo histórico ou requisito de liberação foi modificado.

`initial-checks.json`, `general-checks.json`, `provider-recheck.json` e
`full-tests-recheck.json` registram os comandos, horários, códigos de saída e
hashes dos logs. `secret-scan.json` registra a execução real do scanner e os
hashes das fontes; os bytes permaneceram iguais durante a execução.

## Scanner: execução local e limites

O script existente executa Gitleaks em Docker com `--network=none`, repositório
somente leitura e saída redigida com `--redact`. A inspeção confirmou endpoint
Docker local e imagem fixada já disponível. O script não chama serviços da
OpenAI nem envia o repositório a uma API externa. O bloqueio informado na
entrega anterior era da chamada de ferramenta, não um achado do scanner.

Nenhuma configuração do scanner foi alterada. O PASS utiliza as exceções já
existentes do repositório para `generic-api-key` em determinados caminhos e
a exclusão de `dist/`. Essas exceções limitam o significado do PASS: ele não
comprova ausência universal de segredos. Detalhes em `scanner-inspection.md`.

## Revisão e limitações

O parecer independente desta alteração está aguardando integração. Os pareceres
das rodadas anteriores não são apresentados como aprovação do código novo.

A detecção continua **heurística**. Palavras comuns sem aspas, passphrases
somente alfabéticas, valores abaixo do mínimo existente de seis caracteres e
outras formas de linguagem podem passar. Uma combinação de dois fragmentos
também pode ser ambígua. O ajuste prioriza os casos especificados e reduz
falsos positivos de prosa; não substitui controle, minimização e redação de
segredos na origem. Os testes não qualificam produção ou concorrência
PostgreSQL. Não houve implantação, alteração de dependências ou commit.

## Continuação verificada em 04/10/2026

O parecer independente desta etapa encontrou PROSE-IR-1 e PROSE-IR-2; suas
correções e a reavaliação estão em `review-fixes-2026-10-04/resultado.md`.
O novo sujeito passou 227 testes focais e o scanner final. A suíte completa
registrou 961 testes: 959 passaram, uma falha de controle de evidências e um
ignorado. A revisão independente aprovou os dois achados dentro do recorte
testado. Os números e pendências anteriores acima permanecem como histórico.
