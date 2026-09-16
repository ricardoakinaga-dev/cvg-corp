# Pacote D-02 — preparação para decisão clínica

**Estado: preparado para revisão; nenhuma decisão clínica foi tomada nesta auditoria.** Fonte: ADR031/D-02 e PRD/UC04. Dono da decisão: direção clínica. Este documento não substitui protocolos nem cria uma aprovação.

## Escopo que precisa ser decidido

| Tema | Informação a fornecer pela autoridade | Impacto de implementação |
|---|---|---|
| Campos obrigatórios de admissão | Quais campos são obrigatórios em cada contexto e quais condições exigem preenchimento | Schema, validação, formulário e gate de admissão |
| Checklist e consentimento | Conteúdo/versão, quem registra e quem pode confirmar, validade e vínculo ao episódio | Contrato versionado, autoria, armazenamento e revisão |
| Alta com pendências | Quais pendências impedem alta e quais exigem decisão excepcional documentada | Máquina de estados, erros e auditoria da exceção |
| Retificação de assinatura | Fluxo permitido, autoridade e preservação de original/correção | Adendo/versionamento e trilha, sem apagar registro original |

## Entrega esperada da decisão

Registrar responsável, data, regra aprovada, contexto de aplicação, fonte do protocolo e critérios para os casos permitido/negado/excepcional. Aprovação de D-02 não autoriza provider, dados reais, custos ou produção. Regras ainda não decididas permanecem explícitas.

Antes de solicitar aceite final, o agente deve apresentar o contrato proposto e exemplos sintéticos concretos derivados das regras fornecidas, identificando quais campos são requisitos já existentes e quais dependem da decisão. Não preencher consentimento clínico com texto inventado para fazer teste passar.

## Trabalho que pode continuar agora

Orçamento com limites sintéticos, revalidação de autoridade, isolamento de prontuário, completude de adendos, foco, farmácia por persona, evidência e testes de concorrência não dependem de D-02. Atribuição técnica de leito pode avançar no escopo já especificado; regras de admissão/alta ainda desconhecidas ficam separadas.

## Dependência correta

AUD13-16A pode depender da base técnica de episódios e da decisão aplicável. Não deve depender da conclusão integral de AUD13-16 se o pai só conclui após o filho. O pai permanece parcial enquanto o requisito clínico estiver pendente; outras tarefas mantêm seus próprios pré-requisitos.
