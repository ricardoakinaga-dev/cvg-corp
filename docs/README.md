# CVG-Corp — Programa de Gestão do Centro Veterinário Guarapiranga

Este diretório contém a documentação da arquitetura-alvo de um programa de gestão clínico, operacional, administrativo e de automação inteligente para o Centro Veterinário Guarapiranga.

## Estado da entrega

| Campo | Estado |
|---|---|
| Fase | Definição de produto, especificação técnica e plano de execução |
| Escopo desta fase | Documentação somente; nenhuma implementação foi feita |
| Motor proposto | `deepseek-harness` como runtime plugável de agentes |
| Qualidade | `CONDITIONAL PASS` documental no Quality Bar v1.1; runtime ainda `NOT_RUN` |
| Fonte de verdade clínica | O domínio transacional do CVG, não a conversa do agente |
| Próximo gate | `TECHNICALLY_SPECIFIED`, condicionado às decisões abertas do documento 08 |

## Leitura recomendada

1. [`00-quality-bar-v1.md`](00-quality-bar-v1.md) — barra de aceite e proveniência registrada (v1.1).
2. [`00-fontes-e-premissas.md`](00-fontes-e-premissas.md) — o que foi observado, proposto ou deixado desconhecido.
3. [`01-prd-cvg.md`](01-prd-cvg.md) — produto, usuários, jornadas, regras e aceite.
4. [`02-arquitetura-alvo.md`](02-arquitetura-alvo.md) — limites de contexto, deploy e dependências.
5. [`03-dominio-dados-contratos.md`](03-dominio-dados-contratos.md) — entidades, estados, invariantes, eventos e contratos.
6. [`04-motor-deepseek-e-plugins.md`](04-motor-deepseek-e-plugins.md) — uso do DeepSeek Harness sem inventar capacidades atuais.
7. [`05-seguranca-privacidade.md`](05-seguranca-privacidade.md) — ameaças, autorização, privacidade e segurança clínica.
8. [`06-operacao-qualidade-e-recuperacao.md`](06-operacao-qualidade-e-recuperacao.md) — SLOs propostos, observabilidade, continuidade e testes.
9. [`07-plano-execucao.md`](07-plano-execucao.md) — fatias verticais, dependências e gates de implementação.
10. [`08-rastreabilidade-e-decisoes.md`](08-rastreabilidade-e-decisoes.md) — matriz requisito→design→risco→verificação e decisões pendentes.
11. [`09-gauntlet-verdict.md`](09-gauntlet-verdict.md) — veredito da crítica independente desta fase.

## Princípio de leitura

`CURRENT` descreve uma capacidade ou fato observado nas fontes locais; `TARGET` descreve o resultado que o produto precisa atingir; `PROPOSED` registra uma escolha de projeto ainda sujeita a aprovação; `UNKNOWN` é uma lacuna que não pode ser preenchida por inferência segura.

O conteúdo dos vídeos e da documentação do motor é tratado como evidência de desenho e capacidade documentada, não como prova de implantação, segurança, conformidade, performance ou disponibilidade em produção.

## Resultado arquitetural resumido

O CVG-Corp é proposto como um sistema transacional modular para operação veterinária, com uma camada de IA governada pelo DeepSeek Harness. O sistema de registro mantém pacientes, tutores, consultas, prontuários, exames, internações, estoque, cobranças e auditoria; o harness executa sessões, ferramentas, aprovações, automações e recuperação dentro dos limites desse sistema.

O desenho adota três compromissos de qualidade:

- **A1 — Assistência segura:** a IA prepara, resume, alerta e sugere; um profissional habilitado confirma toda decisão clínica ou comunicação de alto impacto.
- **A2 — Administração íntegra:** cada dado tem dono, escopo, autorização, transação, auditoria e reconciliação.
- **A3 — Aceleração governada:** modelos, tools, MCPs, skills, memória, budget e jobs são versionados e fail-closed.

## Limite desta fase

Não há código, schema executável, endpoint implantado, benchmark, teste de carga, migração, credencial, deploy ou integração externa neste diretório. Os contratos e targets que aparecem como `PROPOSED` precisam ser confirmados antes do BUILD.
