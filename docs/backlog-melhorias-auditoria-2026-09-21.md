# Backlog completo de melhorias — CVG-AUD26

**Origem:** [relatório de auditoria](./auditoria-profunda-repositorio-2026-09-21.md)
**Plano:** [plano executivo](./plano-executivo-melhorias-auditoria-2026-09-21.md)
**Roadmap:** [roadmap](./roadmap-melhorias-auditoria-2026-09-21.md)
**Estado de todos os itens neste documento:** `PROPOSED`
**Importante:** este arquivo não substitui `.agent/backlog.json`; `CVG-AUD26-001` deve reconciliar e importar o programa no schema canônico vigente.

## Convenções

- **P0:** bloqueia integridade, segurança ou promoção.
- **P1:** risco operacional/material que deve ser resolvido antes da qualificação.
- **P2:** qualidade, eficiência e governança necessárias ao encerramento completo.
- **S/M/L/XL:** tamanho relativo, não estimativa de calendário.
- **Evidência corrente:** gerada para o mesmo fingerprint do código, sem depender de recibo anterior.
- Uma tarefa só pode virar `DONE` quando todos os critérios de aceite e evidências forem satisfeitos.

## Resumo priorizado

| ID | P | Tam. | Dependências | Resultado |
|---|---|---:|---|---|
| CVG-AUD26-001 | P0 | M | — | Reconciliar control plane e importar programa |
| CVG-AUD26-002 | P0 | M | 001 | Fechar contrato dos sete atributos de role |
| CVG-AUD26-003 | P0 | M | 002 | Completar matriz PostgreSQL de autoridade |
| CVG-AUD26-004 | P0 | M | 003 | Remover autoridade fabricada do verificador |
| CVG-AUD26-005 | P0 | L | 004 | Provar rollback em falha tardia |
| CVG-AUD26-006 | P0 | L | 005 | Provar replay, concorrência e outcome unknown |
| CVG-AUD26-007 | P0 | M | 006, 010, 020, 028, 034 | Renovar evidências e diagnósticos |
| CVG-AUD26-008 | P0 | L | 007, 030 | Executar qualificação dupla do mesmo sujeito |
| CVG-AUD26-009 | P0 | M | 001 | Limitar cardinalidade de telemetria |
| CVG-AUD26-010 | P0 | M | 009 | Fechar lifecycle de spans |
| CVG-AUD26-011 | P1 | M | 001 | Aplicar lifecycle a buckets de rate limit |
| CVG-AUD26-012 | P1 | M | 001 | Limitar streaming de modelos |
| CVG-AUD26-013 | P1 | M | 001 | Limitar streaming de mensageria |
| CVG-AUD26-014 | P1 | L | 001 | Endurecer DNS, redirects e SSRF |
| CVG-AUD26-015 | P1 | L | 001 | Validar respostas HTTP em runtime |
| CVG-AUD26-016 | P1 | L | 001 | Definir framework de migração de snapshots |
| CVG-AUD26-017 | P1 | XL | 016 | Migrar clínica, agenda e addenda |
| CVG-AUD26-018 | P1 | XL | 016 | Migrar hospital, estoque e medicações |
| CVG-AUD26-019 | P1 | XL | 016 | Migrar finanças, comunicação e conhecimento |
| CVG-AUD26-020 | P1 | XL | 016 | Migrar entidades de IA restantes |
| CVG-AUD26-021 | P2 | M | 001 | Adotar lint semântico e scanner dedicado |
| CVG-AUD26-022 | P2 | M | 021 | Introduzir cobertura e thresholds |
| CVG-AUD26-023 | P1 | L | 001 | Estabilizar E2E, portas e WebKit |
| CVG-AUD26-024 | P2 | M | 001 | Dividir bundle e impor budget |
| CVG-AUD26-025 | P2 | M | 001 | Tornar tokens e contraste gates reais |
| CVG-AUD26-026 | P1 | L | 001 | Reduzir contexto e compilar runtime |
| CVG-AUD26-027 | P1 | M | 026 | Pinar imagens por digest |
| CVG-AUD26-028 | P1 | L | 027 | Produzir e verificar atestações OCI |
| CVG-AUD26-029 | P2 | XL | mudanças funcionais correlatas | Modularizar arquivos centrais |
| CVG-AUD26-030 | P1 | M | 007, 029 | Sincronizar documentação e estado derivado |
| CVG-AUD26-031 | P2 | M | 001 | Fechar governança, toolchain e TypeScript |
| CVG-AUD26-032 | P0 | L | 009, 010 | Implantar logs duráveis |
| CVG-AUD26-033 | P1 | L | 032 | Definir SLOs e provar alertas |
| CVG-AUD26-034 | P0 | XL | 006, 028, 033 | Executar carga, caos e DR representativos |
| CVG-AUD26-035 | P0 | XL | 008, 034 | Qualificar ambiente e dependências externas |
| CVG-AUD26-036 | P0 | L | todos | Reauditar e submeter aprovação humana |

