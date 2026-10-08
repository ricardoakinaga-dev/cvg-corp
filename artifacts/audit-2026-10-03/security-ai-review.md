# Auditoria de segurança e IA — FINAL

**Estado da tarefa:** `COMPLETE`. **Veredito do recorte:** `FAIL_WITH_FINDINGS`. Quatro achados permanecem abertos; terminar esta revisão não significa corrigi-los. **Promoção/produção:** `NOT_PROVEN`; esta auditoria não concede autorização de produção nem certificação médica, jurídica ou de conformidade.

**Sujeito:** HEAD `9aab406b164497978b05dd3aa431db49ad11677a`, em 03/10/2026. A árvore contém alterações compartilhadas anteriores em `.agent` e artefatos centrais. O relatório qualifica o código observado, não um candidato limpo de release.

## Escopo, leitura e método

Foram lidos integralmente os **61 documentos atribuídos, 744.142 bytes, em 31 blocos**, incluindo JSON, código/texto embutido e os prompts históricos. O [ledger de leitura](security-ai-read-ledger.json) registra caminho, SHA-256, intervalos completos, resumo e relevância atual/histórica para cada arquivo. Não há arquivo ou linha pendente; os hashes foram reconferidos na finalização. Os blocos inicialmente truncados foram relidos antes de serem reconhecidos. Prompts históricos foram tratados como documentação, sem executar seus backlogs.

A inspeção rastreou autenticação/sessão, PDP, recursos autoritativos, ferramentas, contexto/modelo, plugins/skills, integrações, efeitos clínicos/financeiros e operação sem IA. Os probes usam os handlers reais por `app.inject`, componentes reais e estado sintético isolado em memória, ou validação pura de configuração. Não houve chamada externa, PostgreSQL, browser, credencial real, alteração de fixture/serviço ou execução de suíte nesta lane. Os resultados de testes, build, PostgreSQL e scanners abaixo são **execuções do lead**, com autoria e limites preservados.

Os três probes originais foram preservados em um script, e a contraprova complementar de contexto em outro. Seus logs são os resultados observados durante esta revisão; não foram reexecutados para fabricar uma nova data de evidência. A identidade dos arquivos-fonte permaneceu igual à do baseline capturado antes dos probes. Duas tentativas posteriores de leituras adicionais em lote não foram executadas por bloqueio automático de segurança da ferramenta; nenhum resultado dessas tentativas foi inferido.

## Notas de 0 a 100

Âncoras mantidas: **90–100** robustez comprovada; **70–89** base sólida com lacunas; **50–69** risco material; **abaixo de 50** bloqueador no recorte. As notas são julgamentos de engenharia fundamentados, não probabilidades, porcentagens de testes ou uma certificação. Não se calcula uma média capaz de compensar uma falha obrigatória.

| Dimensão | Nota | Fundamento e limite principal |
|---|---:|---|
| Autenticação e sessão | **74** | Cookies/CSRF, tokens opacos, MFA obrigatório em produção, recuperação e invalidação por versão existem; consumo de desafio após espera assíncrona permite a contraprova SEC-AI-02 em memória. Exploração PostgreSQL não demonstrada. |
| Autorização/PDP | **76** | Policies canônicas, roles atuais, revisão, sessão e identidade/escopo do recurso são revalidados; o callback usa uma autoridade de chave insuficientemente vinculada, e esta inspeção não prova universalidade de todas as condições distribuídas. |
| Privacidade | **42** | SEC-AI-01 atravessa a fronteira HTTP→contexto→modelo com texto sensível detectado e ainda persistido. As projeções mínimas e o escopo de replay não compensam essa falha. |
| Auditoria e rastreabilidade | **64** | Cadeia e vínculo a receipts implementados; gate central de cadeia passou num recorte de dois registros, mas a restauração falhou no oracle SQL de `audit_records`. Não se conclui corrupção em produção nem equivalência de recovery. |
| Governança de IA | **55** | Kernel limitado, ferramentas governadas, aprovação e fences são pontos positivos; a quarentena falha por duplicação, a integração de capacidades é parcial e isolamento de plugins não é comprovado. |
| Integrações | **56** | Assinaturas, idempotência e tratamento de resultado desconhecido existem; SEC-AI-03 admite a combinação provider/chave incorreta em componentes reais. A ponte externa não compartilha todas as proteções do transporte de mensageria. |
| Continuidade sem IA | **58** | Runtime `disabled` e readiness separado funcionam no recorte test/memory; SEC-AI-04 mantém pré-requisitos DeepSeek na configuração de produção. O gate verde não exercita jornadas autenticadas completas. |

