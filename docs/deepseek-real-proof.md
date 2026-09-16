# Prova DeepSeek real

Status global: `PARTIAL` — integração governada incompleta e execução externa `BLOCKED_EXTERNAL`.

A inspeção do checkout `/home/ricardo/deepseek-harness` encontrou HEAD `5dda764ed3aa172535a7967b06ff95d9cbfe536a`. Isso prova apenas a presença do código. Nenhum turno de modelo real foi executado nesta rodada. O ACP nativo do CVG agora possui a seam `DeepSeekAcpGovernance`, mas continua em default-deny sem uma implementação injetada que ligue Tool Gateway/PDP, ciclo de aprovação, replay durável, provenance de usage e controle de egress. Portanto fornecer uma API key, isoladamente, não fecha a fase 3.

## Gate executável

`npm run verify:deepseek-real` usa o mesmo `DeepSeekHarnessAdapter` da aplicação. Exige HTTPS, bearer, segredo de assinatura, SHA exato do engine, digest SHA-256 do manifest, catálogo esperado de tools, contexto, `session/new`, payload do turno, `CVG_DEEPSEEK_REAL_EVIDENCE_FILE` e `CVG_DEEPSEEK_REAL_PROOF_PUBLIC_KEY`. O bundle de evidência precisa estar ligado ao SHA limpo atual, conter as 31 operações positivas/negativas das fases 3–4, digest de cadeia, produtor, revisor independente, limitações, risco residual e uma assinatura Ed25519 do payload canônico completo. Cada etapa referencia um arquivo relativo ao diretório imutável do bundle; o verificador rejeita symlink, traversal e digest de bytes divergente antes de executar o smoke. O script verifica readiness/capabilities, schemas completos, vínculo do ator/escopo/sessão, provenance, resposta concluída com uso não zero e registro de usage `SETTLED` coerente com os tokens, além de replay contendo o turno exato. Preserva `context.sessionId` como sessão de autenticação e passa a sessão de IA em `input.sessionId`.

Variáveis obrigatórias:

- `CVG_DEEPSEEK_REAL_URL` (origin HTTPS sem credenciais/path/query);
- `CVG_DEEPSEEK_REAL_BEARER_TOKEN`;
- `CVG_DEEPSEEK_REAL_CONTEXT_SIGNING_SECRET`;
- `CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT` (40 hex);
- `CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION` (`sha256:` + 64 hex);
- `CVG_DEEPSEEK_EXPECTED_TOOL_NAMES` (separadas por vírgula);
- `CVG_DEEPSEEK_REAL_CONTEXT_JSON`;
- `CVG_DEEPSEEK_REAL_SESSION_INPUT_JSON`;
- `CVG_DEEPSEEK_REAL_TURN_INPUT_JSON`.
- `CVG_DEEPSEEK_REAL_EVIDENCE_FILE` (bundle externo same-SHA com a matriz completa e revisão independente).
- `CVG_DEEPSEEK_REAL_PROOF_PUBLIC_KEY` (chave pública Ed25519 da autoridade que assina o bundle; nunca é inferida do bundle).

Ausência de configuração, chave de assinatura ou bundle retorna exit 2 (`DEEPSEEK_REAL_BLOCKED_EXTERNAL`). Violação de protocolo, assinatura ou bundle inválido retorna exit 1 sem expor mensagem bruta, payload ou segredo. O resultado só pode ser `DEEPSEEK_REAL_VERIFIED` quando o smoke HTTPS e o bundle same-SHA completo passarem juntos; uma resposta autorreferida do endpoint ou um fixture local nunca satisfaz a matriz. O schema do bundle é validado por `validateDeepSeekRealProofEvidence` e exige 31 etapas, timestamps atuais, digests de cadeia, produtor distinto do revisor, limitações, risco residual e assinatura Ed25519 verificável por autoridade externa.

## Fronteira HTTP corrigida

A assinatura v2 HMAC-SHA256 cobre `{ version: 2, method, path, issuedAt, payload }`, serializado como JSON. `payload` é o envelope completo `{ context, input, ... }` enviado; para GET é o envelope transportado em `x-cvg-context` base64url. Headers: `x-cvg-context-issued-at` (epoch em milissegundos) e `x-cvg-context-signature: sha256=<hex>`. Prazo máximo: 60 segundos; tolerância futura: 5 segundos. Contexto, argumentos, destino e prazo são autenticados antes da execução nativa. Assinaturas antigas sem timestamp falham. Implantar adapter e bridge juntos; não há downgrade para assinatura v1.

A sessão da URL precisa coincidir com `input.sessionId`, inclusive o literal `new` quando nulo. Fechar a conexão HTTP após enviar o corpo aborta o signal da chamada nativa. O adapter proíbe redirects, preserva correlation ID e rejeita sessão de engine diferente, divergência de profile e draft/aprovação ligados a outro turno. Repetições dentro do prazo ainda dependem do ledger de idempotência do domínio; HMAC não substitui anti-replay durável.