## Backlog detalhado

### CVG-AUD26-001 — Reconciliar o control plane e congelar o baseline

**Prioridade/tamanho:** P0 / M
**Achado:** F04
**Objetivo:** corrigir falsos verdes existentes e estabelecer uma fonte única de verdade antes da implementação.

**Critérios de aceite:**

1. Inventário das mudanças rastreadas e não rastreadas registrado sem descarte.
2. `AUD25-002` e `AUD25-003` reabertos por transição append-only se seus critérios seguirem pendentes.
3. As 36 tarefas de `CVG-AUD26` importadas para `.agent` no schema vigente, com dependências, severidade e estado inicial correto.
4. Fingerprint, toolchain, comandos baseline e falhas conhecidas registrados.
5. Promoção permanece bloqueada e nenhum item recebe `DONE` retroativo.

**Evidência:** diff escopado do control plane, validação de schema, log de reconciliação e saída baseline.

### CVG-AUD26-002 — Fechar o contrato dos sete atributos de role de restore

**Prioridade/tamanho:** P0 / M
**Achados:** F01, F02
**Objetivo:** exigir `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOLOGIN`, `NOREPLICATION` e ausência de `BYPASSRLS` conforme o contrato definido.

**Critérios de aceite:**

1. O runtime rejeita individualmente cada atributo proibido.
2. Uma migration forward-only corrige a role sem editar migration potencialmente aplicada.
3. Upgrade de banco existente e criação limpa convergem ao mesmo estado.
4. Mensagens não expõem segredo e identificam a classe do desvio.

**Evidência:** testes unitários/integrados por atributo e inspeção SQL em PostgreSQL descartável.

### CVG-AUD26-003 — Completar a matriz real de autoridade PostgreSQL

**Prioridade/tamanho:** P0 / M
**Achado:** F03
**Objetivo:** provar o contrato da role contra combinações positivas e negativas reais.

**Critérios de aceite:**

1. A matriz cobre todos os atributos, memberships, ownership e privilégios necessários/proibidos.
2. Cada linha negativa falha pela razão esperada.
3. A role mínima conclui somente as operações autorizadas.
4. O verificador usa instância efêmera e não toca banco compartilhado.

**Evidência:** relatório estruturado da matriz e testes PostgreSQL reproduzíveis.

### CVG-AUD26-004 — Remover autoridade fabricada do verificador

**Prioridade/tamanho:** P0 / M
**Achado:** F05
**Objetivo:** impedir que o próprio teste conceda permissões que invalidem a prova.

**Critérios de aceite:**

1. Remoção de `GRANT ALL`, ownership amplo e `CREATE` não requeridos.
2. Setup do teste espelha a autoridade documentada do runtime.
3. Cenário known-bad demonstra que permissões extras seriam detectadas.
4. A prova continua verde apenas com privilégios mínimos explícitos.

