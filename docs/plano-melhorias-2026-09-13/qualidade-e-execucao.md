# Contrato de qualidade e execução para o agente

## Fontes e alcance

Leia [relatório](../auditoria-2026-09-13.md), [plano executivo](plano-executivo.md), [roadmap](roadmap.md), [catálogo](backlog.json) e [rastreabilidade](rastreabilidade.md). PRD/contratos/ADRs são autoridade de comportamento. A [barra v4](../../.gauntlet/bar-v4.json), o [prompt operacional final](../prompt-final-operational-proof-2026-09-10.txt) e a [ponte canônica](../plano-aaa-2026-09-12/qualidade.md) conservam as exigências de promoção: 39 fases,25 gates,22 dimensões e limiares próprios. O plano novo não modifica nem enfraquece essa barra.

As 16 notas da auditoria, a média 59 e a baseline 72 do relatório anterior têm escopos diferentes; não são métricas automáticas de promoção. Meta global continua Overall≥97 e limiares individuais da barra, zero High/Critical aberto e nenhuma prova obrigatória ausente. Aprovação de etapa local não é aprovação AAA.

## Ativação e fonte única de estado

1. Em AUD13-01, ler `.agent/state.json`, ExecPlan ativo, backlog, gates e caudas dos logs; conferir HEAD/diff e trabalhos concorrentes.
2. Para cada contrato AUD13, consultar `legacy_tasks`. Associar os novos critérios à tarefa legada compatível; não criar outra implementação para o mesmo resultado. Se uma tarefa estiver concluída, verificar se o novo achado contradiz seu aceite: reabrir apenas o escopo afetado, preservando resultado histórico.
3. Se não houver tarefa que possua a melhoria, adicionar uma tarefa filha AUD13 com relação explícita ao item do programa. Quando vários AUD13 refinam uma tarefa legada, manter o pai aberto até todas as fatias integrarem. Não converter a associação em dependências bidirecionais que criem ciclos.
4. Registrar a correspondência final no backlog canônico, mantendo os IDs e a origem dos critérios. `backlog.json` deste diretório é catálogo de contratos, sem status. `.agent/backlog.json` é o único dono de status, owner atribuído, próximo passo e evidências.
5. Criar/atualizar ExecPlan ativo sob `.agent/plans/` somente na futura execução. Atualizar artefato→backlog→log/verificação→state; preservar autoridade e alterações preexistentes.

## Contrato de tarefa e recursos

Cada tarefa tem objetivo, fonte, dependências, superfície máxima, recurso exclusivo, responsável técnico proposto, aceite, procedimentos, evidência, recuperação e próxima ação. Paths de diretório/glob são teto, não autorização para escrever em todo o pacote ao mesmo tempo. Antes de RUNNING, reservar arquivos exatos, migration number, portas, banco, filas, saída de logs e ambiente. Novo arquivo necessário deve ser nomeado nessa reserva; mudança de superfície exige registro pelo integrador.

O Lead pode dividir tarefas L em fatias verticais com dependências e aceites próprios. Preserve o requisito completo no pai. Não implementar camada/tela isolada como se fosse jornada concluída. Não esconder ausência usando somente disabled/toast; restrição legítima precisa ter razão, estado explícito e gate do requisito pendente.

Paralelo permitido quando fontes, contratos e recursos são disjuntos. API root, sessão, shared UI, domain-core, persistence-core, migrations, lockfile e staging têm dono exclusivo. Dois worktrees não tornam duas migrations incompatíveis seguras. Workers não criam descendentes; crítico lê candidato imóvel e não modifica artefato. Adapte número de agentes ao limite do host; configuração sugerida 1Lead+2builders+1crítico.

## Prova e aceite

- Antes da correção, reproduzir o defeito em dados sintéticos e registrar caso bom/ruim. Os scripts da auditoria que passam por confirmar um bug não são testes de aceite: a expectativa final deve exigir o comportamento correto.
- Testar comportamento pelo boundary apropriado: browser para fluxo/feedback; API/persistência para atomicidade; processos/DB reais para takeover; provider/receipt para efeito externo; operador/relógio para recovery.
- Usar suites existentes indicadas por tarefa; criar testes focados apenas quando necessário para distinguir o defeito. `npm test` não substitui PostgreSQL/integração externa/assistividade; teste de número de linhas ou substring não prova arquitetura/runtime.
- Comparar instalação e worktree exatos. Relatório de verificação inclui comando, início/fim, exit, versão, dataset/seed, screenshot/receipt/log sanitizado e hashes do artefato e contrato. Índice JSON não substitui conteúdo bruto verificável.
- `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED`, `STALE` e `INVALID` devem ser explícitos. Não gerar scores a partir de testes contados ou cards concluídos.
- Builder devolve implementação/evidência; Lead integra e crítico fresco julga. Se crítico escreveu, revisão é inválida e diff é preservado para inspeção. Checar fingerprint antes/depois.
- Após mudança material, teste focado, regressão plausível e nova crítica. Não repetir suíte inteira sem mudança/falha nova; não reexecutar até verde apagando a primeira falha.

## Critérios transversais de produto

Cada FR do PRD deve ter jornada ou boundary com entradas, resultado e erro recuperável; [rastreabilidade](rastreabilidade.md) mapeia todos 22 FRs e 13 NFRs. Auditoria, autorização, idempotência, moeda em centavos, versões, origem e isolamento são invariantes em cada escrita. A disponibilidade do modelo nunca transforma rascunho em fato nem substitui assinatura clínica. Dados D3–D5 não persistem no composer offline; perda de contexto purga buffer. Falha externa incerta nunca implica retry cego.

Padronizar respostas e UI de loading/vazio/erro/sem permissão/offline/stale/revalidando/sucesso parcial. Acessibilidade avalia estados após interação, com geometria de controles e contexto correto; ausência de overflow ou axe limpo não basta.

## Ambientes e decisões externas

Trabalho local necessário, reversível e já autorizado pode prosseguir sem reconfirmar. A definição de schema para estorno desconhecido não autoriza inventar política contábil. Decisões clínicas/financeiras/residência/retention, custos externos, canais de envio, escopo de ataque e produção exigem autoridade aplicável; use o que já estiver explicitamente autorizado antes de perguntar. Entregar contrato/candidato concreto antes de solicitar aceite final. Credenciais permanecem fora de logs/docs/Git.

Envios de mensagens, implantação pública e efeitos financeiros reais não são autorizados por este plano. AUD13-26 identifica recursos; dependentes têm etapa local e etapa real separadas. Precondição ausente é BLOCKED apenas na parte dependente, não autorização para omitir o requisito nem motivo para parar todas as frentes locais.

## Recuperação, conclusão e revisão

Ao parar, registrar tarefa/candidato, últimos resultados, recursos criados, efeitos incertos e próxima ação singular. Nunca limpar worktree alheio. Mudança local não integrada pode ser revertida pelo seu owner; migration aplicada usa forward-fix; dados/efeitos exigem reconciliação.

M5 exige cobertura de todos H01–H15/M01–M06, todos FR/NFR, compatibilidade e quadro canônico F0–F38/gates/dimensões. Críticos de produção e decisão humana são as exigidas pela barra; quatro agentes nesta entrega de planejamento não equivalem a esse roster. Auditar candidato antes de declarar completo, preservando prova ausente como ausente.
