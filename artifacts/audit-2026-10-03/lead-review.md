# Revisão técnica complementar do coordenador — 03/10/2026

Escopo concluído: arquitetura/backend, domínio, contratos, persistência, recuperação, CI, observabilidade e interpretação dos testes. Leitura operacional: 76/76 arquivos, registrada em `operations-read-ledger.json`. Os 89 documentos de arquitetura foram lidos pela trilha especializada; após falha da ferramenta daquele revisor, a inspeção de código e a conclusão destas dimensões foram assumidas pelo coordenador. Isso não constitui um segundo parecer independente de arquitetura.

## Código atual inspecionado

`apps/api/src/app.ts:563` carrega a revisão durável e coordena requisições por organização. `:595` centraliza o commit; `:615` escolhe o fork isolado; `:629` envia snapshot, receipts, auditoria e escritas normalizadas para persistência; `:661` adota o fork somente depois do sucesso. A coordenação evita expor uma mutação remota não confirmada. A concentração do commit e seus muitos parâmetros opcionais aumentam o custo de manutenção; não foi demonstrada perda de atomicidade por esse formato.

`packages/persistence/src/authoritative-writes.ts:12` e demais writers usam parâmetros SQL, escopo transacional, equivalência de valores e RETURNING. A assinatura clínica exige transição e versão. `packages/persistence/src/snapshot-migration.ts:10` define as autoridades; `:31` enumera oito owners normalizados, e `:49` mantém os outros 24 como SNAPSHOT_PRIMARY. As 24 fatias passaram na prova PostgreSQL atual, mas isso não altera seu owner nem significa cutover. Snapshot durável com CAS é uma escolha arquitetural válida; a dívida é sua concentração e a qualificação ainda aberta da migração, não a mera existência de snapshots.

`packages/contracts/src/api-catalog.ts:32` inventaria a superfície nominal de 105 rotas e exige schemas conhecidos, versão, operação e autenticação. O registro efetivo em `apps/api/src/response-schemas/index.ts:17` exige 80/80 schemas, rejeita lacunas/duplicações e alimenta `apps/api/src/response-contract.ts:48`, que substitui a metadata nominal por PAYLOAD_AND_ENVELOPE. `:116` valida o payload de sucesso; `apps/web/src/api/validation.ts` aplica validação semântica estrita nos endpoints consumidos. Assim, os rótulos ENVELOPE_ONLY do catálogo nominal NÃO demonstram ausência de validação atual. Os gates de contratos/PDP passaram. Esses controles são mérito substancial; um scanner AST não demonstra sozinho todo interleaving distribuído.

No domínio, `packages/domain/src/index.ts:1450` protege versão/estado do rascunho; `:1499` exige veterinário, revisão explícita, vínculo paciente/atendimento e versão para assinar; `:1523` mantém adendos separados. `:1637` valida prescrição/encounter/produto, `:1650` vincula dispensação a lote/produto/escopo, `:1664` rejeita duplo registro de administração dentro de 60 segundos, e `:1708` exige documento assinado e resolução mínima de pendências para alta. Esse bloqueio de 60 segundos é anti-duplo-envio, não um motor de aprazamento ou validação clínica de doses.

`packages/domain/src/index.ts:1800` registra cobranças em centavos no ledger; `:1810` rejeita pagamento superior ao saldo e `:1823` preserva lançamento compensatório de estorno. Essas verificações e jornadas sintéticas não são prova de liquidação Pix/cartão ou política contábil completa. Assinatura clínica de aplicação também não foi apresentada como assinatura digital certificada.

## Recuperação: falha presente com causa delimitada

O wrapper PostgreSQL terminou com falha no oracle de `audit_records`, em `scripts/verify-postgres-restore.ts:806`. O código compara relações SQL exatas depois de confirmar o restore quarentenado, revogar autoridade de sessão e exercitar rollback tardio. O log da execução atual confirma a divergência; não registra uma restauração globalmente aprovada.

`docs/verification/aud27-restore-drill-finding-2026-09-26.md` descreve a incompatibilidade: o verificador de comportamento semeia sondas RLS não encadeadas na mesma organização; o bundle recupera a autoridade de snapshot; o oracle pede a relação inteira. Isso explica uma hipótese forte e reproduz o sintoma histórico. Não foram contadas novamente as linhas atuais nem demonstrada perda de dados clínicos autoritativos. É necessário fechar a composição, não ignorar a falha ou enfraquecer a comparação.

`apps/worker/src/operational-backup.ts:39` limita o backup a organização explícita, chave resolvida e bundle correspondente; `packages/persistence/src/operational-backup-job.ts:31` coalesce execuções concorrentes no processo, verifica os arquivos e retém falhas. Existem backup cifrado e retenção, mas uma rotina de cópia não compensa um drill de recuperação reprovado. RTO/RPO e recuperação em infraestrutura de operação permanecem sem medição atual.