**Evidência:** diff SQL, inventário de grants e execução da matriz antes/depois.

### CVG-AUD26-005 — Provar rollback público em falha tardia

**Prioridade/tamanho:** P0 / L
**Achado:** F06
**Objetivo:** demonstrar atomicidade quando a falha ocorre depois de mutações parciais.

**Critérios de aceite:**

1. Existe failpoint determinístico depois da primeira mutação relevante.
2. Após a falha, dados, ledger, outbox, leases e metadados ficam no estado especificado.
3. A operação pode ser retomada ou rejeitada sem duplicar efeitos.
4. O teste known-bad falha quando a fronteira transacional é removida.

**Evidência:** snapshot lógico pré/pós, logs correlacionados e teste integrado PostgreSQL.

### CVG-AUD26-006 — Qualificar replay, concorrência e resultado ambíguo

**Prioridade/tamanho:** P0 / L
**Achado:** F07
**Objetivo:** fechar a semântica distribuída do restore em condições adversas.

**Critérios de aceite:**

1. Matriz cobre replay idêntico/divergente, base não vazia, concorrência, crash, desconexão e timeout.
2. `outcome unknown` nunca é convertido silenciosamente em sucesso ou retry destrutivo.
3. Há um único estado terminal válido e efeitos idempotentes/fenced.
4. Recuperação após reconnect reconcilia pelo ledger autoritativo.

**Evidência:** testes concorrentes repetidos, recibos de recovery e invariantes de banco.

### CVG-AUD26-007 — Renovar evidências e preservar diagnósticos completos

**Prioridade/tamanho:** P0 / M
**Achados:** F08, F35
**Objetivo:** garantir evidência fresca e falhas diagnosticáveis.

**Critérios de aceite:**

1. O runner preserva comando, exit code, stdout e stderr completos em artefato, com resumo útil no console.
2. Hashes e freshness são recalculados somente para a candidata congelada.
3. Evidência velha ou de outro fingerprint falha explicitamente.
4. `verify:static` passa sem afrouxar regras.

**Evidência:** caso negativo com receipt stale, artefato de falha completo e execução verde corrente.

### CVG-AUD26-008 — Executar duas qualificações limpas do mesmo fingerprint

**Prioridade/tamanho:** P0 / L
**Achado:** F09
**Objetivo:** demonstrar repetibilidade da candidata exata.

**Critérios de aceite:**

1. O sujeito é congelado e identificado por commit/manifest/digests.
2. Duas execuções completas, independentes e consecutivas ficam verdes.
3. Nenhum arquivo qualificável muda entre as execuções.
4. Receipts apontam para o mesmo fingerprint e ambiente declarado.

**Evidência:** dois manifests/receipts verificáveis e comparação automatizada dos fingerprints.

### CVG-AUD26-009 — Normalizar e limitar cardinalidade de telemetria

**Prioridade/tamanho:** P0 / M
**Achado:** F10
**Objetivo:** impedir que URLs, IDs ou entradas do usuário criem séries e operações ilimitadas.

**Critérios de aceite:**

1. Spans e métricas usam route template ou operação estável.
2. Query, IDs, prompts e payloads não aparecem em nomes/dimensões.
3. Estruturas internas têm limite e política de overflow/eviction observável.
4. Teste com 10 mil URLs distintas mantém cardinalidade dentro do budget documentado.

**Evidência:** teste de cardinalidade, inspeção de atributos e métrica de overflow.

### CVG-AUD26-010 — Encerrar spans em todos os caminhos

**Prioridade/tamanho:** P0 / M
**Achados:** F10, F20
**Objetivo:** evitar spans órfãos e preservar status correto em abortos e timeouts.

**Critérios de aceite:**