No port ACP, `DeepSeekAcpGovernance` é obrigatório para qualquer turno público. O port religa sessões CVG carregadas pelo governance após restart/crash, invalida bindings mortos e converte notificações ACP `tool_call` sem executor CVG em `OUTCOME_UNKNOWN`; o fixture local exercita autorização, reload, reconciliação de tool call, usage ausente, round-trip ACP → bridge HTTP → adapter e recuperação para um turno concluído. O schema wire compartilhado preserva provenance e usage no round-trip.

## Matriz de falhas — evidência desta rodada

| Caso | Evidência local | Prova no modelo real |
|---|---|---|
| Wrong commit / manifest / tool registry | Rejeitados independentemente antes de executar turn; identidade revalidada após mudança simulada de engine | `NOT_RUN` |
| Bad attestation | Manifest ACP exige bundle e calcula digest dos bytes; capabilities incompletas bloqueadas | `NOT_RUN` |
| Invalid HMAC / expired context | HTTP real em loopback rejeita contexto, argumento, método/path adulterado, prazo expirado/futuro | `NOT_RUN` |
| Invalid schema | Bridge rejeita resposta nativa malformada; adapter faz validação estrutural completa | `NOT_RUN` |
| Slow model / timeout | Deadline e cancelamento por AbortSignal testados com port sintético | `NOT_RUN` |
| Broken connection | Cliente desconectado após body cancela chamada nativa via servidor HTTP real local | `NOT_RUN` |
| Harness restart | Drift de identidade após restart simulado rejeitado; restart de processo real não executado | `NOT_RUN` |
| Replay mismatch | Smoke rejeita turno ausente/adulterado no replay | `NOT_RUN` |
| Partial output / provider failure / approval replay | Port ACP exige governance antes de prompt e registra `COMPLETED`/`DENIED`/`OUTCOME_UNKNOWN` por contrato; sem governance durável não há prova operacional correspondente | `NOT_RUN` |

## Governance durável (AUD13-27)

`createDurableDeepSeekAcpGovernance` (em `@cvg/harness-adapters`) implementa `DeepSeekAcpGovernance` sobre uma porta estrutural de store CVG, sem fallback para mock:

- sessão persistida com `engineCommit`/`profileDigest` **atestados pelo port** no momento da criação (`createSession(context, input, attestedFacts)`); restart recarrega a sessão do ledger e recusa escopo, status ou profile divergentes;
- `authorizeTurn` consulta o catálogo canônico `TOOL_REGISTRY`, aplica `requireRole` por capability, exige aprovação contextual e persiste turno `DENIED`/`RECEIVED` antes de qualquer dispatch nativo;
- aprovação de alto impacto exige ator independente, decisão única e expiração; o consumo ocorre somente após `recordTurn` `COMPLETED` (uma vez, com replay posterior negado);
- budget opcional reserva antes do dispatch, libera em `DENY` e mantém retido (`settle(reservation, null)`) quando o custo é desconhecido;
- usage ausente/inválido vira `OUTCOME_UNKNOWN` com `RECONCILIATION_REQUIRED` e custo `UNAVAILABLE` — nunca custo zero;
- provenance registra provider `deepseek`, engine, profile, policy revision, correlation e digsests; promoção de rascunho cria documento clínico durável e não promove duas vezes.

O entrypoint aceita `durableAcp: { store, toolNames?, budget? }` e compõe a governance automaticamente quando nenhuma autoridade explícita foi injetada, repassando-a a `createAcpNativeHarnessPortFromEnvironment`.

| Falha | Evidência local | Prova no modelo real |
|---|---|---|
| Restart do processo/port | Sessão durável recarregada por nova instância de governance sobre o mesmo ledger | `NOT_RUN` |
| Cancelamento | Port registra `OUTCOME_UNKNOWN` e preserva reserva de budget | `NOT_RUN` |
| Timeout | Deadline/cancelamento no port sintético (bridge) | `NOT_RUN` |
| JSON inválido | Bridge rejeita resposta nativa malformada; wire schema estrito | `NOT_RUN` |
| Manifest/HMAC incorretos | Attestation do manifesto + HMAC de contexto rejeitados | `NOT_RUN` |
| Usage ausente | `OUTCOME_UNKNOWN` + `RECONCILIATION_REQUIRED`, sem custo zero | `NOT_RUN` |
| Sem fallback mock | Turno ACP sem governance falha `CAPABILITY_DISABLED`; entrypoint só habilita com port explícito | `NOT_RUN` |

Verificação focada: `npx tsx --test tests/unit/deepseek-bridge.test.ts tests/unit/deepseek-acp.test.ts tests/unit/deepseek-real-proof.test.ts tests/unit/deepseek-acp-governance.test.ts` (31 testes locais: 30 pass, 1 skip). Fixtures sintéticas e loopback são evidência de fronteira, não de qualidade do modelo, autoridade externa ou produção. `npm run verify:deepseek-acp` e `npm run verify:deepseek-real` permanecem bloqueados externamente (`DEEPSEEK_REAL_BLOCKED_EXTERNAL`) até runtime/modelo/segredos e teto de custo serem autorizados (AUD13-26). Próximo gate: executar todas as operações das fases 3–4 no SHA aprovado com a governance durável injetada.