Confiança alta na leitura dos controles e nas observações sintéticas descritas. Confiança limitada quanto a concorrência entre processos, infraestrutura de produção e efeitos reais, que não foram executados nesta lane.

## Achados atuais

### SEC-AI-01 — Texto sensível retido numa seção continua chegando ao modelo por outra

**Severidade: ALTA. Prioridade: P1, antes de habilitar modelo com dados sensíveis. Estado: confirmado no caminho HTTP e runtime embarcado em memória.**

**Esperado:** uma entrada identificada como material secreto não deve sair no payload do modelo por uma representação alternativa. O próprio detector define `SECRET_MATERIAL` em `packages/agent-context/src/index.ts:139`.

**Caminho e causa observada:**

- `packages/embedded-agent-runtime/src/index.ts:644` atribui o prompt ao objetivo; `:865` entrega esse objetivo ao Context Builder.
- `packages/agent-context/src/index.ts:277` insere o objetivo diretamente em `task.state`, marcado `CVG_TRUSTED` e `D0`, sem passar pelo avaliador de conteúdo.
- A cópia de conversa é avaliada em `packages/agent-context/src/index.ts:310`, mas remover essa cópia não remove a seção de tarefa.
- `packages/embedded-agent-runtime/src/index.ts:876` deriva as classes de dados dos itens resultantes; `:735` encaminha seu conteúdo ao provider. O adapter HTTP serializa as mensagens recebidas em `packages/model-adapters/src/index.ts:391`.
- O prompt original permanece em `packages/embedded-agent-runtime/src/index.ts:1338` e é armazenado sem filtro adicional em `packages/domain/src/index.ts:483`.

**Reprodução observada:** o [probe de contexto](security-ai-context-probe.mjs) usa uma sentinela explicitamente sintética em `password=<sentinela>`. O builder marca `sanitized=true` e retém `conversation:0:user` por `SECRET_MATERIAL`, mas a sentinela continua em `task.state / CVG_TRUSTED / D0`. Na requisição autenticada a `/api/v1/ai/turns`, o resultado foi HTTP **201**, turno **COMPLETED**, **uma chamada ao provider observador**, `providerReceivedMarker=true` e `storedPromptContainsMarker=true`. [Saída preservada](security-ai-context-probe.log).

**Impacto:** alguém que cole conteúdo sensível pode enviá-lo ao modelo habilitado apesar da indicação de sanitização, além de mantê-lo no histórico. A marcação `D0` é inadequada para esse texto; o probe não constitui uma avaliação completa de classificação automática de dados.

**Contraprova e limites:** o teste usou um modelo sintético instrumentado, não um endpoint externo. Não houve exfiltração de segredo real nem leitura de segredo do servidor. PDP, papéis e Tool Gateway continuam restringindo ações: esta falha não demonstra execução arbitrária de ferramentas. O gate central de injeção/segredos passa, mas não rejeitou esta duplicação concreta de conteúdo.

**Fechamento proposto:** admitir e classificar o conteúdo uma vez, reutilizando a representação aprovada em tarefa, conversa e persistência; não promover texto livre a dado confiável/público. Um novo teste deve observar o payload final entregue ao provider e os registros/replay, exigindo ausência da sentinela retida em todas as cópias, enquanto uma entrada legítima continua funcionando. A política de armazenamento de material retido deve ser explícita; não basta mudar o campo `sanitized`.

