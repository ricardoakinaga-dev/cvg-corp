# Programa executivo CVG-Corp — State of Art / Triplo AAA

**Entrega de planejamento, ainda sem execução das melhorias.** Este pacote transforma a [auditoria de 12/09/2026](../auditoria-2026-09-12.md) em um programa de 16 áreas, 54 tarefas e seis marcos, preparado para múltiplos agentes.

## Comece por aqui

1. [Plano executivo](plano-executivo.md): resultados, metas, governança, decisões e riscos.
2. [Roadmap](roadmap.md): sequência, dependências, demonstrações e gates por marco.
3. [Backlog consolidado](backlog.md) e [catálogo JSON](backlog.json): tarefas com IDs e dependências.
4. [Protocolo multiagente](multiagentes.md): atribuição, isolamento, integração e prompts reutilizáveis.
5. [Barra de qualidade e rastreabilidade](qualidade.md): ligação das 16 áreas às 22 dimensões e F0–F38.

Para a missão integral, use o [prompt completo de implementação](prompt-implementacao.md), que cobre todas as tarefas até o aceite final, coordenação multiagente, critérios de prova e retomada.

Para iniciar a implementação em uma nova conversa:

> Leia `docs/plano-aaa-2026-09-12/README.md`, `plano-executivo.md`, `roadmap.md`, `multiagentes.md` e o contrato `AAA-000` em `backlog.json`. Execute `AAA-000`, preservando as alterações existentes e reconciliando `.agent/`. Depois execute tarefas prontas de M0 e a correção SEC-01/FIN-02 conforme dependências. Use até quatro slots totais: Lead, dois builders e um crítico; sem agentes descendentes. Não altere a barra v4 nem registre melhorias como concluídas sem prova. Entregue diffs, verificações e estado retomável. Pré-requisitos externos ausentes devem permanecer explícitos; continue o trabalho independente.

Esse prompt é uma instrução para a futura sessão de execução; este pacote não provisiona serviços, inicia deploy ou modifica o programa.

## Planos por área

Cada ficha contém resultado executivo, roadmap próprio e contratos completos das tarefas.

| Área | Ficha |
|---|---|
| Arquitetura e manutenção | [01 — ARC](areas/01-arc.md) |
| Contratos e validação | [02 — CON](areas/02-con.md) |
| Autenticação, autorização e sessão | [03 — SEC](areas/03-sec.md) |
| Governança de IA | [04 — AIG](areas/04-aig.md) |
| Persistência e integridade | [05 — DAT](areas/05-dat.md) |
| Worker e resiliência | [06 — WRK](areas/06-wrk.md) |
| Completude funcional | [07 — FUN](areas/07-fun.md) |
| Correção do financeiro | [08 — FIN](areas/08-fin.md) |
| Interface e usabilidade | [09 — UX](areas/09-ux.md) |
| Acessibilidade | [10 — A11Y](areas/10-a11y.md) |
| Testes e verificações | [11 — QUA](areas/11-qua.md) |
| Desempenho e escalabilidade | [12 — PER](areas/12-per.md) |
| Observabilidade e recuperação | [13 — OPS](areas/13-ops.md) |
| Dependências | [14 — SUP](areas/14-sup.md) |
| CI/CD e produção | [15 — DEV](areas/15-dev.md) |
| Documentação e rastreabilidade | [16 — DOC](areas/16-doc.md) |

## Fontes de verdade

- Contratos das tarefas planejadas: `backlog.json`; arquivos Markdown são suas vistas de leitura.
- Status, dono real, próxima ação e evidência de execução: `.agent/backlog.json`, após importação idempotente em AAA-000.
- Plano ativo e recuperação do programa: `.agent/state.json` e seu `active_execplan`; este pacote não altera esses ponteiros.
- Critérios de promoção: `.gauntlet/bar-v4.json`, prompt final vinculado e `scripts/verify-triplo-aaa.ts`.
- Auditoria histórica: `docs/auditoria-2026-09-12.md`; suas notas não são resultados de melhoria nem notas do scorecard AAA.

Valide a consistência documental, sem iniciar a aplicação:

```bash
python3 docs/plano-aaa-2026-09-12/validar-plano.py
```

Para imprimir uma tarefa sem ler o catálogo inteiro:

```bash
python3 -c 'import json; d=json.load(open("docs/plano-aaa-2026-09-12/backlog.json")); print(json.dumps(next(t for t in d["tasks"] if t["id"]=="SEC-01"),ensure_ascii=False,indent=2))'
```

**Validade:** baseline de código `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`. Se o código ou a barra mudar, AAA-000/recovery revalida o contrato antes de executar; não reutilize evidência antiga como PASS atual.
