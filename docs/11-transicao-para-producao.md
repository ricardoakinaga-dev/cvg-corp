# CVG-Corp — Da demonstração local à produção

**Estado:** plano documental de transição; ambientes, testes, piloto e deploy `NOT_RUN`.

**Origem:** solicitação do usuário para documentar o percurso após a demonstração local. Este registro não confirma automaticamente as propostas técnicas ou os responsáveis ainda pendentes em [08](08-rastreabilidade-e-decisoes.md).

Este documento define a passagem entre ambientes e a liberação de funcionalidades. O [plano 07](07-plano-execucao.md) continua responsável pela sequência dos milestones; [06](06-operacao-qualidade-e-recuperacao.md) pelos critérios de prova e operação; [03](03-dominio-dados-contratos.md) pelos contratos de dados e recuperação; [05](05-seguranca-privacidade.md) pela política de segurança.

## 1. Unidade de liberação

Cada liberação identifica versão, funcionalidades habilitadas, unidades, usuários, classes de dados e integrações permitidas. Somente capacidades implementadas e verificadas podem ser habilitadas; o restante permanece bloqueado também na API.

O aceite da demonstração M1 comprova apenas o recorte de identidade, contexto, permissões e auditoria efetivamente demonstrado. Não entrega cadastro, agenda, atendimento ou operação clínica. A primeira entrega local também não comprova restore operacional nem encerra o M1 completo, conforme [10](10-preparacao-m1.md).

É possível liberar uma fatia antes de concluir todo o produto. Para isso, o plano 07 deve registrar suas dependências e trazer os controles de M7 aplicáveis para antes do piloto dessa fatia. A liberação parcial não dispensa recuperação, segurança, operação ou autoridade e não significa conclusão dos milestones restantes.

## 2. Etapas e critérios de passagem

| Etapa | Trabalho e evidência de saída | Responsável a nomear |
|---|---|---|
| Demonstração local | Executar critérios da fatia com dados sintéticos; registrar versão, resultados, limitações e aceite funcional. | Produto / responsável pelo aceite local |
| Homologação | Criar ambiente separado, semelhante ao de produção; ensaiar implantação, migrations, testes funcionais, isolamento e falhas com dados sintéticos. Registrar artifact reproduzível e resultados. | Engenharia + operação |
| Preparação para dados reais | Fechar políticas e decisões aplicáveis, contas reais, recuperação de acesso, MFA de acessos privilegiados, retenção, suporte e contingência. Demonstrar backup/restore com autoridade corrente e metas operacionais acordadas. | Segurança + privacidade + operação; clínica/financeiro quando aplicável |
| Piloto controlado | Liberar somente o escopo aprovado para uma unidade e grupo delimitado; treinar usuários, acompanhar incidentes e medir os critérios definidos antes da abertura. | Produto + operação da unidade |
| Produção ampliada | Avaliar evidências do piloto, pendências e recuperação; registrar autorização de release e ampliar gradualmente usuários/unidades/capacidades. | Autoridade de release nomeada |

Piloto com dados reais já é uso de produção: exige os controles e a autorização aplicáveis antes do primeiro dado real. A duração, os participantes, as métricas e os limiares de aprovação/interrupção do piloto permanecem pendentes em U15; devem ser definidos antes de iniciá-lo, sem substituir evidência por um número arbitrário de dias.

## 3. Ambientes e implantação

- **Local:** dados e contas sintéticos, serviços restritos a loopback e configurações específicas de desenvolvimento. Não promover senhas, sessões ou fixtures para produção.
- **Homologação:** banco, segredos, identidades e destinos de integração separados; dados sintéticos por padrão. Sem cópia de dados reais sem decisão e controles específicos.
- **Produção/piloto real:** domínio e HTTPS, configuração de sessão apropriada, banco com acesso restrito, gestão de segredos, monitoramento, alertas e suporte. Nenhuma exceção HTTP local pode acompanhar o artifact como configuração ativa.

Escolher hospedagem, região, custo, capacidade e responsáveis antes de provisionar; essas escolhas continuam abertas. A stack proposta permite planejar esse percurso, mas sua adequação e capacidade precisam de testes no ambiente escolhido.

A esteira deve construir uma versão identificada, testar e promover o mesmo artifact entre homologação e produção, alterando apenas configuração externa validada. Registrar commit, lockfile, digests, versão do schema, configuração sem segredos e resultados. A infraestrutura deve ser reproduzível; migrations e deploy têm passos explícitos, verificação de saúde e critérios de abortar. Nenhum ambiente externo foi criado por este plano.

## 4. Dados, migrations e recuperação

Se houver importação, definir origem autorizada, mapeamento, deduplicação, reconciliação, responsáveis e critérios de aceite; ensaiar primeiro. A abertura do piloto não autoriza migração de dados por inferência.

Antes de uma mudança de schema, verificar compatibilidade entre aplicação e banco, ensaiar sobre volume representativo, registrar backup e procedimento de recuperação e definir janela de execução. Preferir mudanças compatíveis em etapas; não executar reversão destrutiva automática para fazer a versão antiga funcionar.

Rollback da aplicação só é permitido se a versão anterior for compatível com o schema e os dados atuais. Caso contrário, seguir correção progressiva ou recuperação ensaiada, preservando efeitos já confirmados. Restaurar snapshot não desfaz com segurança pagamentos, mensagens, revogações ou outros efeitos posteriores.

A recuperação segue integralmente o journal independente, receipts, quarentena e reconciliação de [03](03-dominio-dados-contratos.md). O teste negativo de M1 que bloqueia uma base restaurada não comprova recuperação operacional bem-sucedida. Antes de dados reais, demonstrar restauração utilizável sem reativar acessos ou dados restringidos, dentro de RTO/RPO aprovados em [06](06-operacao-qualidade-e-recuperacao.md). Sem essa evidência, a abertura permanece bloqueada.

## 5. Operação e interrupção do piloto

Antes da abertura, nomear suporte e escalonamento, definir horários de cobertura e treinar a unidade no procedimento de contingência. Registrar qual sistema/processo será a fonte de registro durante indisponibilidade e como o retorno será reconciliado, evitando dupla escrita sem controle.

O plano do piloto deve listar alertas, responsáveis, métricas e limites de erro/latência/recuperação para o escopo real. Suspeita de acesso entre escopos, perda de auditoria obrigatória, divergência de integridade ou incapacidade de recuperação interrompe a capacidade afetada e aciona o runbook; continuidade depende de contenção e avaliação registrada, não de ocultar a falha. Regras específicas de segurança clínica se aplicam antes de qualquer jornada clínica real.

O DeepSeek Harness entra somente nas fatias que dependem dele. Antes de provider real, exigir os contratos de transferência, credenciais, orçamento, aprovação, versão e kill switch de [04](04-motor-deepseek-e-plugins.md) e [05](05-seguranca-privacidade.md). A operação liberada deve manter o caminho manual previsto sem dependência obrigatória da IA.

## 6. Registro obrigatório de cada passagem

O responsável registra: etapa de origem/destino; artifact e schema exatos; escopo habilitado; dados/unidades/usuários/destinos permitidos; evidências de testes e recuperação; decisões U aplicáveis resolvidas; pendências e capacidades bloqueadas; métricas e limites; plano de contingência; ator, data e autoridade do aceite; próxima revisão.

Estado atual de todas as passagens: `NOT_RUN`. Papéis acima são responsabilidades a nomear, não aprovações atribuídas. O gate `RELEASE_READY` só pode ser avaliado para o escopo explícito e com evidências reais; a existência deste documento não muda o veredito documental de 09 nem autoriza deploy ou uso de dados reais.