1. Finalização idempotente cobre response, error, abort, timeout e socket close.
2. Cada request abre e encerra no máximo um span servidor.
3. Status e motivo distinguem sucesso, erro, cancelamento e deadline.
4. Após carga adversa, contador de spans abertos retorna a zero.

**Evidência:** matriz de lifecycle e teste de carga/abort controlado.

### CVG-AUD26-011 — Aplicar lifecycle aos buckets de rate limit

**Prioridade/tamanho:** P1 / M
**Achado:** F15
**Objetivo:** limitar crescimento de estado distribuído sem quebrar a proteção.

**Critérios de aceite:**

1. Retenção e índice de expiração são documentados.
2. Limpeza é incremental, idempotente, concorrente e não bloqueia o hot path.
3. Métricas informam linhas, atraso e falhas de cleanup.
4. Teste prova preservação de buckets ativos e remoção dos expirados.

**Evidência:** migration/job, plano de query e teste PostgreSQL com relógio controlado.

### CVG-AUD26-012 — Limitar respostas de modelos durante streaming

**Prioridade/tamanho:** P1 / M
**Achado:** F17
**Objetivo:** interromper corpos oversized antes de ocuparem memória ilimitada.

**Critérios de aceite:**

1. Leitura incremental conta bytes e cancela o stream no limite.
2. Content-Length conhecido e resposta chunked seguem a mesma política.
3. Timeout, abort e erro retornam classes estáveis e sem conteúdo sensível.
4. Teste prova memória/bytes limitados com servidor hostil.

**Evidência:** testes de boundary e chunked infinito, com cancelamento observado.

### CVG-AUD26-013 — Limitar respostas de mensageria durante streaming

**Prioridade/tamanho:** P1 / M
**Achado:** F18
**Objetivo:** aplicar limite incremental às integrações de mensagens.

**Critérios de aceite:**

1. O limite atua antes do buffering completo.
2. Respostas comprimidas, chunked e sem tamanho declarado são cobertas.
3. Conexão é cancelada e recursos são liberados ao exceder o budget.
4. Retentativas não transformam oversized permanente em tempestade.

**Evidência:** servidor de teste controlado, contagem de bytes e testes de retry.

### CVG-AUD26-014 — Endurecer resolução DNS, redirects e SSRF

**Prioridade/tamanho:** P1 / L
**Achado:** F19
**Objetivo:** bloquear destinos privados/reservados mesmo com rebinding ou redirect.

**Critérios de aceite:**

1. Todos os endereços resolvidos são validados contra política de rede.
2. A conexão é vinculada ao resultado validado ou revalidada de forma segura.
3. Cada redirect repete allowlist, protocolo, porta e validação de endereço.
4. IPv4, IPv6, representações alternativas e DNS rebinding têm casos negativos.

**Evidência:** DNS stub/servidor controlado e matriz SSRF automatizada.

### CVG-AUD26-015 — Validar respostas da API em runtime

**Prioridade/tamanho:** P1 / L
**Achado:** F16
**Objetivo:** tornar o schema de resposta um contrato executável na fronteira HTTP.

**Critérios de aceite:**

1. Respostas são validadas antes do envio para rotas catalogadas.
2. Falha não vaza payload inválido ou informação sensível.
3. Streaming/binary/204 têm política explícita e testada.
4. Existe teste de conformidade para todas as operações catalogadas.

**Evidência:** testes positivos/negativos por classe de resposta e cobertura do catálogo.

### CVG-AUD26-016 — Definir framework de migração snapshot → comando

**Prioridade/tamanho:** P1 / L
**Achado:** F11
**Objetivo:** criar padrão seguro e repetível para migrar as 24 coleções snapshot-primary.

**Critérios de aceite:**

1. Inventário autoritativo classifica as 32 coleções e seus donos.
2. ADR define comando, aggregate/version, idempotência, autorização, transação, eventos e reconciliação.
3. Estratégia define backfill, dual-read/dual-write somente quando indispensável, cutover e remoção.
4. Harness comum testa concorrência, replay, equivalência e rollback lógico.

