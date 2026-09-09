# Integração DeepSeek Harness — contrato e evidência vNext

## Autoridade

`CURRENT`: o domínio CVG, a aplicação e o `AgentRuntime` continuam sendo a
autoridade sobre contexto, policy, drafts, auditoria e estado transacional.
O Harness não é autoridade sobre prontuário, estoque, financeiro,
autenticação, autorização, auditoria ou segredos.

## Contrato observado

O adapter `DeepSeekHarnessAdapter` fala um bridge HTTP explícito do CVG:

- `GET /v1/health` precisa retornar estado, commit do engine, versão do
  manifest, catálogo de tools e capacidades de cancelamento, approval,
  replay e provenance;
- `POST /v1/sessions`, `/v1/sessions/:id/turns`, `/v1/approvals/:id` e
  `/v1/drafts/:id/promote` retornam envelopes validados por schema;
- URL, timeout, commit esperado, manifest esperado e token são configuração
  externa; falha de health, versão, capability ou schema não faz fallback para
  outro runtime nem envia o turno;
- o token é resolvido por referência através de `SecretProvider`, nunca
  materializado em logs, snapshots ou resposta HTTP.

`PROPOSED`: quando houver um processo DeepSeek Harness aprovado, a integração
deve registrar base URL, commit exato, manifest, capability digest, correlation
ID, health/readiness e teste de cancelamento/timeout no artefato da release.

## Estado real desta entrega

`CURRENT`: o adapter e o contrato local existem e são testáveis com fetch
injetado. `NOT_RUN`: nenhum processo/protocolo nativo DeepSeek Harness foi
executado neste workspace; o repositório externo não foi editado. A existência
do adapter não é prova de conexão.

## Gate de promoção

Só promover o runtime quando todos os itens abaixo tiverem observação atual:

1. endpoint HTTPS e identidade de serviço aprovados;
2. health/readiness com commit e manifest exatamente iguais ao profile;
3. catálogo de tools idêntico ao registry CVG e policy revision correlacionada;
4. sessão, turno, cancelamento, deadline, erro estruturado e shutdown
   observados;
5. approval independente, provenance e replay verificados;
6. segredo resolvido pelo provider autorizado, sem valor em artefato;
7. rollback para runtime bloqueado e runbook de indisponibilidade exercitados.

Sem essa evidência, o estado é `BLOCKED`/`NOT_RUN` e o default permanece Mock
local ou DeepSeek desligado, conforme a configuração.
