# Protocolo de implementação com múltiplos agentes

## Papéis e limite de concorrência

Use a capacidade informada pelo runtime. Neste ambiente existem quatro slots totais: **Lead + dois builders + um crítico**. Reservar um slot para revisão evita concluir várias implementações sem capacidade de julgá-las. A lista de 16 especialidades é um conjunto de papéis reutilizáveis; os 15 críticos finais podem atuar em sequência. Não pressupor 15 execuções simultâneas.

O Lead pode fazer trabalho local independente. Somente ele escreve em `.agent/` e integra candidatos. Builders não delegam descendentes e só entregam IMPLEMENTED/BLOCKED/FAILED. Review de uma tarefa não é aprovação global do produto; builder e critic devem ser instâncias distintas.

## Contrato mínimo antes do dispatch

Selecionar um ID do `backlog.json`, confirmar dependências e refinar qualquer tarefa L. Registrar no backlog canônico:

- tarefa/fatia, hipótese/reprodução, versão do contrato, critérios e entregável;
- owner real, branch/worktree e SHA base;
- arquivos exatos permitidos, arquivos reservados e locks de recursos;
- portas, origem web, database/schema, output, seeds e serviços de teste;
- comandos positivos/negativos, evidências esperadas e limite de tentativa;
- condições externas e decisão necessária, sem credenciais no brief;
- checksum do contrato congelado e próximo checkpoint.

Os campos `owned_paths` no catálogo são o teto de escopo planejado, não uma licença para editar o diretório inteiro em paralelo. Dois caminhos sobrepostos, como `apps/api/src/` e `apps/api/src/application/`, conflitam mesmo com nomes de locks diferentes. O scheduler verifica tanto a interseção de caminhos/globs quanto `exclusive_resources` antes de RUNNING. Resolva symlinks; não permita que aliases escondam colisão.

## Isolamento e integração

Preferir worktree por tarefa material: `cvg-aaa-ID`, branch `aaa/ID-descricao`, criada a partir do último candidato integrado. Como os documentos desta entrega podem estar ainda não commitados, o Lead deve primeiro garantir que o pacote esteja acessível no worktree por um commit de planejamento autorizado ou por cópia explícita apenas dos documentos e verificação de digests. Não perder alterações do usuário nem presumir que `git worktree add` incluiu arquivos untracked.

Não disparar `git reset --hard`, `git clean` ou drop de banco genérico. Worktree isola arquivos, mas não portas, Docker project name, banco, storage, queues ou segredos. Dê a cada tarefa o próprio namespace. No navegador, API port, Vite port, proxy e `CVG_WEB_ORIGIN` precisam concordar. Artefatos de Playwright têm diretório por tarefa/run. Cada migration nova tem identificador reservado pelo Lead e integração sequencial; não editar migrations já aplicadas.

Integração: inspecionar diff → verificar contrato e fronteira pública → receber crítica → corrigir → integrar uma entrega por vez → executar regressão afetada e prova integrada. SHA de branch anterior não prova o SHA de merge. Alteração de contrato invalida candidatos dependentes ainda não revalidados; devolver à revisão/rework em vez de ajustar silenciosamente.

## Estado único e transições

AAA-000 transforma os contratos planejados em itens idempotentes em `.agent/backlog.json`; os históricos permanecem. Aplicar os enums e invariantes do control plane instalado. READY/IMPLEMENTED/REVIEW/VERIFIED são estados operacionais de orquestração: se o schema canônico usar outros enums, representar isso em metadados validados e mapear explicitamente, sem gravar enum inválido nem criar outro backlog de status.

Fluxo lógico: PENDING → READY → RUNNING → IMPLEMENTED → REVIEW → VERIFIED → DONE; rejeição retorna REWORK; dependência externa ausente gera BLOCKED. O catálogo deste pacote continua sem status mutável. O Lead importa contratos por ID e guarda referência/checksum; nunca duplica tarefas a cada retomada.

DONE exige aceitação integrada. No handoff, incluir último efeito confirmado, trabalho incompleto, prova invalidada e próxima ação única. Para recuperar: ler instruções aplicáveis → validar SHA/dirty tree → localizar tarefa e locks → conferir evidências contra artefato → consultar recursos criados → continuar a ação registrada ou replanejar explicitamente.

## Template para builder

Copie e preencha com os dados reais da tarefa, sem encaminhar um papel genérico “melhore toda a segurança”.

```text
Papel: builder especialista para [ID], execução direta, sem subdelegação.
Objetivo: [resultado observável do contrato].
Fonte: docs/plano-aaa-2026-09-12/backlog.json, tarefa [ID].
Baseline: [SHA base e worktree]. Barra: .gauntlet/bar-v4.json [digest].
Entradas: [contrato, requisitos e reprodução atual].
Dependências verificadas: [IDs + evidências atuais].
Pode editar: [arquivos exatos]. Não pode editar: [arquivos reservados].
Recursos exclusivos: [locks, portas/origem, DB, outputs, ambiente].
Aceite: [critérios positivos e negativos do contrato].
Comandos/procedimentos: [comandos reais e precondições].
Limite inicial: [sessões/teto autorizado]; duas tentativas por hipótese.
Nova tentativa exige evidência nova; mesma falha sem informação retorna ao Lead.
Autorização: [local-write; serviços de teste explicitamente autorizados].
Não alterar barra, aprovações, status canônico, testes para ocultar falha ou dados reais.
Retorne IMPLEMENTED/BLOCKED/FAILED, diff, contratos afetados, comandos com
exit codes, artefatos/digests, limitações, risco residual e próxima ação.
Não se declare DONE e não atribua nota AAA ao próprio trabalho.
```