**Evidência:** ADR aprovado, inventário gerado e harness demonstrado em slice piloto.

### CVG-AUD26-017 — Migrar clínica, agenda e addenda

**Prioridade/tamanho:** P1 / XL
**Achado:** F11
**Objetivo:** substituir snapshots restantes desses domínios por comandos autoritativos.

**Critérios de aceite:**

1. Cada coleção do slice possui comando, versão e autorização explícitos.
2. Backfill é idempotente e reconciliado por contagem/hash/invariantes.
3. Concorrência e replay não perdem atualizações.
4. Caminho snapshot-primary é removido depois da equivalência.

**Evidência:** migrations, testes por domínio e relatório de reconciliação.

### CVG-AUD26-018 — Migrar hospital, estoque e medicações

**Prioridade/tamanho:** P1 / XL
**Achado:** F11
**Objetivo:** garantir autoridade transacional e invariantes de estoque/uso clínico.

**Critérios de aceite:**

1. Reservas, baixas, ajustes e administração têm comandos idempotentes.
2. Invariantes de quantidade, lote, validade e vínculo clínico são transacionais.
3. Backfill e concorrência são reconciliados sem quantidade negativa indevida.
4. Auditoria identifica ator, motivo e correlação.

**Evidência:** matriz de invariantes, testes concorrentes e reconciliação do slice.

### CVG-AUD26-019 — Migrar finanças, comunicação e conhecimento

**Prioridade/tamanho:** P1 / XL
**Achado:** F11
**Objetivo:** tornar lançamentos, mensagens e conhecimento mutável auditáveis e concorrentes.

**Critérios de aceite:**

1. Operações financeiras são append-only ou compensatórias, nunca sobrescritas silenciosamente.
2. Mensagens usam idempotência/outbox e estados terminais explícitos.
3. Conteúdo de conhecimento possui versionamento e autoria.
4. Backfill e reconciliação preservam totais e relacionamentos.

**Evidência:** testes de invariantes, ledger/outbox e relatório de equivalência.

### CVG-AUD26-020 — Migrar entidades de IA restantes

**Prioridade/tamanho:** P1 / XL
**Achado:** F11
**Objetivo:** aplicar autoridade explícita a sessões, tarefas, artefatos e políticas de agentes ainda baseados em snapshots.

**Critérios de aceite:**

1. Mudanças são versionadas, autorizadas e correlacionadas à sessão/ator.
2. Aprovações e efeitos externos preservam gates humanos e idempotência.
3. Replay, lease/fencing e outcome unknown têm semântica definida.
4. Todas as 32 coleções terminam classificadas e sem snapshot-primary residual não aprovado.

**Evidência:** inventário final, testes de sessão/runtime e reconciliação.

### CVG-AUD26-021 — Adotar ESLint semântico e secret scanner dedicado

**Prioridade/tamanho:** P2 / M
**Achados:** F24, F36
**Objetivo:** ampliar detecção estática sem perder regras específicas do projeto.

**Critérios de aceite:**

1. ESLint cobre TypeScript, React, hooks, imports e promessas com versão pinada.
2. Checks customizados úteis continuam como complemento.
3. Scanner dedicado cobre arquivos atuais e histórico no CI apropriado.
4. Baseline/exceções são mínimos, documentados, com dono e expiração.

**Evidência:** fixtures known-bad, execução CI e inventário de exceções.

### CVG-AUD26-022 — Introduzir cobertura e thresholds

**Prioridade/tamanho:** P2 / M
**Achado:** F25
**Objetivo:** medir e bloquear perda de cobertura relevante.

**Critérios de aceite:**

1. Cobertura de linhas, branches, funções e statements é publicada.
2. Threshold global inicial não fica abaixo do baseline real.
3. Restore, auth/PDP, persistência e integrações têm thresholds por pacote superiores ou explícitos.
4. Código gerado e exclusões têm justificativa documentada.

