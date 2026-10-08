# SEC-AI-01 — correções do relatório e da revisão independente

## Implementação e escopo verificado

O detector compartilhado reconhece os formatos apontados no relatório:
senhas nas construções em prosa testadas em português e inglês,
`AWS_SECRET_ACCESS_KEY`, identificadores `AKIA`/`ASIA`, prefixos `xox*` e `AIza`,
Basic sem o cabeçalho Authorization e atribuições com `segredo`. Uma saída
isolada `pwd: /caminho` deixa de ser tratada como senha; credenciais em outras
linhas continuam sendo inspecionadas. O corpus compartilhado atual contém
53 entradas positivas sintéticas e 29 negativas. Esses números descrevem
exemplos testados, não uma medida de cobertura universal.

A revisão independente encontrou cinco falsos positivos em frases legítimas
e custo quadrático na expressão de URL. Nesta continuação, as cinco frases
passaram a ser aceitas, inclusive pelo handler HTTP. As exceções se aplicam a
cada candidato em prosa: não liberam o restante da entrada, palavras entre
aspas nem atribuições explícitas. A detecção de URL agora procura `://` antes
de validar o esquema precedente. Esquemas personalizados, esquemas extensos e
credenciais ao fim de textos longos permanecem cobertos pelos testes.

Na etapa anterior desta mesma tarefa, a quarentena ganhou aviso persistido na
resposta e no replay e contadores agregados sem conteúdo sensível. A retenção
do objetivo interrompe o turno antes de modelo ou ferramenta inicial. Os
testes também verificam histórico de ferramenta, idempotência e separação entre
o aviso e o conteúdo do rascunho clínico. Esses comportamentos foram revalidados.

O bloqueio de conta no MFA não sofreu nova alteração e seus testes passaram.
Um erro de inferência de tipo no teste de histórico foi corrigido declarando
o contrato `AiTurnInput`; o build agora passa.

## Validação final

| Verificação | Resultado |
| --- | --- |
| Novas regressões antes do ajuste | 8 testes: 2 passaram e 6 falharam; cinco frases e o limite de CPU reproduzidos |
| Regressões adicionais de pontuação antes do ajuste | 4 testes, todos reproduziram a falha |
| Testes focais finais | 184 passaram; nenhuma falha ou caso ignorado |
| TypeScript e build | Passaram |
| Lint e arquitetura | Passaram |
| Scanner de segredos | Passou na rodada anterior; a tentativa após o último ajuste foi bloqueada pela ferramenta e não executou |
| Verificação do diff | Passou |
| Suíte completa final | 918 testes: 916 passaram, 1 falhou e 1 foi ignorado |

No teste local, a mediana de CPU das duas APIs de detecção juntas, para o
mesmo texto de 32.768 caracteres, foi de **1.131,87 ms antes** e **0,738 ms
depois** na execução final. O teste roda em subprocesso com prazo de execução, mede quatro
tamanhos e verifica CPU e crescimento. Não é uma garantia de latência em produção.

`before-check.json`, `before.log`, `focused-checks.json` e
`integrated-checks.json` preservam as rodadas anteriores. Os logs com prefixo
`closure-` registram os comandos finais executados individualmente.
`verification-summary.json` reúne os resultados atuais e a identidade das
fontes após as verificações. Os resultados antigos foram preservados, inclusive
o build anterior que falhou.

## Falha geral e revisão

A falha restante é `tests/unit/control-plane-aud23.test.ts:141`: um
`COMPOSITE_EXIT_DIVERGENT` e seis `FINGERPRINT_DIVERGENT`. O recibo histórico
inconsistente e a requalificação das evidências do código modificado permanecem
pendentes. O verificador não foi relaxado e nenhum recibo foi reescrito.

A reavaliação independente em `independent-recheck.md` confirmou a correção
da busca de URLs e dos cinco falsos positivos originais. Detectou duas frases
com dois-pontos após uma descrição conhecida e registrou mais uma lacuna de
vocabulário (`definida`). O parecer foi salvo, embora o envio final do agente
tenha terminado com timeout. A revisão própria separada está em `self-review.md`.
O parecer original continua em `../detector-independent-review.md`.

## Último ajuste, revisão independente e limitações das ferramentas

Foram acrescentados testes para os dois exemplos com dois-pontos, a palavra
`definida`, variações de pontuação e credenciais antes/depois de frases benignas.
Quatro testes novos reproduziram a falha antes da correção, conforme
`punctuation-before-check.json` e `punctuation-before.log`.

O ajuste foi aplicado: a normalização da descrição sem aspas passou a aceitar
dois-pontos, e o vocabulário ganhou `definida`/`defined`. Atribuições e valores
entre aspas continuam fora dessa exceção. A suíte HTTP também ganhou os três
exemplos novos.

A execução em lote que repetiria os testes finais foi **bloqueada antes de
executar** pela ferramenta: “Esta chamada de ferramenta foi bloqueada pela
OpenAI porque não foi possível determinar o status de segurança da solicitação.”
Uma inspeção local menor recebeu o mesmo bloqueio. Não há resultado dessa
tentativa em lote. Depois, comandos individuais foram aceitos: os 184 testes
focais, a suíte completa, TypeScript, build, lint e arquitetura foram realmente
executados após o ajuste. Seus resultados constam da tabela e dos logs finais.
A chamada individual do scanner recebeu o mesmo bloqueio e não foi executada;
seu PASS anterior não é apresentado como uma nova execução.

Uma revisão independente restrita à pontuação concluiu **PASS para o achado
delimitado**, com 58 casos, 232 chamadas às duas APIs e nenhuma falha.
`punctuation-independent-review.md` identifica o código atual por SHA-256 e
registra seus limites. Assim, D2 foi resolvido na reavaliação anterior e a
pendência final de D1 foi verificada separadamente. Esses pareceres não são
uma aprovação universal do detector, do runtime ou de produção.

## Limites

O detector é **heurístico** e não substitui o controle de dados na origem.
Descrições de senha e valores literais sem aspas podem ser ambíguos; o
vocabulário de exceções e os limiares de tamanho são finitos. Dados sintéticos
e armazenamento em memória não comprovam concorrência PostgreSQL, provedores
externos nem operação em produção. Não houve teste visual de navegador,
implantação, commit ou limpeza retroativa de dados nesta tarefa.