## Template para crítico independente

Abrir agente novo com `fork_turns: "none"` quando disponível. Não enviar raciocínio do builder, nota pretendida ou pareceres anteriores. Fornecer o contrato original, testes de aceite e artefato concreto.

```text
Papel: crítico [especialidade], somente leitura, sem subdelegação.
Critérios: [IDs + barra congelada e fonte do requisito].
Candidato: [SHA/digest e cópia imutável].
Escopo: [fronteiras públicas, consumidores e recursos de teste].
Procedimentos: [como testar com dados isolados; saídas em diretório externo].
Não edite código, testes, baseline, documentos ou .agent/.gauntlet.
Não assuma que build ou relatório do autor provam o comportamento.
Procure casos negativos, contratos esquecidos, efeito duplicado e prova inválida.
Retorne APPROVE/REJECT/BLOCKED para este escopo; critério, severidade,
confiança, caminho/símbolo, reprodução, prova e maior lacuna primeiro.
Informe exatamente o que executou e o que não pôde verificar.
```

O Lead compara fingerprint antes/depois. Cópia imutável evita que trabalho paralelo do próprio Lead produza falso alarme de mutação do crítico. Checks que geram build/cache usam cópia isolada ou output externo, preservando a identidade do candidato julgado.

Independência: I0 = autor/self-review; I1 = outro agente da mesma família sem contexto herdado; I2 = modelo distinto ou gate determinístico externamente controlado; I3 = humano qualificado. Registrar nível real. I1 não inventa autoridade humana; indisponibilidade de reviewer não autoriza declarar AAA. Para decisões visuais materiais, dois críticos cegos e desempate quando necessário.

## Manifesto de evidência

Armazenar logs sanitizados e artefatos reais por tarefa/run. O manifesto deve conter:

```json
{
  "task_id": "ID_REAL",
  "criterion_ids": ["CRITERIO_REAL"],
  "subject_sha": "SHA_REAL",
  "artifact_digest": "SHA256_REAL",
  "contract_digest": "SHA256_DO_CONTRATO",
  "command_or_procedure": "PROCEDIMENTO_EXECUTADO",
  "executed": true,
  "exit_code": 0,
  "result": "PASS",
  "started_at": "TIMESTAMP_REAL",
  "finished_at": "TIMESTAMP_REAL",
  "environment": "AMBIENTE_REAL_SEM_SEGREDOS",
  "sample_and_seed": "AMOSTRA_REAL",
  "artifact_paths_and_digests": {},
  "producer": "IDENTIDADE_REAL",
  "reviewer": "IDENTIDADE_REAL",
  "independence": "I1",
  "limitations": [],
  "residual_risk": []
}
```

Este bloco é um modelo de preenchimento, não um receipt emitido. Para verificação manual sem processo, `exit_code` pode ser null; o contrato de receipts de promoção exige o formato real de `scripts/verify-triplo-aaa.ts`, inclusive exit 0 e assinaturas onde aplicável. Não adaptar o verificador para aceitar este exemplo.

Resultado possível: PASS, FAIL, NOT_RUN, BLOCKED, INVALID ou STALE. Só PASS atual satisfaz critério. As provas finais externas ficam em raiz real fora do checkout, sem symlink e conforme os verificadores do projeto. Nunca fabricar chaves privadas, assinaturas, identidade de humano ou receipt de provider.

## Política de testes, tentativas e parada

Cada bug precisa de reprodução que falhe no artefato antigo, teste positivo e negativo no novo e regressão coerente com o alcance. Testes não são adicionados só para contar. O Lead lê scripts antes de executá-los: `verify:production --structural` também executa gates locais, inclusive E2E; não rodá-lo em concorrência com testes que usam as mesmas portas.

Após duas tentativas da mesma hipótese sem progresso comprovado: preservar resultados, devolver diagnóstico ao Lead e mudar hipótese/método/partição antes de nova tentativa. Não encerrar programa por limite arbitrário de rodadas: continuar enquanto existir lacuna material com hipótese útil e recursos autorizados. Falta de ambiente, autoridade ou orçamento bloqueia só a dependência correspondente; o restante pronto continua.

O Gauntlet final exige 15 especialidades do roster do verificador, contexto novo, read-only, prova independente assinada e Final Critic distinto dos anteriores. Sem isso o candidato permanece não provado. A revisão deste pacote de planejamento não é crítica do programa implementado nem satisfaz F36.