**Evidência:** relatório versionado como artefato CI e teste de threshold negativo.

### CVG-AUD26-023 — Estabilizar E2E e habilitar WebKit real

**Prioridade/tamanho:** P1 / L
**Achados:** F21, F22, F23
**Objetivo:** eliminar colisões de infraestrutura, flake conhecida e cobertura falsamente ignorada.

**Critérios de aceite:**

1. Portas são efêmeras ou alocadas por worker e processos são encerrados com segurança.
2. Dados, storage e relógio são isolados por teste/worker.
3. Causa do caso tablet é corrigida e uma repetição controlada atende ao budget de flake.
4. Root boundary executa em WebKit quando o navegador está instalado.

**Evidência:** múltiplas repetições, execução concorrente e matriz Chromium/Firefox/WebKit.

### CVG-AUD26-024 — Dividir bundle e impor budget de frontend

**Prioridade/tamanho:** P2 / M
**Achado:** F26
**Objetivo:** reduzir custo inicial e tornar regressões visíveis.

**Critérios de aceite:**

1. Baseline por chunk e total comprimido é publicado.
2. Rotas/features pesadas usam divisão assíncrona coerente.
3. CI falha acima do budget definido, com margem explicitada.
4. Fluxos críticos continuam funcionais sob rede/CPU simuladas.

**Evidência:** manifest de bundle, comparação antes/depois e smoke E2E.

### CVG-AUD26-025 — Tornar tokens e contraste gates efetivos

**Prioridade/tamanho:** P2 / M
**Achados:** F27, F28
**Objetivo:** fazer o modo strict bloquear violações e testar a UI real.

**Critérios de aceite:**

1. Severidades e exit codes do auditor de tokens são documentados e efetivos.
2. Os 73 achados são corrigidos ou recebem exceção temporária com dono/expiração.
3. Contraste cobre componentes/estados renderizados em temas suportados.
4. Testes incluem foco, disabled, hover, erro e conteúdo dinâmico relevante.

**Evidência:** fixtures negativas, relatório de acessibilidade e execução CI.

### CVG-AUD26-026 — Reduzir contexto Docker e compilar o runtime

**Prioridade/tamanho:** P1 / L
**Achados:** F29, F32
**Objetivo:** criar imagens mínimas sem fontes, caches e ferramentas desnecessárias.

**Critérios de aceite:**

1. `.dockerignore` exclui `.git`, `node_modules`, evidências locais, caches e segredos sem excluir inputs necessários.
2. Build multi-stage compila API/worker e executa JavaScript produzido sem `tsx`.
3. Imagem final usa usuário não root e contém somente runtime/migrations estritamente requeridos.
4. Smoke, healthcheck e migrations funcionam a partir da imagem.

**Evidência:** tamanho/contexto antes/depois, inventário da imagem e testes containerizados.

### CVG-AUD26-027 — Pinar imagens base por digest

**Prioridade/tamanho:** P1 / M
**Achado:** F30
**Objetivo:** tornar builds reproduzíveis sem abandonar atualizações de segurança.

**Critérios de aceite:**

1. Dockerfiles e composes usam tag legível mais digest imutável.
2. Digests suportam as arquiteturas declaradas.
3. Bot/processo propõe updates com changelog e verificação.
4. CI falha para referência mutável fora de allowlist temporária.

**Evidência:** scanner de referências e rebuild comparável do mesmo sujeito.

### CVG-AUD26-028 — Gerar, assinar e verificar atestações OCI

**Prioridade/tamanho:** P1 / L
**Achado:** F31
**Objetivo:** associar SBOM, proveniência e assinatura ao digest publicado.

**Critérios de aceite:**

1. CI autorizado produz SBOM OCI e proveniência nativa sem desativação.
2. Assinatura usa identidade/key management aprovado, nunca segredo hardcoded.
3. Política verifica issuer/identity, digest e atestações antes de promoção.
4. O SBOM próprio continua apenas se complementar e consistente.