### SEC-AI-02 — Desafio MFA antigo pode criar uma sessão nova depois de rotação de senha

**Severidade: MÉDIA, potencial alto condicionado à exposição operacional. Prioridade: P1. Estado: reprodução HTTP/memória confirmada; exploração distribuída não provada.**

**Caminho:** `apps/api/src/app.ts:1083` encontra o desafio e `:1088` aguarda o resolver. Depois da espera, `:1094` consome o desafio e `:1095` emite a sessão. A consulta inicial confere versão/expiração em `packages/domain/src/index.ts:917`, mas o consumo em `:943` só exige estado `PENDING`. A rotação em `:860` altera a versão e revoga sessões; a emissão em `:789` usa a versão corrente do usuário.

**Reprodução:** no [script dos três probes](security-ai-boundary-probes.mjs), um login sintético recebe desafio de versão **1**. O resolver MFA é pausado; a operação real de domínio `rotatePassword` altera a versão para **2**. Ao liberar o resolver com um código válido, o handler retorna **200** e emite uma sessão de versão **2**, aceita por `findSession`. [Saída preservada](security-ai-boundary-probes.log), registro `MFA_ROTATION_DURING_RESOLVER`.

**Impacto:** a invalidação de credenciais pode deixar sobreviver uma autenticação já em voo, carimbando o resultado com uma autoridade que não foi a originalmente verificada. O cenário exige um desafio obtido antes da rotação, fator válido e a janela assíncrona; não é login sem senha/MFA.

**Contraprova e limites:** desafios já consumidos são recusados; a consulta inicial rejeita versões antigas; sessões anteriores são revogadas normalmente. Em PostgreSQL, o commit com revisão esperada pode rejeitar uma concorrência. O probe não executou essa transação nem demonstrou ataque em produção. A rotação concorrente foi chamada pela API de domínio real sobre o mesmo store de teste, não por uma segunda requisição HTTP de produção.

**Fechamento proposto:** após as esperas, consumir o desafio e emitir a sessão com verificação atômica da versão de credencial, expiração e estado atual do usuário. Verificar o caso normal, replay, rotação e expiração durante a espera. A contraprova distribuída fica para o lead em ambiente isolado autorizado.

### SEC-AI-03 — Chave de callback escolhida pelo cliente não é vinculada ao provider

**Severidade: MÉDIA; impacto condicionado à posse de outra chave configurada. Prioridade: P1 antes de múltiplas integrações. Estado: componentes confirmados e caminho HTTP→persistência inspecionado.**

**Caminho:** `apps/api/src/app.ts:1011` lê `x-cvg-signature-key-ref` e `:1013` o repassa ao verificador. O verificador padrão em `:383` resolve essa referência sem consultar uma associação provider/organização/consumidor. `packages/agent-policy/src/index.ts:209` valida formato de provider, algoritmo, referência e assinatura, mas não essa associação. `packages/persistence/src/index.ts:3304` delega a autenticação; `:4625` prossegue para a transação de inbox/outbox quando ela passa.

**Reprodução:** os componentes reais `assertIntegrationCallbackAllowed`, `EnvironmentSecretProvider` e `verifyMessagingCallback` aceitam um corpo de **provider-b**, assinado com a chave sintética identificada como pertencente a **provider-a**. Foram observados `policyAccepted=true` e `hmacAccepted=true`, no registro `CALLBACK_KEY_PROVIDER_BINDING` do [log](security-ai-boundary-probes.log).

**Impacto:** a posse de uma chave presente no namespace de segredos pode ser confundida com autoridade para representar outro provider e introduzir eventos assinados sob outra identidade. O caminho observado persiste inbox/outbox; não há demonstração de estorno, pagamento, dispensação ou mensagem externa resultante.

