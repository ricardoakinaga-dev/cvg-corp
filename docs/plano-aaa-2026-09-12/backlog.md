# Backlog consolidado — catálogo de contratos

**54 tarefas em 16 áreas.** Nenhuma melhoria foi implementada por este planejamento. O [JSON](backlog.json) é a fonte dos contratos; esta tabela e as fichas de área são vistas de leitura. `.agent/backlog.json` será a única fonte de status, donos reais e próxima ação após AAA-000.

S: 1 sessão focal; M: 2–3 sessões; L: 4–6 sessões e decomposição obrigatória em fatias antes de iniciar. Uma sessão estimativa equivale a 2–4 horas de trabalho especializado incluindo diagnóstico, implementação e evidência local. São faixas de planejamento, não prazo garantido nem orçamento de inferência. Espera externa, revisão e integração são estimadas separadamente.

| ID | Área | Marco | Prioridade | Porte | Dependências | Entrega |
|---|---|---|---|---|---|---|
| AAA-000 | DOC | M0 | P1 | S | — | Ativar o plano e reconciliar o estado existente |
| ARC-01 | ARC | M0 | P2 | S | AAA-000 | Mapear fronteiras e reservar arquivos compartilhados |
| ARC-02 | ARC | M2 | P2 | L | ARC-01, SEC-01, FIN-02, FUN-02, FUN-03 | Extrair composição da API e serviços por domínio |
| ARC-03 | ARC | M2 | P2 | L | ARC-01, DAT-03, WRK-02 | Separar persistência por responsabilidade |
| CON-01 | CON | M0 | P1 | S | AAA-000 | Congelar contratos necessários às primeiras jornadas |
| CON-02 | CON | M1 | P2 | M | CON-01, SEC-01, FIN-01 | Validar payloads também no cliente |
| CON-03 | CON | M2 | P2 | M | CON-02, ARC-02, ARC-03 | Provar compatibilidade e catálogo após integração |
| SEC-01 | SEC | M1 | P1 | M | CON-01 | Corrigir logout sob falha e reconexão |
| SEC-02 | SEC | M2 | P1 | M | SEC-01, DAT-01 | Provar matriz de autorização e revogação |
| SEC-03 | SEC | M3 | P1 | L | SEC-02, DEV-02 | Integrar autoridade de segredo e WebAuthn reais |
| SEC-04 | SEC | M4 | P1 | L | SEC-03, DAT-04, AIG-03, DEV-03 | Executar red-team da aplicação e do banco |
| AIG-01 | AIG | M1 | P1 | M | CON-01 | Fechar PDP, tools, budgets e efeitos locais |
| AIG-02 | AIG | M3 | P1 | L | AIG-01, SEC-03, DEV-02 | Executar vertical DeepSeek real |
| AIG-03 | AIG | M4 | P1 | L | AIG-02, WRK-03 | Provar falhas do motor e settlement de uso |
| DAT-01 | DAT | M1 | P1 | M | SUP-01 | Revalidar migrations e RLS em PostgreSQL efêmero |
| DAT-02 | DAT | M2 | P1 | L | DAT-01, FIN-01 | Fechar fonte authoritative e concorrência multiprocesso |
| DAT-03 | DAT | M2 | P1 | M | DAT-02, SEC-02 | Endurecer auditoria imutável e exportação |
| DAT-04 | DAT | M3 | P1 | L | DAT-03, OPS-02, ARC-03 | Provar restore sem ressuscitar dados ou privilégios |
| WRK-01 | WRK | M2 | P1 | M | DAT-02, AIG-01 | Exercitar handlers reais e admissão |
| WRK-02 | WRK | M2 | P1 | M | WRK-01 | Provar lease, retry, fencing e shutdown |
| WRK-03 | WRK | M3 | P1 | L | WRK-02, SEC-03, DEV-02 | Concluir provider externo, receipt e reconciliação |
| FUN-01 | FUN | M0 | P1 | S | AAA-000 | Fechar inventário de jornadas e ações incompletas |
| FUN-02 | FUN | M2 | P1 | L | FUN-01, CON-02, DAT-01 | Completar entrada de estoque e inventário |
| FUN-03 | FUN | M2 | P1 | L | FUN-01, CON-02, FIN-02, DAT-01 | Completar jornadas clínicas e operacionais essenciais |
| FIN-01 | FIN | M0 | P1 | S | CON-01, FUN-01 | Definir saldo e mapear semântica financeira existente |
| FIN-02 | FIN | M1 | P1 | M | FIN-01 | Corrigir resumo e completar cobrança |
| FIN-03 | FIN | M4 | P1 | M | FIN-02, FIN-04, DAT-02, WRK-03 | Provar invariantes financeiras e reconciliação |
| FIN-04 | FIN | M2 | P1 | M | FIN-01, FIN-02 | Resolver e implementar regras ambíguas de estorno |
| UX-01 | UX | M1 | P2 | M | SEC-01, CON-02 | Unificar estados e feedback da sessão |
| UX-02 | UX | M2 | P3 | M | UX-01, FUN-02, FUN-03 | Consolidar componentes e tokens por uso |
| UX-03 | UX | M4 | P2 | M | UX-02, A11Y-02 | Validar jornadas com usuários representativos |
| A11Y-01 | A11Y | M2 | P2 | M | UX-01, QUA-03 | Fechar matriz automatizada de acessibilidade |
| A11Y-02 | A11Y | M4 | P2 | M | A11Y-01, UX-02 | Executar tecnologia assistiva e zoom real |
| A11Y-03 | A11Y | M4 | P2 | M | A11Y-02, UX-03 | Fixar regressões e prova visual independente |
| QUA-01 | QUA | M0 | P1 | S | AAA-000 | Tornar teste de snapshot determinístico |
| QUA-02 | QUA | M0 | P1 | M | QUA-01, SUP-01 | Produzir evidência portátil do candidato |
| QUA-03 | QUA | M1 | P2 | M | QUA-02, SUP-01 | Isolar suites e complementar lint semântico |
| PER-01 | PER | M1 | P1 | M | SUP-01, DAT-01 | Congelar workload, capacidade e targets medidos |
| PER-02 | PER | M3 | P2 | L | PER-01, ARC-02, ARC-03 | Reduzir gargalos demonstrados |
| PER-03 | PER | M4 | P1 | L | PER-02, DEV-03, WRK-03, OPS-01 | Provar carga, pressão e chaos em staging |
| OPS-01 | OPS | M3 | P1 | M | DEV-02, WRK-01 | Provar traces, métricas e entrega de alertas |
| OPS-02 | OPS | M3 | P1 | M | DAT-02, DEV-02, SEC-03 | Operar backup criptografado e retenção |
| OPS-03 | OPS | M4 | P1 | L | OPS-01, OPS-02, DAT-04, DEV-03 | Medir RTO/RPO e executar runbooks |
| SUP-01 | SUP | M0 | P1 | S | AAA-000 | Padronizar instalação limpa e inventário |
| SUP-02 | SUP | M2 | P1 | M | SUP-01, QUA-03 | Gerar SBOM e escanear artefatos construídos |
| SUP-03 | SUP | M5 | P1 | M | SUP-02, DEV-01, DEV-03 | Verificar proveniência e adulteração da promoção |
| DEV-01 | DEV | M1 | P1 | M | QUA-02, SUP-01 | Restaurar CI verde e gate local reproduzível |
| DEV-02 | DEV | M0 | P1 | M | AAA-000 | Preparar ambiente alvo e contratos operacionais |
| DEV-03 | DEV | M3 | P1 | L | DEV-01, DEV-02, SUP-02, ARC-02, ARC-03 | Executar staging e container smoke integral |
| DEV-04 | DEV | M5 | P1 | L | CON-03, FIN-03, A11Y-03, SEC-04, PER-03, OPS-03, SUP-03, DOC-03 | Congelar candidato e obter Gauntlet final |
| DEV-05 | DEV | M5 | P1 | S | DEV-04 | Decisão humana e promoção controlada |
| DOC-01 | DOC | M0 | P1 | S | AAA-000 | Conciliar catálogo novo com histórico e fontes |
| DOC-02 | DOC | M2 | P2 | M | DOC-01, FUN-01, CON-01 | Manter decisões e manual de operação por tarefa |
| DOC-03 | DOC | M5 | P1 | M | DOC-02, QUA-03, DEV-03 | Auditar evidência final e eliminar contradições |

## Condição comum para começar e concluir

Começar exige dependências VERIFIED/DONE no backlog canônico, contrato atual, arquivos/recursos reservados e pré-requisitos externos efetivamente disponíveis. A ordem textual da tabela não substitui o DAG. Preparações locais de tarefas com dependência externa podem ser separadas pelo Lead em filhos antes de executar; não declarar a tarefa inteira concluída.

Concluir exige reprodução original, diff revisado, testes positivos e negativos pertinentes, evidência atual do candidato integrado, documentação afetada e revisão independente. “Implementado” pelo builder significa IMPLEMENTED, não DONE. Evidências anteriores ao último diff relevante ficam STALE.

Tarefas distantes são contratos de resultado: refine superfície exata e custo ao terminar o marco anterior; mantenha IDs, critérios e dependências auditáveis. Nenhuma implementação de área inteira é delegada como um único prompt aberto.