**Evidência:** comandos de verificação, attestation refs e teste negativo de digest divergente.

### CVG-AUD26-029 — Modularizar arquivos centrais por seams

**Prioridade/tamanho:** P2 / XL
**Achado:** F34
**Objetivo:** reduzir acoplamento de persistência, API, domínio e contratos sem reescrita big-bang.

**Critérios de aceite:**

1. Mapa de módulos e dependências evita ciclos e define ownership.
2. Extrações preservam APIs públicas ou incluem migração explícita de consumidores.
3. Cada slice tem teste de caracterização antes e regressão depois.
4. Arquivos de entrada tornam-se composição, não repositório de toda a lógica.

**Evidência:** grafo de dependências, testes de caracterização e métricas de tamanho/acoplamento.

### CVG-AUD26-030 — Sincronizar documentação e estado derivado

**Prioridade/tamanho:** P1 / M
**Achado:** F33
**Objetivo:** eliminar números e status contraditórios sem duplicar verdade manualmente.

**Critérios de aceite:**

1. README e índice refletem migration, testes e programa ativos correntes.
2. Dados voláteis são gerados ou apontam para fonte canônica em vez de cópia manual.
3. Link checker e validação de claims detectam referências quebradas/stale.
4. Documentos históricos permanecem identificados como históricos.

**Evidência:** check automatizado de docs e diff de reconciliação.

### CVG-AUD26-031 — Fechar governança, toolchain e TypeScript

**Prioridade/tamanho:** P2 / M
**Achados:** F37, F38, F39
**Objetivo:** melhorar reprodução, contribuição e disciplina do compilador.

**Critérios de aceite:**

1. `packageManager` fixa versão exata compatível com CI.
2. `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` e licença são adicionados com conteúdo aprovado; decisões legais exigem humano.
3. `noUnusedLocals` e `noUnusedParameters` são habilitados após limpeza.
4. `skipLibCheck` é removido ou recebe decisão registrada, issue e prazo após medir incompatibilidades.

**Evidência:** install reproduzível, typecheck e validação dos arquivos de governança.

### CVG-AUD26-032 — Implantar logs duráveis e pesquisáveis

**Prioridade/tamanho:** P0 / L
**Achado:** F12
**Objetivo:** manter logs além do processo/collector debug, com correlação e proteção de dados.

**Critérios de aceite:**

1. Collector exporta para backend durável aprovado, com TLS/auth quando aplicável.
2. Retenção, acesso, redaction e campos permitidos são documentados.
3. Logs correlacionam request, trace, operação e resultado sem PHI/segredos indevidos.
4. Falha/pressão do backend tem buffering/queda controlada e métricas.

**Evidência:** consulta de evento após reinício, teste de redaction e recibo de retenção.

### CVG-AUD26-033 — Definir SLOs e provar alertas

**Prioridade/tamanho:** P1 / L
**Achados:** F13, F14
**Objetivo:** converter sinais em objetivos e respostas operacionais.

**Critérios de aceite:**

1. SLIs/SLOs cobrem disponibilidade, latência, erros, filas, restore e dependências críticas.
2. Alertas têm severidade, janela, runbook, owner e canal.
3. Drills provam geração, roteamento, recebimento e resolução.
4. Burn-rate e ruído são revisados com dados representativos.

**Evidência:** regras, dashboards, runbooks e receipts de drills.

### CVG-AUD26-034 — Executar carga, caos e DR representativos

**Prioridade/tamanho:** P0 / XL
**Achado:** F13
**Objetivo:** medir limites, degradação e recuperação em ambiente semelhante ao alvo.

**Critérios de aceite:**

