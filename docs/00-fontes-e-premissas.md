# CVG-Corp — Fontes, evidências e premissas

## Finalidade

Este documento fixa a proveniência das decisões da arquitetura e impede que uma demonstração, um documento gerado ou uma capacidade do motor seja promovida silenciosamente a requisito contratado.

## Fontes utilizadas

| Fonte | O que sustenta | Limite da evidência |
|---|---|---|
| `LionCorp-harness-corporativo.md` *(ausente no workspace atual)* | Harness corporativo com Admin Master, Admin Cliente, workspaces, gateway, catálogo, budget, memória, conhecimento, billing, isolamento e fluxo Electron→Admin→provider. | Síntese de vídeo registrada durante a preparação; o arquivo-fonte não está incluído neste artifact e não é revalidável pelo clone. |
| `CresceOS-harness-corporativo-b1H-gYRW2IU.md` *(ausente no workspace atual)* | Cinco princípios: chave não desce, policy em cascata, budget antes do turno, aprovação por conversa e fail-closed; memória local, RAG central e integrações. | Síntese de vídeo registrada durante a preparação; o arquivo-fonte não está incluído neste artifact e não é revalidável pelo clone. |
| [`deepseek-harness/docs/architecture.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/architecture.md) | Cordis, plugins, perfis/bundles, eventos, turn flow, session log, capability seams e extensão sem alterar o loop. | Documentação do commit fixado; o motor está em developer preview e continua sujeito a mudanças. |
| [`deepseek-harness/docs/cordis-primer.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/cordis-primer.md) | Serviços, injeção, eventos tipados e efeitos reversíveis como modelo de composição. | Não define por si só o domínio veterinário nem a política do CVG. |
| [`deepseek-harness/docs/tool-execution-pipeline.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/tool-execution-pipeline.md) | Ordem de policy, guards monotônicos, aprovação, execução, timeout/retry, resultado e contexto adicional. | Diagrama e contratos do motor; não prova uma implementação CVG. |
| [`deepseek-harness/docs/security/threat-model.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/security/threat-model.md) | Modelo de ameaça para conteúdo não confiável, SSRF, segredos, extensão, sessão e sandbox. | Controles do motor não substituem uma análise específica de dados clínicos e organização. |
| [`deepseek-harness/docs/subsystems/core.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/core.md) | Agent, loop, prompt, sessão e eventos vivos. | A referência exata de tipos pertence ao motor; os contratos CVG abaixo são propostos. |
| [`deepseek-harness/docs/subsystems/session.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/session.md) | Log de sessão append-only, projeção, replay, flush, fork em fronteira estável e invariantes. | Sessão de agente não é prontuário clínico nem ledger financeiro. |
| [`deepseek-harness/docs/subsystems/tools.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/tools.md) | Registro de tools, schemas JSON, policy, guards, aprovação, cancelamento, resultado e apresentação. | O motor trata tools confiáveis no mesmo processo; o CVG precisa controlar a admissão. |
| [`deepseek-harness/docs/subsystems/approval.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/approval.md) | Outcomes `allowed-once`, `rejected`, `cancelled`, `unavailable` e comportamento fail-closed. | A aprovação do motor não substitui autorização clínica, comercial ou legal. |
| [`deepseek-harness/docs/subsystems/credentials.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/credentials.md) | Referências de credencial, resolução por operação, registros e autorização sem expor valores. | O armazenamento operacional do CVG ainda precisa de decisão de infraestrutura. |
| [`deepseek-harness/docs/subsystems/sandbox.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/sandbox.md) | Política de efeito de arquivo por chamada, enforcement reportado e recusa sem passthrough inseguro. | Sandbox de processo não isola automaticamente banco, APIs ou plugins in-process. |
| [`deepseek-harness/docs/subsystems/session-telemetry.md`](https://github.com/ricardoakinaga-dev/deepseek-harness-v2/blob/6454e3270642c3a7551dcae4f7447e4032febd77/docs/subsystems/session-telemetry.md) | Projeção/redação/entrega de telemetria da sessão. | O tratamento de dados clínicos precisa de política do CVG e aprovação do responsável. |

## Proveniência por seam do motor

Esta tabela fecha a proveniência das capacidades citadas na arquitetura. `CURRENT` significa documentado no commit local; não significa adapter CVG implementado.

| Claim ID | Capacidade citada | Fonte local específica | Estado e limite |
|---|---|---|---|
| SRC-DSH-01 | composição por plugins, profiles/bundles, serviços e eventos Cordis | `deepseek-harness/docs/architecture.md`, `deepseek-harness/docs/cordis-primer.md` | `CURRENT`; a composição carregada pelo CVG ainda não foi executada nem congelada |
| SRC-DSH-02 | sessão append-only, projeção de mensagens, replay, fork e flush | `deepseek-harness/docs/subsystems/session.md` | `CURRENT`; persistência física depende do backend e não é prontuário/ledger |
| SRC-DSH-03 | registro e pipeline de tools, guards, aprovação e resultado | `deepseek-harness/docs/tool-execution-pipeline.md`, `deepseek-harness/docs/subsystems/tools.md` | `CURRENT`; visibility/restrict não é fronteira de segurança |
| SRC-DSH-04 | outcomes `allowed-once`, `rejected`, `cancelled` e `unavailable` | `deepseek-harness/docs/subsystems/approval.md` | `CURRENT`; approval não substitui alçada clínica nem binding de argumentos CVG |
| SRC-DSH-05 | referências de credenciais e resolução por operação | `deepseek-harness/docs/subsystems/credentials.md` | `CURRENT`; vault, escopo, rotação e revogação CVG são `PROPOSED` |
| SRC-DSH-06 | sandbox de efeito de arquivo/processo | `deepseek-harness/docs/subsystems/sandbox.md` | `CURRENT`; não é isolamento de tenant, banco, rede ou plugin in-process |
| SRC-DSH-07 | jobs, workflow, cancelamento e bounded execution | `deepseek-harness/docs/subsystems/workflow.md`, `deepseek-harness/docs/subsystems/jobs.md` | `CURRENT` quando o pacote estiver montado; contratos CVG, retries e efeitos são `PROPOSED` |
| SRC-DSH-08 | subagentes e coordenação de agentes | `deepseek-harness/docs/subsystems/subagent.md`, `deepseek-harness/docs/subsystems/agent-team.md` | `CURRENT` documentado; Agent Teams é experimental e fica fora de P0 |
| SRC-DSH-09 | API remota/gateway e transporte tipado | `deepseek-harness/packages/api/README.md`, `deepseek-harness/packages/api/gateway/README.md`, `deepseek-harness/docs/architecture.md` | `CURRENT` documentado; autenticação, escopo e wire contract CVG são `PROPOSED` |
| SRC-DSH-10 | telemetry de sessão, redaction e entrega best-effort | `deepseek-harness/docs/subsystems/session-telemetry.md` | `CURRENT`; não é auditoria durável e pode perder/duplicar projeções |
| SRC-DSH-11 | ameaças de conteúdo não confiável, SSRF e plugins confiáveis no processo | `deepseek-harness/docs/security/threat-model.md` | `CURRENT`; ameaça/controle específico do CVG exige verificação própria |

As referências do motor apontam para um commit fixado do repositório separado, não para uma API pública estável. Se a revisão do motor mudar qualquer arquivo de referência, os claims `SRC-DSH-*` ficam `STALE` até nova inspeção.

## Versões e integridade

O motor foi inspecionado no commit `6454e3270642c3a7551dcae4f7447e4032febd77`, com manifesto `@deepseek-ai/dsh-root` na versão `0.1.1-rc.2`. O repositório local estava limpo durante a descoberta.

Os hashes dos documentos-base e do Quality Bar estão registrados em [`00-quality-bar-v1.md`](00-quality-bar-v1.md). Qualquer alteração nessas fontes torna as evidências derivadas potencialmente `STALE` e exige nova inspeção.

Os dois arquivos corporativos da primeira e da segunda linha da tabela acima não estão presentes no workspace atual. Seus hashes históricos permanecem apenas como metadados de proveniência; eles não substituem o conteúdo. Claims que dependam exclusivamente dessas fontes ficam `STALE/UNVERIFIED` até que os arquivos sejam restaurados e novamente inspecionados.

## Evidência por classificação

### CURRENT — fato ou capacidade observada

- Os vídeos descrevem um harness corporativo com políticas, workspaces, orçamento, catálogo de tools/MCPs/skills, gateway e separação entre conhecimento corporativo e memória pessoal.
- O DeepSeek Harness documenta uma arquitetura em que tudo é plugin, com `ctx.llm`, `ctx.tools`, `ctx.agents`, `ctx.sessions`, `ctx.approval`, `ctx.credentials`, `ctx.sandbox`, `ctx.jobs`, `ctx.workflowEngine` e telemetria como pontos de composição quando os pacotes correspondentes estão montados.
- O log de sessão do motor é a fonte do contexto que chega ao modelo; conteúdo model-visible precisa ser reconstruível a partir do log.
- O pipeline de tool possui gates antes, durante e depois da execução; aprovação indisponível resulta em negação.

### TARGET — resultado obrigatório do CVG

- Uma fonte transacional para cada registro clínico, operacional e financeiro.
- Uma experiência única de operação que não permita que o agente contorne escopo, policy, autorização, budget ou auditoria.
- Um caminho de recuperação que informe incerteza e não repita automaticamente efeitos externos desconhecidos.

### PROPOSED — escolha de desenho ainda não aprovada

- Começar com um modular monolith transacional e separar workers e runtime de IA por processo, preservando limites de domínio.
- Usar PostgreSQL para dados transacionais, object storage compatível com S3/MinIO para anexos e Qdrant ou equivalente para conhecimento vetorial filtrado.
- Adotar web responsiva como superfície principal e manter desktop/local cache como opção posterior, reduzindo cópia local de dado clínico.
- Usar `ctx.remote`/Typert para BFF quando a composição remota for escolhida; validar no código antes de fixar o protocolo.
- Tratar cada tool CVG como capability explicitamente registrada, com output schema, policy, guard, aprovação e auditoria.

### UNKNOWN — não inferir nesta fase

- Quantidade de unidades, profissionais, salas, atendimentos, espécies, integrações e usuários do Centro Veterinário.
- Fluxos reais de recepção, triagem, cirurgia, internação, laboratório, farmácia, faturamento e comunicação.
- Política de retenção, bases legais, responsáveis por privacidade, requisitos de conselho profissional e contratos de fornecedores.
- Sistema legado, convênios, emissão fiscal, meios de pagamento, assinatura, armazenamento e recuperação já disponíveis.
- Metas reais de disponibilidade, latência, concorrência, RTO/RPO e orçamento operacional.
- Permissões exatas do Admin Master, do operador de infraestrutura e do suporte.
- Modelo, fornecedor e região de processamento que receberão dados clínicos.

## Registro mínimo de claims

Para cada claim de capacidade usado em PRD, arquitetura ou plano, o artefato de implementação deverá conservar `claimId`, afirmação, classificação, fonte/hash, commit verificado, responsável, estado de implementação (`DOCUMENTED`, `IMPLEMENTED`, `TESTED`), evidência de teste e data da última verificação. Nesta fase, os claims `SRC-DSH-*` estão em `DOCUMENTED`; não há `IMPLEMENTED` ou `TESTED` para adapters CVG.

## Premissas de trabalho

As premissas a seguir permitem completar a arquitetura sem forjar fatos. Todas são reversíveis e devem ser confirmadas no gate `DISCOVERY_READY`/`PRODUCT_DEFINED`:

1. O CVG é tratado como uma organização/tenant inicial, mas o modelo preserva isolamento para expansão multi-tenant.
2. Paciente significa animal; tutor/responsável é uma pessoa ou organização relacionada ao paciente e pode conter dados pessoais.
3. O prontuário clínico é um registro controlado por profissionais autorizados; rascunhos de IA não são registros assinados.
4. Uma ação externa ou de alto impacto exige autorização da policy e confirmação contextual; `full-access` nunca significa acesso irrestrito.
5. Dados recebidos de arquivos, e-mails, web, MCPs, usuários e modelos são conteúdo não confiável até passar pelas validações do domínio.
6. O motor DeepSeek Harness é dependência de execução e extensão, não dono da identidade, do ledger financeiro ou dos invariantes clínicos.

## Decisões humanas necessárias

As decisões pendentes, com dono sugerido, impacto e gatilho de revalidação, estão consolidadas em [`08-rastreabilidade-e-decisoes.md`](08-rastreabilidade-e-decisoes.md). Nenhuma “boa prática” genérica substitui essas decisões organizacionais.
