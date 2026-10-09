# Revisão própria separada — correções do detector

Esta revisão foi feita pelo implementador após o patch e a execução das
regressões. Não é o parecer independente do detector.

## Critérios e resultado observado

- **D1 — frases legítimas:** os cinco exemplos da revisão foram preservados nos
  dois pontos de detecção, também em maiúsculas. Senhas antes ou depois da frase,
  atribuições e palavras descritivas entre aspas continuam sinalizadas. Os cinco
  exemplos também chegaram ao modelo sintético pelo handler HTTP, sem retenção.
- **D2 — custo de busca:** a busca começa pelo delimitador literal `://` e só
  então valida o esquema anterior. Barras delimitam os trechos de credenciais e
  a inspeção retroativa. Não há truncamento do texto nem limite artificial no
  tamanho do esquema. Os testes preservam esquemas personalizados, esquemas
  longos e uma credencial ao fim de entradas extensas.
- **Regressão executável:** oito testes novos falharam seis vezes antes da
  correção, incluindo todos os cinco falsos positivos e o limite de CPU. Todos
  passaram depois. A mediana de CPU das duas verificações juntas em 32 KiB
  caiu de 1.131,87 ms para 0,684 ms no teste focal desta máquina.
- **Quarentena do contexto:** os testes do conjunto maior verificam aviso no
  resultado HTTP e no replay, contadores sem valores sensíveis, histórico de
  ferramenta retirado da entrada do modelo e ausência do aviso no conteúdo do
  rascunho clínico. A retenção do objetivo interrompe o turno antes do modelo
  ou da ferramenta inicial. Esses fluxos foram implementados na etapa anterior
  e revalidados nesta continuação.
- **MFA:** o código de domínio e os testes de bloqueio da conta permaneceram
  inalterados nesta continuação; a suíte focal os executou novamente.

## Limites

O vocabulário de descrições de senha continua finito. Uma palavra ambígua sem
aspas pode ser uma descrição legítima ou a própria senha; regex e exceções não
resolvem essa ambiguidade universalmente. A inspeção continua usando os limiares
de tamanho existentes. Ela não substitui minimização, controle de acesso ou
remoção de segredos na origem.

Os resultados usam dados sintéticos, handlers reais e armazenamento em memória.
Não houve teste visual de navegador, provider externo, PostgreSQL distribuído,
implantação ou limpeza de dados antigos. Tempos são observações locais, não SLA.

## Verificações gerais

177 testes focais passaram. Build com TypeScript, lint, arquitetura, scanner de
segredos e diff passaram. A suíte completa executou 911 testes: 909 passaram,
um falhou e um foi ignorado. A falha continua em
`tests/unit/control-plane-aud23.test.ts:141`, com
`COMPOSITE_EXIT_DIVERGENT` e seis `FINGERPRINT_DIVERGENT`.
O verificador e os recibos históricos não foram alterados.

O parecer independente original solicitou mudanças; sua nova avaliação deve
ser lida em `independent-recheck.md` quando concluída. Esta revisão própria
não antecipa o veredito dessa avaliação.

## Adendo após a reavaliação

O revisor confirmou D2 e os cinco exemplos originais de D1, mas encontrou
dois casos com dois-pontos e uma palavra descritiva adicional. Quatro testes
reproduziram esses casos; a normalização foi corrigida sem alterar valores
entre aspas ou atribuições. Os testes finais foram repetidos individualmente:
184 focais passaram e a suíte completa teve 918 casos, 916 aprovados, uma
falha de controle de evidências e um ignorado. Build/TypeScript, lint e
arquitetura passaram. A execução final do scanner foi bloqueada pela ferramenta.

A revisão independente final da pontuação registrou 58 casos / 232 chamadas
sem falhas, com identidade do código e limites no seu próprio parecer. Ela
não avaliou o runtime nem reexecutou o benchmark de URL, já coberto pelo
parecer independente anterior. O resultado vigente está em `resultado.md`.