## Controle de evidências e documentação

O registro `.agent/verification.jsonl:874` declara exit agregado zero enquanto um comando filho de restore encerra com um. `scripts/verify-control-plane.ts:485` rejeita essa composição. `tests/unit/control-plane-aud23.test.ts:141` usa o estado vivo como fixture conhecido-bom e falha com COMPOSITE_EXIT_DIVERGENT. Essa única causa também derruba npm test e o gate de cobertura. O reparo apropriado é preservar a história, acrescentar um recibo coerente e estabilizar fixtures; não fabricar sucesso, apagar o recibo antigo ou relaxar o validador.

O root externo AUD27 e recibos MEL23 não qualificaram SHA/fingerprint do candidato atual. Contagens e estados duplicados de `.agent/state.json` também conservam fotografias anteriores. Históricos datados foram tratados como história; somente alegações de estado atual divergentes pesam como inconsistência documental. O verificador de links passou em 270 Markdown, mas essa prova não substitui leitura de conteúdo nem consistência semântica.

## CI, dependências e efeitos da própria auditoria

`.github/workflows/ci.yml:10` usa permissão contents:read; ações, Node/npm e imagem PostgreSQL estão fixados; instalação com scripts desabilitados, scanners, SBOM, matrizes de browser e PostgreSQL são passos explícitos. A sequência repete parte das suítes dentro de verify:production e grava diagnósticos em caminhos compartilhados; isso aumenta custo e favorece colisões entre execuções locais.

O gate completo atual terminou com três falhas: testes de unidade/integração, dependências e espaços em branco. A última foi causada pelo próprio relatório gerado de cobertura desta auditoria (`artifacts/coverage-output.txt`), não por fonte preexistente. Os 23 outputs versionados gerados foram arquivados integralmente em `generated/` e restaurados aos bytes inicialmente limpos; veja `generated-preservation.json`. Não se reclassificou retroativamente o gate completo como PASS.

O audit npm encontrou dois pacotes afetados moderados, Fastify e fast-uri, e nenhum high/critical. As condições dos três advisories foram verificadas em fontes oficiais públicas em 03/10/2026. No código inspecionado não se identificou ativação HTTP/2 com trailer, comparação de host autorizativo via fast-uri ou fluxo mailto afetado. Ausência de caminho encontrado não elimina a necessidade de atualização e regressão. Não houve instalação ou alteração de lockfile.

## Observabilidade, desempenho e manutenção

`packages/ops/src/index.ts:174` implementa sink durável; `:305` mantém telemetria limitada; `:528` e `:545` tratam redação; `packages/ops/src/otel.ts:37` valida endpoint/TLS e `:63` integra spans OTLP. Há instrumentos e controles úteis; entrega real de alertas, collector externo e cobertura de operação não foram executados.

`packages/ops/src/index.ts:850` marca os SLOs como PROPOSED e mantém RTO/RPO sem alvo numérico aprovado. `scripts/benchmark-local.ts:5` usa 30 repetições, store em memória e stub. A própria saída exclui login, commit PostgreSQL, RLS, outbox, recovery e IA externa. Não há base nesta auditoria para afirmar capacidade de 50/100 usuários nem latência p95 de produção.

O gate arquitetural passou com 13 pacotes de runtime, zero ciclos e 18 budgets. Apesar disso, há concentração em `apps/api/src/app.ts` (2.446 linhas), `packages/domain/src/index.ts` (2.122), `packages/persistence/src/index.ts` (4.792) e `packages/contracts/src/index.ts` (2.000). As extrações já existentes são mérito. Próximas divisões devem acompanhar fronteiras transacionais e domínios reais, sem exigir reescrita ou microserviços para a clínica.

## Browser e limites de verificação

A matriz completa, arquivada em `generated/artifacts/aud26/production-gates/browser-e2e.json`, passou com 503 testes e 37 skips, total 540. O recorte de quatro projetos teve um timeout durante sobreposição de duas execuções com artefatos/cache compartilhados. A reprodução isolada de `app.spec.ts:33` passou três vezes, zero retries, zero flaky e zero falhas: `e2e-isolated.json`. Portanto o timeout não foi promovido a defeito confirmado do produto; a necessidade de isolamento dos outputs permanece.

Build/typecheck, lint, contratos, PDP, licenças, secret scan, 49 migrations e 24 fatias PostgreSQL passaram. A mutação seletiva matou 30/30 mutantes. As métricas de cobertura passaram seus limiares, mas o gate geral ficou vermelho por um teste. Relatórios finais devem conservar essa distinção.

Esta revisão não modificou fonte, migrations, dependências, `.agent`, produção ou serviços externos. O relatório consolidado deve juntar estes resultados à leitura completa das quatro trilhas e à revisão final de frontend.