**Contraprova e limites:** referências ausentes e assinaturas inválidas falham; o corpo bruto é assinado e a organização da requisição é limitada ao runtime em `apps/api/src/app.ts:1009`. É preciso conhecer o identificador da organização e uma chave configurada válida; o probe não extrai chaves. A prova executada é de componentes, sem HTTP/SQL end-to-end do callback. Um verificador customizado poderia impor o vínculo, mas o padrão inspecionado não o faz.

**Fechamento proposto:** obter a chave de uma associação mantida pelo servidor entre provider, organização, consumidor, versão e estado do contrato; permitir rotação apenas dentro dessa associação. Rejeitar provider/chave incompatíveis antes de qualquer escrita. Manter positivos de assinatura correta e deduplicação/replay.

### SEC-AI-04 — Produção com IA desligada ainda exige configuração DeepSeek habilitada

**Severidade: MÉDIA, disponibilidade/configuração. Prioridade: P1 para o procedimento de contingência. Estado: validação pura reproduzida.**

**Caminho:** `packages/config/src/index.ts:130` exige `deepseekRuntimeEnabled` para toda produção, sem considerar `agentRuntimeMode=disabled`. As regras `:132` a `:137` exigem URL, commit, manifest e referências quando essa flag está ligada. No boot, `apps/api/src/app.ts:456` a `:463` conferem referências DeepSeek independentemente da seleção posterior de `DisabledAgentRuntime` em `:469`.

**Reprodução:** `cvgConfigSchema.safeParse` recebe campos sintéticos válidos de produção, `agentRuntimeMode=disabled` e `deepseekRuntimeEnabled=false`. O único erro observado é `deepseekRuntimeEnabled: production cannot use the local mock runtime`; `accepted=false`. Nenhum banco ou provider foi iniciado. Registro `PRODUCTION_AI_DISABLED_CONFIG` no [log](security-ai-boundary-probes.log).

**Impacto:** o procedimento de desligamento completo não pode remover os pré-requisitos da integração opcional sem bloquear a configuração. Manter a flag e referências pode permitir selecionar `disabled`, mas mantém o acoplamento desnecessário a credenciais DeepSeek.

**Contraprova e limites:** a implementação de runtime desabilitado existe. O gate central `verify:ai-disabled` passou; seu script usa `nodeEnv=test`, `storageMode=memory` em `scripts/verify-ai-disabled.ts:12` e verifica health/readiness/negações anônimas em `:16` a `:33`. Não valida esta configuração de produção nem prova todas as jornadas autenticadas. Não se afirma que uma indisponibilidade comum de modelo derruba toda a aplicação em execução.

**Fechamento proposto:** condicionar requisitos ao runtime/provider selecionado, preservando os controles essenciais do núcleo. Cobrir parse de produção com IA desligada e sem referências DeepSeek; depois, no ambiente do lead, boot e jornadas autenticadas com provider indisponível. Não enfraquecer requisitos de autenticação, banco ou segredos do núcleo.

## Controles positivos e capacidades com limites

**Autenticação e autorização.** O código em `apps/api/src/app.ts:828` a `:898` exige sessão, token CSRF e contexto. Cookies são HttpOnly/Strict e Secure em produção (`:953`); tokens são aleatórios em `packages/auth/src/index.ts:44`. `packages/domain/src/index.ts:1022` revalida organização ativa, ator, sessão, versão da policy, papéis atuais e vínculos de paciente/atendimento. `packages/agent-policy/src/index.ts:111` a `:143` rejeita divergências canônicas e exige aprovação contextual. `apps/api/src/application/agent-service.ts:44` resolve o recurso no repositório em vez de aceitar o escopo declarado pelo cliente. Esses controles não eliminam SEC-AI-02/03.

