# Preparação da primeira entrega M1

**Estado:** pacote técnico, alçadas e critérios aprovados para M1 local em DEC-M1-04/05; solicitante responsável pelo aceite; B1 iniciado, evidências em 07.

As decisões de produto pertencem a [08](08-rastreabilidade-e-decisoes.md#fechamento-confirmado-em-2026-09-08), a sequência a [07](07-plano-execucao.md), os contratos gerais a [03](03-dominio-dados-contratos.md) e a política de segurança a [05](05-seguranca-privacidade.md). Este documento reúne o pacote de preparação da primeira entrega local, sem aprovar o M1 completo.

## Limites da entrega

Uma organização CVG, várias unidades e workspaces, usuários sintéticos, login/logout, seleção de contexto autorizado, concessão/revogação de acessos e auditoria. A interface deve demonstrar uma requisição autorizada e uma negada, com decisão do servidor e contexto identificável.

Sem prontuário, cadastro de pacientes, agenda, IA, provider, credencial externa ou dados reais. Sem cache offline de conteúdo, exportação, cadastro de outra empresa ou acesso emergencial habilitado. A ausência dessas capacidades deve ser verificável pela API, não apenas por botões ocultos. O Harness só entra em M3 conforme 07.

## Matriz inicial proposta

Matriz aprovada para M1 local sintético em DEC-M1-05; não aprova alçadas clínicas ou de produção.

| Ação | Administrador da organização | Veterinário / recepção | Operador técnico |
|---|---|---|---|
| Ler própria identidade e escopos | Sim, autenticado | Sim, autenticado | Sim, autenticado |
| Selecionar unidade/workspace | Somente escopo autorizado | Somente escopo atribuído | Somente escopo técnico atribuído |
| Listar usuários e vínculos | Na própria organização | Não | Não |
| Conceder/revogar papel de trabalho | Na própria organização, dentro da própria alçada | Não | Não |
| Consultar auditoria administrativa | Metadados mínimos da própria organização | Não | Não por padrão |
| Consultar saúde técnica | Somente diagnóstico sem conteúdo | Não | Diagnóstico sem conteúdo nem segredos |
| Acessar dados clínicos | Indisponível nesta entrega | Indisponível nesta entrega | Indisponível nesta entrega |
| Exportar, break-glass ou promover operador a admin | Indisponível nesta entrega | Não | Não |

Bootstrap local proposto: comando explícito cria a organização, duas unidades, workspaces e contas sintéticas. O primeiro administrador nasce nesse bootstrap, sem endpoint público de autoinscrição nem senha fixa versionada. Administração de outros administradores, recuperação de conta e remoção do último administrador precisam de contrato antes de serem habilitadas; inicialmente negar essas operações. Reset local só pode atingir a base sintética identificada, por ação explícita.

## Propostas técnicas detalhadas

A stack e a topologia estão em [02, seção 13](02-arquitetura-alvo.md#13-stack-recomendada-para-m1-local). Sessão, senha, prazos, CSRF, limites e concessões estão em [05, seção 14](05-seguranca-privacidade.md#14-proposta-de-autenticação-para-m1-sintético). Tabelas, endpoints, erros, concorrência e restore estão em [03, seção 15](03-dominio-dados-contratos.md#15-proposta-de-contratos-concretos-para-m1-local).

São propostas concretas para revisão, não comportamento executado. Autenticação local não requer conta externa; a adoção para usuários reais exigirá reabrir identidade/recuperação/MFA e operação. O solicitante confirmou as alçadas e assumiu o aceite local em DEC-M1-05.

## Aceite funcional proposto

| ID | Evidência exigida na implementação |
|---|---|
| M1-AC-01 | Instalação reproduzível em base vazia; bootstrap explícito e repetível sem duplicar vínculos; nenhuma credencial fixa no repositório. |
| M1-AC-02 | Login válido funciona; credencial inválida, sessão expirada e sessão após logout são recusadas. |
| M1-AC-03 | Trocar IDs no cliente não permite acessar organização, unidade ou workspace não autorizados; testar também recurso estrangeiro e contexto ausente. |
| M1-AC-04 | Administrador concede papel permitido no próprio escopo; recepção, veterinário e operador não conseguem conceder acesso nem elevar os próprios privilégios. |
| M1-AC-05 | Revogação impede a próxima operação protegida mesmo com sessão/cache anteriores; corrida entre revogação e mutação respeita o contrato de commit. |
| M1-AC-06 | Falha ao persistir auditoria desfaz concessão/revogação; retry não duplica o efeito; eventos não contêm segredos e não podem ser editados via API. |
| M1-AC-07 | Interface permite login, escolha de contexto, ação permitida e negação compreensível; teclado e foco permitem concluir o fluxo. |
| M1-AC-08 | Restauração sintética fica em quarentena, invalida sessões e recusa inclusive novo login enquanto não houver reconciliação de autoridade corrente. Restore operacional bem-sucedido depende do journal e das provas completas de 03; não declarar esse resultado a partir do teste negativo. |
| M1-AC-09 | Capacidades excluídas da entrega não podem ser acionadas diretamente pela API; serviço só é disponibilizado no ambiente local previsto. |

Esses critérios complementam o Quality Bar vigente; não substituem suas provas aplicáveis. Targets operacionais de produção continuam propostos em 06. Testes e restore são trabalho de implementação, não resultados já obtidos nem pré-requisito de execução antes de existir código.

## Trabalho restante antes de BUILD

| Tarefa | Resultado concreto | Dependência / estado |
|---|---|---|
| PREP-M1-01 | Selecionar stack e mecanismo de autenticação; justificar escolhas, fixar versões e comandos a partir de documentação oficial e ambiente disponível. | Stack e autenticação propostas em 02/05; versões exatas e smoke test pendentes no scaffold. |
| PREP-M1-02 | Consolidar schema, contratos de API/erro, sessão e concorrência em 02/03; fixar matriz e limites de sessão/auditoria sintéticos em 05. | Contratos concretos em 03/05; schemas executáveis e validação de implementação pendentes. |
| PREP-M1-03 | Revisar alçadas residuais e nomear responsável pelo aceite local; manter negadas capacidades cuja autoridade não foi definida. | Concluída para M1 local: alçadas confirmadas e solicitante nomeado em DEC-M1-05. |
| PREP-M1-04 | Registrar comandos de instalação, migration, testes e execução; vincular cada M1-AC a fixture/prova e atualizar 07 com tarefas de código e recuperação. | Sequência e comandos-alvo registrados em 07; scripts ainda inexistentes. |

Resolução de versões, criação de schemas e execução de testes pertencem ao scaffold/BUILD, após fechamento das escolhas de desenho; não é necessário existir código para aprovar o contrato.

Após esses resultados, avaliar `IMPLEMENTATION_READY` somente para a entrega local. A autorização de recorte não equivale a aprovação de produção; U4 real, U5 clínico, U14 real e U15 operacional continuam nos respectivos marcos em 08.


## Depois da demonstração local

O aceite da demonstração inicia a preparação da etapa seguinte, conforme [11 — Transição para produção](11-transicao-para-producao.md). Não é uma autorização de piloto real ou deploy; a liberação de cada fatia depende de homologação e dos controles operacionais aplicáveis.