1. Perfil de carga representa mix, concorrência e tamanhos reais sem dados sensíveis.
2. Caos cobre processo, rede, banco, fila, provider e collector em blast radius autorizado.
3. Backup/restore gerenciado é executado e validado ponta a ponta.
4. RTO/RPO reais são medidos, comparados aos objetivos e têm ação para desvios.

**Evidência:** planos, métricas, receipts, relatórios de integridade e cleanup.

### CVG-AUD26-035 — Qualificar staging e dependências externas

**Prioridade/tamanho:** P0 / XL
**Achado:** F14
**Objetivo:** fechar o que não pode ser legitimamente provado apenas no ambiente local.

**Critérios de aceite:**

1. Staging usa topologia, políticas e artefato comparáveis ao alvo.
2. Provedores reais são testados com contas/limites autorizados e segredos gerenciados.
3. Collector durável, SLOs e alertas são comprovados no ambiente.
4. Testes de aceitação e inspeção manual de zoom/responsividade são registrados.

**Evidência:** receipts externos, digests, resultados de AT e checklist humano. Se faltar autoridade, estado correto é `BLOCKED_EXTERNAL`, nunca `DONE`.

### CVG-AUD26-036 — Reauditar e submeter aprovação humana

**Prioridade/tamanho:** P0 / L
**Achados:** F01–F39
**Objetivo:** confirmar fechamento integral e entregar a decisão de promoção à autoridade humana.

**Critérios de aceite:**

1. Reauditoria independente reavalia os 39 achados e recalcula score com método documentado.
2. Matriz achado → tarefa → commit/diff → teste → receipt não contém lacunas.
3. Riscos residuais e exceções têm owner, prazo e aceite explícito.
4. Aprovação ou rejeição humana é registrada sem ser simulada pelo agente.

**Evidência:** relatório final, matriz de rastreabilidade, dois receipts do mesmo fingerprint e decisão humana.

## Matriz de rastreabilidade dos 39 achados

| Achado | Severidade | Tarefa(s) |
|---:|---|---|
| F01 | Alto | 002, 003 |
| F02 | Alto | 002 |
| F03 | Alto | 003 |
| F04 | Alto | 001 |
| F05 | Alto | 004 |
| F06 | Alto | 005 |
| F07 | Alto | 006 |
| F08 | Alto | 007 |
| F09 | Alto | 008 |
| F10 | Alto | 009, 010 |
| F11 | Alto | 016, 017, 018, 019, 020 |
| F12 | Alto | 032 |
| F13 | Alto | 033, 034 |
| F14 | Alto | 033, 035, 036 |
| F15 | Médio | 011 |
| F16 | Médio | 015 |
| F17 | Médio | 012 |
| F18 | Médio | 013 |
| F19 | Médio | 014 |
| F20 | Médio | 010 |
| F21 | Médio | 023 |
| F22 | Médio | 023 |
| F23 | Médio | 023 |
| F24 | Médio | 021 |
| F25 | Médio | 022 |
| F26 | Médio | 024 |
| F27 | Médio | 025 |
| F28 | Médio | 025 |
| F29 | Médio | 026 |
| F30 | Médio | 027 |
| F31 | Médio | 028 |
| F32 | Médio | 026 |
| F33 | Médio | 030 |
| F34 | Médio | 029 |
| F35 | Médio | 007 |
| F36 | Médio | 021 |
| F37 | Baixo | 031 |
| F38 | Baixo | 031 |
| F39 | Baixo | 031 |

## Definition of Done do programa

- Todas as tarefas possuem estado canônico e evidência corrente.
- Todos os achados têm fechamento demonstrável ou risco formalmente aceito pela autoridade correta.
- Nenhuma task P0/P1 permanece aberta para promoção.
- Suítes locais, PostgreSQL, E2E, CI, supply chain e operação passam no mesmo sujeito.
- Duas qualificações limpas consecutivas apontam para o mesmo fingerprint.
- Staging e gates externos estão comprovados.
- A reauditoria foi concluída e a decisão humana foi registrada.