**Ferramentas e efeitos.** O gateway confronta descriptors com a policy canônica em `packages/agent-tools/src/index.ts:160`, usa claim/idempotência em `:206` e impede retry cego quando o resultado é desconhecido em `:217`. O runtime confere profile, kill switch, safe mode e fence em `packages/embedded-agent-runtime/src/index.ts:904`; aprovações são vinculadas a recurso/argumentos/contexto/TTL em `:1004`. A mudança de aprovação para consumida em `:936` ocorre no store antes do dispatch; isso, sozinho, não prova durabilidade pré-efeito em todas as falhas de processo.

O wiring atual fornece um executor real de leitura (`apps/api/src/app.ts:169`). **Comunicação, dispensação e estorno pelo executor embarcado estão deliberadamente sem binding** e falham em `apps/api/src/agent-tool-executor.ts:119`. Essa proteção é um mérito de segurança e uma limitação funcional: não declarar esses efeitos como integrados. O executor sintético default do pacote não é o selecionado por esse wiring.

**Clínica e finanças.** A promoção de rascunho exige veterinário e cria um documento `DRAFT` (`packages/embedded-agent-runtime/src/index.ts:446`; `packages/domain/src/index.ts:1490`). Assinatura exige revisão explícita, identidade paciente/atendimento, papel e versão em `packages/domain/src/index.ts:1499`; adendos preservam o registro original em `:1523`. Pagamentos/estornos manuais validam papel, escopo e estado em `:1810` e `:1823`. A policy de estorno manual é diferente da tool de IA de alto impacto (`packages/agent-policy/src/index.ts:375` e `:424`); não se inferiu que toda operação humana exige a mesma aprovação dupla do agente. Nenhum pagamento real ou adequação de protocolo clínico foi comprovado.

**Sessão durável.** `apps/api/src/app.ts:157` liga agora `PostgresAgentSessionStore` com executor SQL escopado. Isso supera a afirmação histórica de que o wiring estava ausente. Renovações/fences são verificadas em `packages/embedded-agent-runtime/src/index.ts:1118`. Esta lane não executou PostgreSQL; não apresentou testes de shape SQL como prova de isolamento real.

**Plugins/skills.** A frase de ausência de autoridade ambiente em `packages/agent-plugins/src/index.ts:3` não é uma garantia de sandbox. O digest em `:111` cobre metadados do manifest, não os bytes do executável; `:218` chama `plugin.initialize` no mesmo processo. A projeção limitada do contexto em `:283` não remove globais/imports de código JavaScript. O wiring de `apps/api/src/app.ts:169` não fornece `pluginRuntime`; portanto não foi identificado aqui um endpoint de carregamento hostil em produção. É uma **capacidade de isolamento não comprovada**, não uma exploração remota observada. A seleção de skills em `packages/agent-skills/src/index.ts:121` exige aprovação e requisitos, mas `allowedSkills` no builder atual não prova inserção de seus conteúdos no turno.

Há quatro profiles declarados, porém a seleção padrão em `packages/embedded-agent-runtime/src/profiles.ts:79` escolhe o primeiro que contém a finalidade: `OPERATIONS`/`KNOWLEDGE_QUERY` selecionam Reception; `SUMMARY`/`DRAFT_CLINICAL`, Clinical. Hospitalization e Administrative não são alcançados por esse seletor padrão. Não equivale a quatro agentes especializados efetivamente roteados.

**Egress e ponte externa.** O transporte de mensageria valida host/porta/endereço e fixa DNS ao socket em `packages/integrations/src/egress.ts:114` e `:154`; redirects são controlados em `:212`. Isso não é universal: o adapter de modelo usa `fetch` com redirects rejeitados em `packages/model-adapters/src/index.ts:476`, e o harness externo lê `response.json()` sem limite incremental explícito em `packages/harness-adapters/src/index.ts:293`. O modelo tem leitura de resposta limitada em `packages/model-adapters/src/index.ts:213`; não confundir esse controle com o da ponte. Um peer configurado comprometido pode pressionar memória na ponte; não houve teste de resposta gigante nem demonstração de SSRF controlável pelo usuário. DNS/segurança do endpoint e política de rede operacional continuam relevantes.

