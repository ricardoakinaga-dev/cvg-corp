# Roadmap de implementação e comprovação

O DAG de [backlog.json](backlog.json) define a ordem real. Ondas R0–R5 organizam resultados e não substituem as fases normativas F0–F38. Não há datas prometidas sem medir esforço, integração e espera externa.

| Onda | Contratos AAA2 | Demonstração de saída |
|---|---|---|
| R0 — Estado e prova | 01,10 | Aceites reconciliados, candidato identificável e gates de evidência reproduzíveis |
| R1 — Riscos imediatos | 02–09,19 | Prescrição, orçamento, autoridade, prontuário, farmácia, admissão e foco corrigidos; readiness discriminante |
| R2 — Produto e dados | 11–18,20,22,23,33 | Jornadas e exames completos, fontes autoritativas, claims recuperáveis, relatórios e harnesses significativos |
| R3 — Operação integrada | 21,24–28 | Integrações/alertas, recovery, CI/staging e otimização medida |
| R4 — Uso e adversidade | 29,30 | Personas, browsers, assistividade, carga/chaos/red-team/recovery do candidato |
| R5 — Decisão | 31,32 | Matriz integral, revisão independente e aceite humano; promoção apenas autorizada |

## Primeiras janelas

1. Lead executa01 e reserva arquivos; registra a reabertura do aceite de15/21 e o vínculo das regressões clínicas.
2. Frentes possíveis:06 na UI e02 no domínio, enquanto Lead prepara10. Só há paralelo com arquivos/recursos disjuntos.
3. Integrar02; executar03 com owner exclusivo de domínio/persistência.05 pode avançar no adapter se não disputar contratos; depois04 depende03.
4.07 depende02;08 compartilha domínio com outras jornadas e deve ser serializada quando necessário.09 segue06.19 pode usar owner separado de health, evitando API root concorrente.
5.11→12 estabelecem claims e fontes antes de completar as jornadas que dependem de persistência.33 deve ser integrado antes da matriz final de uso.

O catálogo não exige esperar toda uma onda para iniciar uma tarefa pronta. Por exemplo, investigação de disponibilidade externa pode ocorrer em01; a conclusão25 inclui integração e depende18, mas sua preparação não precisa esperar a implementação do worker.

## Caminhos de maior incerteza

- 03→04→17→26→30: budget durável, governança e prova real de IA.
- 02→11→12→13/14/15/16/18/33→29: integridade, migração e jornadas por persona.
- 10/12/19/25→27→29/30→31→32: candidato, operação e decisão humana.

Esses caminhos são hipóteses de prazo. Refinar com duração e retrabalho observados; não somar scores nem dividir esforço por número de agentes.

## Passagem entre marcos

Cada demonstração inclui caso negativo e receipt/log verificável. Uma mudança material após CI/browser/carga invalida as provas afetadas e exige reteste no candidato atualizado. F38 pode permanecer pendente após31, mas a barra integral continua reprovada até decisão32. Nenhuma indisponibilidade externa autoriza omitir a fase ou criar atestação fictícia.
