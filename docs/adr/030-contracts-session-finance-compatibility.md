# ADR 030 - Contratos das primeiras jornadas, sessao e financeiro

- Status: Accepted for first-journey consumers
- Date: 2026-09-13
- Scope: CON-01
- Base artifact: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`
- Exclusive resource: `contracts`

## Context

O pacote `@cvg/contracts` ja possui schemas de entrada, tipos de dominio,
envelopes TypeScript de sucesso/erro e um registro de upcasters fail-closed.
Antes desta tarefa, porem, sucesso, erro, estado parcial, receipt, logout e
saldo agregado nao tinham uma superficie executavel unica para os consumidores
das primeiras jornadas.

O servidor atual continua usando `success()`/`failure()` e a rota de logout
retorna `loggedOut: true`. Esta ADR congela o contrato que os proximos
consumidores e handlers devem adotar; nao afirma que as rotas atuais ja foram
migradas. Nenhuma promessa de revogacao server-side pode ser inferida do fato
de o estado local ter sido limpo.

## Decision

### Version and compatibility

O manifesto exportado `FIRST_JOURNEY_CONTRACT_MANIFEST` registra:

| Campo | Valor | Regra |
|---|---|---|
| `apiVersion` | `v1` | Prefixo publico atual |
| `schemaVersion` | `1` | Versao exigida pelos envelopes |
| `sessionFormatVersion` | `0` | Formato de sessao existente, ainda pre-release |
| `compatibility` | `V1_CURRENT_ONLY_FAIL_CLOSED` | Nenhuma versao legada e aceita implicitamente |

`API_V2_COMPATIBILITY` e `API_UPCASTERS` permanecem fail-closed. Uma versao
anterior so podera ser aceita depois de um upcaster explicito, reversivel e
revisado. `upcastApiValue()` rejeita qualquer `targetSchemaVersion` diferente
da versao corrente antes de inspecionar o payload. Uma versao futura e
rejeitada; o valor versionado tambem exige `schemaVersion` proprio, enumeravel
e de dados em um objeto plain, para que o clone nao perca a versao. O grafo de
payload e limitado em profundidade, nos, chaves, tamanho de array e strings;
numeros nao finitos, accessors, simbolos, `toJSON`, ciclos, proxies e prototipos
customizados sao rejeitados. Nao existe downgrade silencioso.

### Envelopes and errors

`apiSuccessEnvelopeSchema`, `apiErrorEnvelopeSchema` e
`apiPartialEnvelopeSchema` validam `schemaVersion` e `correlationId` na mesma
fronteira. O erro usa somente `errorCodes`; estado parcial exige ao menos uma
`pending` operation com `reason` e `retryable`. Detalhes de erro aceitam apenas
objetos JSON plain com chaves, strings, profundidade e numero de nos limitados;
`data` de success e partial tambem aceita somente grafos JSON plain, com
arrays densos, propriedades enumeraveis de dados e limites equivalentes.
`failure()` normaliza codigos desconhecidos para
`INTERNAL_ERROR`. Accessors, simbolos, ciclos, `toJSON` e valores nao JSON sao
rejeitados. O helper `failure()` substitui detalhes fora desses limites por
`detailsUnavailable`, sem emitir o payload original.

Os exemplos sinteticos `FIRST_JOURNEY_CONTRACT_EXAMPLES.success`, `.error` e
`.partial` sao parte do pacote e acompanham o manifesto. Eles sao fixtures de
contrato, nao respostas de producao.

### Receipts

`commandReceiptSchema` e `receiptReferenceSchema` tornam observaveis a
identidade, operacao, chave de idempotencia, digest do corpo, status, resultado
e timestamps. Os estados permitidos sao `IN_FLIGHT`, `SUCCEEDED`, `FAILED` e
`OUTCOME_UNKNOWN`. Um resultado perdido depois de uma possivel mutacao nao e
convertido em sucesso nem repetido cegamente; ele exige lookup ou
reconciliacao. O schema exige `result=null` e `completedAt=null` durante
`IN_FLIGHT`; estados terminais exigem `completedAt`; estados nao-
`SUCCEEDED` nao podem expor resultado. `replayed=true` so acompanha receipt
`SUCCEEDED`.

O helper `partial()` e `isApiPartial()` completam `success()`. `failure()` mantem
sua assinatura, mas aplica os limites de diagnostico definidos acima e substitui
detalhes invalidos por um marcador seguro. A adocao pelos endpoints e
consumidores fica para as tarefas que possuem esses arquivos em sua reserva.

### Session and logout

`sessionLifecycleSchema` separa estado da sessao (`ACTIVE`, `EXPIRED`,
`REVOKED`, `SIGN_OUT_PENDING`, `UNKNOWN`) de quem observou esse estado
(`SERVER` ou `LOCAL`). `logoutResponseSchema` separa ainda:

- `localState`: `AUTHENTICATED`, `SIGN_OUT_PENDING` ou `SIGNED_OUT`;
- `serverRevocation`: `CONFIRMED`, `PENDING`, `NOT_REVOKED`, `NOT_OBSERVED` ou `UNKNOWN`;
- `serverAttempted` e `serverObservation`, com timestamp, quando houver resposta;
- `retryable` e `correlationId`.

`SIGNED_OUT` nunca e prova, por si so, de `serverRevocation=CONFIRMED`. Quando
a resposta do servidor nao foi observada, o contrato conserva essa incerteza
e permite retry/reconciliacao explicitos. `CONFIRMED` exige uma observacao
server-side com status `REVOKED`; `UNKNOWN` exige uma tentativa sem resposta;
`NOT_OBSERVED` exige que nem tentativa tenha ocorrido. `REVOKED` observado
localmente tambem e rejeitado como estado autoritativo.

### Financial balance

`chargeStatusSchema` e `paymentStatusSchema` fecham os estados individuais.
`financialBalanceSchema` registra moeda, total cobrado, pagamentos liquidados,
saldo pendente, estado agregado, avaliacao de estornos e instante de
observacao.

`pendingCents: null` exige `state=REQUIRES_POLICY` ou `state=UNKNOWN`.
`refunds.status=UNRESOLVED` nunca carrega um valor de estorno e impede um
estado financeiro que pareca liquidado. O contrato nao decide se um estorno
reduz cobranca, devolve pagamento, gera credito ou segue outra politica; essa
decisao pertence a FIN-04 e deve ser registrada antes de ser implementada.

Para estados conhecidos, pagamentos liquidados e saldo pendente nao podem
exceder o total cobrado. `OPEN` exige pagamento liquidado zero e saldo igual
ao cobrado; `PARTIALLY_PAID` exige valores liquidados e pendentes positivos que
somem o total; `PAID` exige saldo zero e pagamentos iguais ao total; e
`REFUNDED` exige um estorno observado. Estados `UNKNOWN` e `REQUIRES_POLICY`
preservam os casos em que essa aritmetica nao pode ser afirmada.

O fixture `FIRST_JOURNEY_DOMAIN_EXAMPLES.financialBalance` demonstra um saldo
parcial sem estorno. O fixture de logout demonstra estado local encerrado com
revogacao `UNKNOWN`, para tornar o limite negativo executavel e visivel.

## Contract registry

`FIRST_JOURNEY_CONTRACT_REGISTRY` registra os schemas com nomes estaveis:

- `ApiSuccess`
- `ApiError`
- `ApiPartial`
- `CommandReceipt`
- `ReceiptReference`
- `SessionLifecycle`
- `LogoutResponse`
- `FinancialBalance`

O registro e um mapa de schemas, nao uma afirmacao de que todos os endpoints
atuais ja executam parse de resposta. CON-02 deve conectar os consumidores do
cliente; SEC-01 deve migrar o logout; FIN-01/FIN-04 devem fechar a semantica e
os usos financeiros.

## Compatibility and migration

Esta mudanca e aditiva no pacote de contratos. Os helpers e interfaces
existentes permanecem exportados. O contrato novo e preparado antes da
migracao dos endpoints, portanto a ausencia de `status` em respostas atuais
de receipt e a forma legada `loggedOut` nao sao mascaradas como conformidade.
Qualquer migracao de wire shape deve:

1. adicionar um upcaster ou uma janela de compatibilidade explicitamente
   registrada;
2. preservar `correlationId`, receipt e estados de incerteza;
3. validar o cenário negativo de versao/estado antes de liberar o consumidor;
4. atualizar o catalogo, o handler e os testes na tarefa que possuir esses
   caminhos.

## Verification

Os schemas e fixtures foram adicionados em
`packages/contracts/src/index.ts`. A verificacao desta tarefa deve executar:

- `npm run test:contract`;
- `npm run typecheck`;
- parse direto dos exemplos e cenarios negativos;
- `git diff --check`.

O resultado local continua limitado ao worktree sintetico. Esta ADR nao prova
provider externo, staging, durabilidade operacional, release same-SHA ou
AAA global; `AAA_NOT_PROVEN` permanece correto.