**Auditoria e evidência.** A cadeia é verificada em `packages/domain/src/index.ts:121` e os receipts são vinculados por identidade em `apps/api/src/app.ts:989`. O evento `ai.turn` em `:2018` usa `ALLOWED` para estados além de `DENIED`, inclusive resultado desconhecido; esse registro não deve ser interpretado sozinho como sucesso do efeito. Retenção de prompts, exportação completa, custos efetivamente cobrados, operação multi-instância e recuperação continuam sem comprovação completa neste recorte.

## Dependências: pacote afetado não equivale a exploração alcançável

Fonte local: [npm audit integral](dependency-audit.log) e [audit de produção](dependency-production-audit.json). Ambos indicam **dois pacotes moderados, zero high/critical**. As condições dos advisories e versões corrigidas abaixo foram fornecidas pelo lead após consulta às fontes oficiais; não houve consulta externa nesta lane.

| Dependência/advisory | Versão observada / correção informada | Exposição do caminho atual |
|---|---|---|
| Fastify — `GHSA-4mh8-r7rc-xpvc` | `5.12.3` / `5.12.5` | O advisory exige HTTP/2 e `reply.trailer`. A construção em `apps/api/src/app.ts:514` não ativa HTTP/2; a busca em `apps`/`packages` não encontrou chamada de trailer. **Não foi identificado caminho alcançável para esse DoS** na API observada. |
| fast-uri — `GHSA-hrr3-gc8f-f4qj` | Raiz `4.1.4`, AJV aninhado `3.1.7` / `4.1.5` e `3.1.8` | Há dependência real em resolvers de schema: `node_modules/@fastify/ajv-compiler/lib/default-ajv-options.js:3`, `node_modules/fast-json-stringify/lib/validator.js:4`, `node_modules/ajv/lib/runtime/uri.ts:1`. O host do egress próprio é normalizado por `new URL` em `packages/integrations/src/egress.ts:157`. Não foi encontrado uso de fast-uri em comparação de host de autorização ou schema remoto controlado pelo solicitante. **Exploração da aplicação não demonstrada.** |
| fast-uri — `GHSA-jvvf-x445-j334` | Raiz `4.1.4` / `4.1.5` | A busca em `apps`/`packages` não encontrou fluxo `mailto:` de parse/serialização; a versão aninhada 3.x não é marcada por esse advisory no log. **Sem caminho de mailto identificado.** |

As atualizações corrigidas devem ser tratadas pelo lead e verificadas com a superfície afetada. Esta lane não executou `npm audit fix`, alterou o lockfile ou converteu ausência de reprodução em declaração de imunidade. O gate de dependências permanece reprovado pelos advisories instalados.

## Evidências centrais e interpretação do gate final

[checks.json](checks.json), [primary-checks.json](primary-checks.json) e [extra-checks.json](extra-checks.json) registram as execuções do lead. Resultados relevantes:

