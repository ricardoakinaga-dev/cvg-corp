# Evidências da continuação AAA2-02

baseline.json identifica 743 arquivos e HEAD com worktree modificado. Deltas mostram as diferenças de domínio/testes contra a cópia da auditoria anterior. sentinel.json confere preservação do candidato original durante esta auditoria; edições documentais são separadas.

Checks completos: tests/build/lint/static/plan logs e JSONs com comando/exit/duração. control-probe.py recebe caminho da cópia como argumento e produz evidência estrutural/semântica. O probe aponta divergências mesmo terminando com exit 0: seu output não é um gate de aceite.

critic/ contém script e log HTTP independente de medicação; a revisão local está em critica-medication.md. O probe residual de IA preserva os cenários sintéticos E02/E03/E04. Probes possuem importações da cópia temporária original; para reproduzir em outro ambiente, substituir esse prefixo pelo caminho de uma nova cópia isolada e usar node --import tsx. Não apontar para produção.

Nenhuma nova prova PostgreSQL/provider/produção foi executada. Os logs atuais não reconstituem o run histórico do agente; demonstram uma revalidação independente do candidato observado. A revisão documental final está em revisao-final.md.
