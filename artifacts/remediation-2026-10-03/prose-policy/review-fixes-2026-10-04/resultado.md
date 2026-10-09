# Correções da revisão do detector — 04/10/2026

## Alterações

**PROSE-IR-1:** uma frase rejeitada já não consome a palavra que inicia outra
declaração de senha. Os três exemplos sobrepostos do revisor e equivalentes
com instruções em português/inglês foram adicionados às regressões de contexto,
HTTP, runtime direto e retomada por aprovação. Discussões legítimas de política
de senhas e valores explícitos entre aspas ou em atribuições foram preservados.

**PROSE-IR-2:** a limpeza da pontuação usa uma passagem de trás para frente,
substituindo a expressão que reexaminava o mesmo trecho. O ajuste vale para
ambos os fragmentos do candidato. Não houve truncamento da entrada nem mudança
na política de formato de valor definida na etapa anterior.

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Regressões selecionadas antes da correção | 6 testes, todos reproduziram os defeitos |
| Seis arquivos de testes focais após a correção | 227 passaram; nenhuma falha ou caso ignorado |
| TypeScript, lint, build e arquitetura | Passaram |
| Verificação do diff | Passou |
| Suíte completa | 961 testes: 959 passaram, 1 falhou, 1 foi ignorado |
| Scanner no código final | PASS no histórico Git e na árvore atual; saída 0 |
| Reavaliação independente | PASS para PROSE-IR-1 e PROSE-IR-2 no recorte observado |

Para a mesma entrada de 32.781 caracteres da família de pontuação, a mediana de
CPU das duas funções juntas foi de **1.549,476 ms antes** e **1,013 ms depois**.
As três famílias medidas também incluem pontuação no segundo fragmento e
introduções repetidas. São medições locais, não garantia de latência em produção.

A falha da suíte permanece em `tests/unit/control-plane-aud23.test.ts:141`:
`COMPOSITE_EXIT_DIVERGENT` e seis `FINGERPRINT_DIVERGENT`. O recibo inconsistente
e a qualificação das fontes alteradas continuam pendentes. Nenhum requisito ou
verificador foi modificado para forçar aprovação. A mensageria loopback passou
nesta execução completa, feita sem build simultâneo.

`regression-before.json`, `focused-checks.json`, `general-checks.json` e
`secret-scan.json` registram os resultados executados. `verification-summary.json`
reúne a identidade das fontes, hashes dos logs e escopos da validação. Os 12
arquivos registrados permaneceram iguais entre as verificações e a conferência
após o scanner. A revisão própria separada está em `self-review.md`. Os relatórios
e resultados anteriores foram preservados.

## Scanner e revisão independente

O script do scanner foi relido: executa Gitleaks com `--network=none`, montagem
do repositório somente leitura e `--redact`. O endpoint Docker observado é
`unix:///var/run/docker.sock`, sem overrides de host/contexto; a imagem fixada
já está disponível localmente. O script não contém chamada a uma API OpenAI.
As regras e exceções existentes permanecem inalteradas: o PASS, quando obtido,
deve ser interpretado dentro dessas regras, não como ausência universal de segredos.

Uma inspeção conjunta e uma leitura conjunta de comprovantes foram bloqueadas
pela ferramenta com a mensagem de que a OpenAI não conseguiu determinar o status
de segurança da solicitação; essas duas chamadas não executaram. Leituras isoladas
subsequentes foram aceitas e forneceram a evidência descrita acima. Isso não é
um resultado do Gitleaks. O comando do scanner foi aceito e concluiu com saída 0.

A reavaliação independente em `independent-recheck.md` aprovou os dois achados:
59 entradas funcionais e 90 entradas de escalabilidade até 64 KiB tiveram os
resultados esperados nos dois exports. O revisor também exercitou chamadas
repetidas, valores explícitos e credenciais posteriores. Seu hash do detector
coincide com as fontes verificadas após o scanner. Os limites do parecer são
preservados: não avaliou runtime, produção ou liberação de versão.

O scanner utilizou as regras já existentes, incluindo exceções por regra/caminho
e exclusão de artefatos de build; nenhuma delas foi ampliada. Não houve alteração
posterior do código ou dos testes. Detalhes das limitações da configuração estão
na inspeção preservada em `../scanner-inspection.md`.

## Limitações

O detector permanece heurístico e não substitui controle de acesso, minimização
e remoção de segredos na origem. Os testes usam dados sintéticos e não qualificam
produção, provedores externos ou concorrência PostgreSQL. Não houve implantação,
commit, alteração de dependências ou limpeza retroativa de dados.