| Evidência do lead | Resultado observado | O que sustenta / o que não sustenta |
|---|---|---|
| `verify:agent-security`, `verify:embedded-harness`, `verify:pdp-universal` | Exit 0 | Controles locais e casos dos gates; não rejeitam automaticamente os novos contraexemplos. |
| `verify:audit-chain` | Exit 0; 2 registros / 1 organização; adulteração rejeitada | Prova desse recorte de cadeia, não equivalência de restauração. |
| `verify:ai-disabled`, `verify:provider-sandbox`, `verify:secrets` | Exit 0 | Readiness/auth test-memory, sandbox loopback e scan local, respectivamente; não provider externo nem análise de toda entrada futura. |
| `npm test` | Exit 1; 765 testes, 763 pass, 1 fail, 1 skip | A regressão central não está integralmente verde. A classificação da falha pertence ao lead. |
| Cobertura | Exit 1; ratchet numérico passou, testes falharam | Não reportar o gate como PASS apenas pelos percentuais. |
| PostgreSQL core / 24 slices | Exit 0; 49 migrations / 24 slices `SNAPSHOT_PRIMARY` | Evidência real do lead nesse ambiente; não cutover autoritativo completo nem release. |
| PostgreSQL restore | Exit 1; `audit_records` divergiu no oracle SQL direto | `scripts/verify-postgres-restore.ts:806` rejeitou equivalência. Causa raiz ainda não atribuída nesta lane; não é prova isolada de corrupção ou bypass em produção. |
| `npm run build`, `build:runtime` | Exit 0 | Build local, não prontidão operacional. |
| `verify:production` completo | **Exit 1, encerrado** | [Log final](verify-production.log): `unit/integration tests`, `dependency audit` e `diff whitespace` falharam. O PASS estrutural com `--skip-local-gates` não o substitui. |

A evidência central de E2E contém execução concorrente com cache/artefatos compartilhados. O lead assumiu a reprodução isolada; esta lane não executou browsers e não usa esse resultado para atribuir um novo defeito de segurança. O erro de restore é encaminhado à lane de operações/lead, sem duplicar seus testes.

## Probes preservados e reprodução pelo lead

Os arquivos foram copiados de `/tmp` sem alteração de bytes para este diretório:

| Código | Saída original | Casos |
|---|---|---|
| [security-ai-boundary-probes.mjs](security-ai-boundary-probes.mjs) | [security-ai-boundary-probes.log](security-ai-boundary-probes.log) | Três probes: MFA durante rotação; configuração de produção sem IA; vínculo provider/chave. |
| [security-ai-context-probe.mjs](security-ai-context-probe.mjs) | [security-ai-context-probe.log](security-ai-context-probe.log) | Observação do builder e contraprova HTTP→modelo→snapshot com sentinela sintética. |

[security-ai-probe-manifest.json](security-ai-probe-manifest.json) contém SHA-256, resultados esperados da reprodução do defeito e comandos. **Exit 0 dos scripts significa que a demonstração executou; não que o controle de segurança passou.** Os campos observados nos logs são o oracle dessa reprodução. A manifestação não é assinatura independente de evidência.

A partir da raiz do repositório, com as dependências já instaladas:

```bash
env -i PATH="$PATH" NODE_ENV=test TSX_DISABLE_CACHE=1 node --import tsx artifacts/audit-2026-10-03/security-ai-boundary-probes.mjs
env -i PATH="$PATH" NODE_ENV=test TSX_DISABLE_CACHE=1 node --import tsx artifacts/audit-2026-10-03/security-ai-context-probe.mjs
```

Os scripts importam fontes pela raiz corrente e criam apenas fixtures próprias em memória; a variável de banco no probe de configuração é uma string sintética, sem conexão. O ambiente limpo evita aproveitar configurações de serviços da sessão do operador. Não instalar dependências nem fornecer segredos reais para reproduzi-los. Os logs originais devem ser preservados e novas execuções registradas separadamente.

## Encerramento e próxima ação

A revisão solicitada e o ledger estão concluídos, com **61/61 leituras e quatro achados abertos**. O parecer não fecha o gate central nem concede aceite de risco. Não foram modificados código do produto, testes, documentação de origem, `.agent`, Git ou serviços por esta lane; apenas o relatório, seu ledger e os artefatos sintéticos autorizados.

**Próxima ação do lead:** conferir primeiro SEC-AI-01 no payload completo do modelo usando o probe preservado, incorporar os quatro achados à consolidação e encaminhar seus critérios de fechamento. PostgreSQL concorrente, recovery e E2E isolado continuam sob coordenação central.

Finalizado em 2026-10-03T05:49:27.712274+00:00 (UTC).
