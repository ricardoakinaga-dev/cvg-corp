# Pacote de decisão de política de licenças — 23/09/2026

Este documento organiza fatos do lockfile e as decisões pendentes para o
responsável do produto. Não escolhe uma licença para o CVG-Corp nem constitui
parecer jurídico.

## Evidência local atual

- `npm run audit:licenses` passou para **183 entradas de terceiros** no
  `package-lock.json` observado. A distribuição é: MIT 142, Apache-2.0 17,
  MPL-2.0 14, BSD-3-Clause 5 e ISC 5.
- O verificador aceita atualmente `MIT`, `ISC`, `Apache-2.0`, `BSD-3-Clause`,
  `CC-BY-4.0` e `MPL-2.0`. Nenhuma das 183 entradas atuais ficou fora dessa
  lista. O comando valida os metadados SPDX do lockfile, não o texto integral
  das licenças dos pacotes.
- O resultado bruto desta execução local foi salvo fora do repositório em
  `/tmp/cvg-mel23-license-audit-20260923.log`, SHA-256
  `ddeffc1193c3129acad00ec58f0768e5c03426ddf3d62063ab5c61aa1992758e`.
- `package.json` não declara um campo `license`; não foi encontrado `LICENSE`,
  `LICENCE` ou `COPYING` na raiz.
- O relatório histórico AUD27 de 21/09 listou dez ocorrências —
  `@typescript-eslint/typescript-estree`/`minimatch`, `argparse`,
  `damerau-levenshtein`, `eslint-scope`, `espree`, `esrecurse`, `estraverse`,
  `esutils`, `language-subtag-registry` e `uri-js`. Nenhuma dessas entradas
  aparece no lockfile atual. O gate atual passa, mas a cadeia de alterações
  que explica a diferença não está registrada em um candidato congelado.
- O lockfile e a árvore de trabalho ainda estão modificados. O resultado acima
  qualifica somente esses bytes locais; deve ser repetido no candidato final.

## Decisões necessárias do responsável

1. Definir o escopo de distribuição e aprovar a licença raiz e o texto exato a
   publicar, ou determinar que nenhuma licença aberta será declarada.
2. Confirmar se o conjunto fechado de identificadores aceitos pelo gate é a
   política pretendida. Uma mudança na política deve ser explícita e aprovada;
   não ampliar a lista apenas para obter um resultado verde.
3. Confirmar se a ausência das dez entradas históricas no lockfile atual é a
   resolução técnica aceita para MEL23-013, ou se a cadeia de substituição e
   dependências precisa de outra prova focal.
4. Indicar os avisos e arquivos de atribuição exigidos pelo pacote de release
   após as decisões anteriores.

## Estado MEL23

- **MEL23-013:** o gate local atual passa em 183 entradas; a reconciliação das
  dez ocorrências históricas e a repetição no candidato congelado continuam
  pendentes.
- **MEL23-014:** bloqueado pela decisão do responsável sobre a licença raiz.
  Nenhum texto de licença foi criado por inferência.

As tarefas e recibos AUD27 permanecem na fonte append-only `.agent`; este pacote
não altera status nem cria uma segunda tarefa ativa.

## Decisões do responsável — 25/09/2026

1. **Licença raiz:** proprietária, todos os direitos reservados. O titular declarado no `LICENSE` é "Ricardo Akinaga (CVG-Corp / Centro Veterinário Guarapiranga)"; a linha de titular pode ser ajustada pelo responsável sem nova análise. `package.json` declara `"license": "UNLICENSED"`.
2. **Política de terceiros:** a allowlist existente (MIT, ISC, Apache-2.0, BSD-3-Clause, CC-BY-4.0, MPL-2.0) é a política pretendida e não foi ampliada.
3. **Dez entradas históricas:** a resolução se dá pelo lockfile atual, que não as contém; a prova é repetida no candidato congelado pelo `audit:licenses`.
4. **Avisos e atribuição:** qualquer distribuição autorizada deve preservar copyrights e avisos de terceiros; a geração automática de um arquivo de notices permanece como tarefa de follow-up (MEL23-013/014), sem bloquear a decisão de licença raiz.

O gate `audit:licenses` passou a exigir também o campo de licença raiz no `package.json` e um `LICENSE` não vazio na raiz.
