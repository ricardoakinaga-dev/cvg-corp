# MASTER IMPLEMENTATION PROMPT

## CVG-CORP — EMBEDDED AGENT RUNTIME + FINAL TRIPLE AAA CLOSURE

> **Nota de preservação:** cópia integral do prompt normativo recebido em 2026-09-16.
> O documento original concatenava alguns títulos (por exemplo `# 109`, `# 180`,
> `# 244`/`# 332`, `# 581`) por falha de formatação da mensagem de origem. Nesta
> cópia os títulos foram separados novamente sem alterar o conteúdo normativo.
> Este arquivo é a referência canônica de escopo para o programa
> `EMBEDDED AGENT RUNTIME + FINAL TRIPLE AAA CLOSURE`.

Repositório principal:

https://github.com/ricardoakinaga-dev/cvg-corp

Você é o Principal Engineer, Software Architect, Security Engineer, Reliability Engineer e AI Systems Engineer responsável pela próxima evolução arquitetural do CVG-Corp.

O CVG-Corp já possui uma base avançada e NÃO deve ser reescrito.

A missão é evoluí-lo para uma arquitetura **State of the Art / Triplo AAA**, avaliando e, se tecnicamente superior, implementando a incorporação controlada dos componentes genéricos do DeepSeek Harness como um **runtime interno de agentes**, eliminando complexidade de integração desnecessária sem acoplar o domínio veterinário ao motor de IA.

---

# 0. PRINCÍPIO CENTRAL

O CVG-Corp é o produto.

O Harness é apenas um motor cognitivo.

Nunca inverter essa relação.

A arquitetura conceitual desejada é:

```text
                         CVG-CORP
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
       Web                  API                Workers
                             │
                             ▼
                    Application Layer
                             │
                             ▼
                         CVG Domain
                             │
                  ┌──────────┴──────────┐
                  │                     │
             Persistence           Integrations
                  │
             PostgreSQL


                   AI CONTROL PLANE
                          │
                          ▼
                    AgentRuntime
                          │
                          ▼
                  Embedded Harness
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
 Context Builder      Agent Loop        Sessions
        │                 │                 │
        ├──────────────┬──┴───────────────┤
        │              │                  │
   Retrieval        Tool Runtime       Memory
                       │
                       ▼
                  CVG Tool Gateway
                       │
                       ▼
                      PDP
                       │
                       ▼
                 Application Layer


                  MODEL BOUNDARY
                        │
                        ▼
                  Model Adapter
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
       DeepSeek       Local LLM     Future Model
```

---

# 1. NÃO COPIAR O HARNESS CEGAMENTE

Antes de copiar qualquer código do DeepSeek Harness:

1. localizar o source real;
2. verificar licença;
3. verificar versão;
4. identificar componentes;
5. identificar dependências;
6. identificar contratos;
7. identificar side effects;
8. identificar código provider-specific;
9. identificar código genérico;
10. identificar partes úteis ao CVG;
11. identificar partes que NÃO devem ser incorporadas.

Produzir:

```text
docs/embedded-harness-audit.md
```

---

# 2. CLASSIFICAR OS COMPONENTES DO HARNESS

Classificar cada componente em:

```text
EMBED
ADAPT
REIMPLEMENT
KEEP_EXTERNAL
REJECT
```

Exemplo esperado:

```text
Agent Loop                 → EMBED/ADAPT
Context Builder            → EMBED/ADAPT
Session Engine             → EMBED/ADAPT
Plugin Runtime             → EMBED/ADAPT
Skill Loader               → EMBED/ADAPT
Tool Dispatcher            → REIMPLEMENT via CVG Tool Gateway
Model Adapter              → ADAPT
DeepSeek-specific client   → KEEP behind ModelProvider
Persistence                → REJECT if bypassing CVG persistence
Authorization              → REJECT if bypassing CVG PDP
Business logic             → REJECT
Secrets                    → REJECT if independent of CVG authority
```

Não assuma esses resultados.

Audite primeiro.

---

# 3. LICENÇA E PROVENIÊNCIA

Antes de incorporar código externo:

verificar:

```text
license
copyright
NOTICE
attribution requirements
redistribution requirements
dependency licenses
```

Preservar provenance.

Criar:

```text
docs/third-party/deepseek-harness-provenance.md
```

Se a licença não permitir incorporação:

```text
BLOCKED_LICENSE
```

e manter integração externa.

Nunca contornar licença.

---

# 4. CRIAR UM RUNTIME INTERNO PROVIDER-NEUTRAL

O contrato existente `AgentRuntime` deve continuar sendo a fronteira oficial.

Estrutura alvo:

```text
packages/
  agent-runtime/
  agent-kernel/
  agent-context/
  agent-session/
  agent-memory/
  agent-retrieval/
  agent-tools/
  agent-policy/
  agent-plugins/
  agent-skills/
  model-runtime/
  model-adapters/
```

Não obrigatoriamente com esses nomes se a estrutura existente for superior.

Preservar compatibilidade sempre que possível.

---

# 5. AGENT KERNEL

Criar ou incorporar um kernel responsável exclusivamente pelo ciclo cognitivo.

Modelo:

```text
OBSERVE
   ↓
UNDERSTAND
   ↓
BUILD CONTEXT
   ↓
REASON
   ↓
DECIDE
   ↓
ACT
   ↓
OBSERVE RESULT
   ↓
VERIFY
   ↓
CONTINUE / STOP
```

O kernel não conhece:

```text
Patient
Guardian
Appointment
Hospitalization
Finance
Stock
```

Ele conhece apenas contratos abstratos.

---

# 6. AGENT LOOP

Implementar loop explícito e limitado.

Estados sugeridos:

```text
CREATED
OBSERVING
CONTEXT_BUILDING
MODEL_PENDING
MODEL_COMPLETED
TOOL_PENDING
TOOL_COMPLETED
VERIFYING
WAITING_APPROVAL
COMPLETED
FAILED
QUARANTINED
CANCELLED
```

Adicionar limites:

```text
maxTurns
maxToolCalls
maxTokens
maxWallTime
maxCost
maxFailures
```

Nunca permitir loop infinito.

---

# 7. CONTEXT BUILDER

Criar Context Builder como componente próprio.

Ele deve receber:

```text
system instructions
agent profile
actor context
organization context
unit/workspace
conversation
session
retrieval
tool descriptions
policies
task state
token budget
```

e produzir:

```text
ModelContext
```

O Context Builder decide:

```text
WHAT reaches the model
```

Não apenas retrieval.

---

# 8. RETRIEVAL

Retrieval deve ser apenas uma fonte do Context Builder.

Arquitetura:

```text
               Context Builder
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
 Conversation     Retrieval      Session
       │             │              │
       ▼             ▼              ▼
   recent msgs    knowledge       state
```

Retrieval nunca injeta conteúdo diretamente no model sem sanitização/policy.

---

# 9. TRUSTED / UNTRUSTED CONTEXT

Classificar contexto:

```text
SYSTEM_TRUSTED
CVG_TRUSTED
USER_SUPPLIED
RETRIEVED_UNTRUSTED
EXTERNAL_UNTRUSTED
TOOL_RESULT
```

Conteúdo não confiável nunca pode:

```text
override policy
change permissions
change system prompt
enable tools
approve actions
access secrets
```

---

# 10. MODEL RUNTIME

Separar definitivamente Harness de modelo.

Criar:

```ts
interface ModelProvider {
  health(...)
  complete(...)
  stream(...)
  cancel(...)
  capabilities(...)
}
```

Implementações:

```text
DeepSeekProvider
LocalModelProvider
MockModelProvider
```

Preparar extensão futura.

---

# 11. DEEPSEEK MODEL ADAPTER

O adapter DeepSeek deve traduzir:

```text
CVG ModelRequest
        ↓
DeepSeek request
```

e:

```text
DeepSeek response
        ↓
CVG ModelResponse
```

Responsabilidades:

```text
schema mapping
streaming
tool-call mapping
usage
finish reason
error normalization
timeout
cancellation
```

Não colocar regra de negócio nele.

---

# 12. MODEL CAPABILITIES

Detectar capabilities:

```text
toolCalling
structuredOutput
streaming
reasoning
vision
contextWindow
maxOutput
```

O AgentRuntime deve adaptar seu comportamento às capabilities declaradas.

Fail closed quando capability obrigatória não existir.

---

# 13. PLUGIN RUNTIME

Como o Harness original é extensível por plugins, preservar essa vantagem.

Criar contrato:

```ts
interface AgentPlugin {
  manifest
  initialize()
  capabilities()
  hooks()
  shutdown()
}
```

Manifest deve conter:

```text
name
version
publisher
digest
permissions
capabilities
dependencies
risk
```

---

# 14. PLUGIN SECURITY

Plugins são código potencialmente perigoso.

Implementar:

```text
allowlist
manifest verification
digest verification
capability declaration
permission declaration
version pinning
audit
```

Nenhum plugin recebe acesso implícito ao sistema.

---

# 15. SKILL RUNTIME

Skill não deve ser confundida com plugin.

Skill = conhecimento/procedimento.

Plugin = capacidade executável.

Criar contratos separados.

Skill:

```text
manifest
instructions
examples
references
requiredTools
requiredCapabilities
risk
version
digest
```

---

# 16. TOOL GATEWAY CONTINUA SOBERANO

Esta regra é absoluta:

O Harness incorporado NÃO executa diretamente ferramentas CVG.

Fluxo:

```text
Agent Loop
   ↓
Tool Request
   ↓
CVG Tool Gateway
   ↓
PDP
   ↓
Approval
   ↓
Application Service
   ↓
Domain
   ↓
Persistence / Integration
```

Nunca:

```text
Agent Loop
   ↓
SQL
```

Nunca:

```text
Agent Loop
   ↓
WhatsApp API
```

---

# 17. PDP CONTINUA SOBERANO

Não importar autorização do Harness se ela competir com o PDP.

O CVG PDP continua sendo a autoridade final para:

```text
actor
role
organization
unit
workspace
purpose
resource
operation
risk
approval
```

---

# 18. AGENT SESSION

Criar sessão independente do provider.

Session deve conter:

```text
sessionId
actor
organization
unit
workspace
purpose
task
turns
budget
state
createdAt
expiresAt
```

Não persistir secrets.

---

# 19. MEMORY

Separar:

```text
conversation memory
task memory
working memory
knowledge retrieval
persistent business state
```

Nunca tratar business state como memory do LLM.

---

# 20. CHECKPOINT / RESUME

Implementar checkpoint de execução.

Permitir:

```text
Agent crash
    ↓
restart
    ↓
load checkpoint
    ↓
resume safely
```

Sem repetir efeitos externos.

Usar durable effect ledger existente.

---

# 21. REPLAY

Replay deve ser determinístico na medida possível.

Registrar:

```text
model
model version
runtime version
profile digest
policy revision
tool registry digest
context digest
retrieval references
tool results
approvals
usage
```

---

# 22. PROVENANCE

Cada turn deve possuir provenance completa.

Exemplo:

```text
runtimeVersion
runtimeCommit
modelProvider
model
modelRevision
agentProfileDigest
contextDigest
toolRegistryDigest
policyRevision
knowledgeReferences
correlationId
```

---

# 23. BUDGET ENGINE

Preservar e fortalecer budgets existentes.

Controlar:

```text
tokens
turns
tool calls
cost
wall time
provider requests
retrieval operations
```

Estados:

```text
AVAILABLE
RESERVED
SETTLED
EXCEEDED
UNKNOWN
```

---

# 24. APPROVAL ENGINE

HIGH/CRITICAL continua exigindo aprovação independente.

Approval binding:

```text
actor
approver
operation
tool
resource
requestDigest
policyRevision
expiresAt
oneShot
```

Reutilização proibida.

---

# 25. HUMAN-IN-THE-LOOP

Criar estado explícito:

```text
WAITING_HUMAN_APPROVAL
```

O Agent Loop deve pausar.

Nunca inventar aprovação.

---

# 26. CANCELLATION

Implementar cancellation de ponta a ponta:

```text
User
 ↓
AgentRuntime
 ↓
AgentLoop
 ↓
ModelProvider
 ↓
Tool execution
```

Ferramentas não canceláveis devem declarar isso.

---

# 27. STREAMING

Se suportado:

```text
ModelProvider
 ↓
stream
 ↓
AgentRuntime
 ↓
UI
```

Streaming nunca deve executar tool antes do tool-call estar validado.

---

# 28. CONCURRENCY

Criar controle por:

```text
organization
actor
session
model provider
tool
```

Evitar múltiplos turns concorrentes na mesma sessão quando puderem corromper estado.

---

# 29. BACKPRESSURE

Implementar:

```text
session queue
provider queue
tool queue
worker queue
```

Com limites.

Nunca unbounded queue.

---

# 30. CIRCUIT BREAKERS

Aplicar a:

```text
DeepSeek
Local model endpoint
external provider
retrieval provider
```

Estados:

```text
CLOSED
OPEN
HALF_OPEN
```

---

# 31. OBSERVABILITY

Instrumentar Agent Runtime com OpenTelemetry.

Traces:

```text
agent.session
agent.turn
context.build
retrieval.query
model.request
model.response
tool.request
tool.execute
approval.wait
```

Metrics:

```text
turn latency
model latency
tool latency
tokens
cost
context size
retrieval latency
denials
approval wait
errors
```

---

# 32. PROMPT INJECTION DEFENSE

Red-team:

```text
direct injection
indirect injection
retrieval injection
tool injection
malicious document
context poisoning
secret extraction
role escalation
```

Untrusted text = data.

Nunca policy.

---

# 33. CONTEXT BUDGET

Implementar gerenciamento de janela.

Prioridades:

```text
system/policy
active task
critical business context
tool contracts
recent conversation
retrieval
historical conversation
```

Não simplesmente truncar do início.

---

# 34. CONTEXT COMPACTION

Adicionar compactação segura.

Resumo deve possuir provenance e nunca substituir registros clínicos.

---

# 35. RETRIEVAL GOVERNANCE

Knowledge document deve possuir:

```text
source
owner
classification
scope
version
digest
approvalStatus
reviewDate
```

Somente:

```text
APPROVED
```

pode ser usado em contexto governado.

---

# 36. EMBEDDED VS EXTERNAL MODE

Preservar possibilidade de ambos.

Config:

```text
CVG_AGENT_RUNTIME=embedded
```

ou:

```text
CVG_AGENT_RUNTIME=external
```

Isso é importante para rollback e comparação.

---

# 37. SHADOW MODE

Antes de promover Embedded Harness:

executar:

```text
External Harness
       +
Embedded Harness
```

em shadow.

Somente um produz efeitos.

Comparar:

```text
outputs
tool decisions
latency
tokens
failures
```

---

# 38. DIFFERENTIAL TESTING

Criar corpus de cenários.

Rodar:

```text
old runtime
vs
embedded runtime
```

Comparar comportamento.

Nenhuma regressão crítica permitida.

---

# 39. MIGRATION PLAN

Migração:

```text
Phase A
External only

Phase B
External primary
Embedded shadow

Phase C
Embedded primary
External fallback disabled by default

Phase D
Embedded production
External retained only as rollback path
```

Nunca trocar diretamente sem prova.

---

# 40. LICENSING GATE

Antes de Phase C:

```text
license verified
provenance recorded
NOTICE generated
dependency audit passed
```

---

# 41. TESTES DO AGENT KERNEL

Cobrir:

```text
normal completion
max turns
token exhaustion
cost exhaustion
tool denial
approval wait
approval reject
model timeout
tool timeout
cancel
provider unavailable
context overflow
retrieval failure
plugin failure
```

---

# 42. ADVERSARIAL TESTS

Cobrir:

```text
infinite tool loop
recursive agent call
malicious plugin
malicious skill
malicious retrieval
fake approval
stale approval
cross-patient request
cross-org request
```

---

# 43. EXISTING CVG GATES

Preservar e executar:

```text
verify:pdp-universal
verify:authoritative-writes
verify:audit-chain
verify:worker-runtime
verify:postgres:concurrency
verify:security-red-team
verify:resource-pressure
verify:provider-sandbox
verify:production
```

Nenhuma evolução do Harness pode quebrar esses gates.

---

# 44. DEEPSEEK REAL

Após Embedded Runtime estar pronto:

provar:

```text
Embedded Harness
 ↓
DeepSeek Model Adapter
 ↓
DeepSeek real
```

Cobrir:

```text
turn
stream
structured output
tool request
approval
replay
cancel
timeout
usage
provenance
```

Criar:

```text
npm run verify:embedded-deepseek
```

---

# 45. LOCAL MODEL

Preparar um adapter local.

Não precisa promover para produção agora.

O objetivo é provar que:

```text
Harness != DeepSeek
```

Harness é o runtime.

DeepSeek é apenas um provider.

---

# 46. PROVIDER REAL

Manter separado do ModelProvider.

WhatsApp e outros providers são:

```text
Business Integrations
```

e não:

```text
Model Providers
```

Não misturar essas abstrações.

---

# 47. STAGING

Promover Embedded Harness primeiro em staging.

Executar:

```text
real PostgreSQL
real secrets
real TLS
real telemetry
real DeepSeek
provider sandbox/authorized
```

---

# 48. LOAD TEST

Adicionar carga específica do Agent Runtime:

```text
1 session
5 sessions
10 sessions
25 sessions
50 sessions
```

Medir:

```text
queue time
turn latency
tokens/sec
memory
CPU
provider saturation
```

---

# 49. CHAOS TEST DO EMBEDDED HARNESS

Executar fault injection especificamente na nova arquitetura incorporada.

Testar:

```text
kill model provider
kill worker
kill API
cancel turn
model timeout
model malformed response
plugin crash
skill loader failure
retrieval timeout
tool timeout
tool OUTCOME_UNKNOWN
PostgreSQL disconnect
session persistence failure
context builder failure
budget settlement failure
```

Provar que:

```text
Agent Runtime failure
        ≠
CVG Domain corruption
```

e:

```text
Model failure
        ≠
external effect duplicated
```

O domínio transacional deve continuar íntegro mesmo que todo o subsistema de IA fique indisponível.

---

# 50. HARNESS PROCESS ISOLATION

Mesmo com o Harness incorporado ao repositório, NÃO assumir que todos os seus componentes precisam executar no mesmo processo da API.

Separar conceitualmente:

```text
CODE OWNERSHIP
≠
PROCESS BOUNDARY
```

Podemos ter:

```text
cvg-corp repository
│
├── apps/api
├── apps/worker
├── apps/web
└── apps/agent-runtime
```

Todos pertencem ao CVG-Corp, mas podem executar como processos diferentes.

Avaliar formalmente:

```text
in-process
worker-thread
child-process
sidecar
standalone runtime process
```

para cada componente.

Documentar decisão em ADR.

---

# 51. RECOMENDAÇÃO DE PROCESS BOUNDARY

Preferir inicialmente:

```text
                    CVG-CORP

          ┌──────────────┐
          │   CVG API    │
          └──────┬───────┘
                 │
                 │ typed internal contract
                 ▼
        ┌──────────────────┐
        │  Agent Runtime   │
        │                  │
        │ Embedded Harness │
        └────────┬─────────┘
                 │
                 ▼
          Model Provider
                 │
                 ▼
             DeepSeek
```

Isso permite:

```text
same repository
same release governance
shared contracts
```

sem obrigatoriamente:

```text
same Node.js process
```

---

# 52. BLAST-RADIUS CONTAINMENT

Uma falha do Agent Runtime não pode derrubar:

```text
agenda
internação
prontuário
estoque
financeiro
recepção
diagnósticos
```

Implementar isolamento.

Se:

```text
Agent Runtime = DOWN
```

o CVG deve entrar em:

```text
AI_DEGRADED
```

e não:

```text
SYSTEM_DOWN
```

---

# 53. AI READINESS SEPARADO

Separar:

```text
/api/v1/ready
```

de:

```text
/api/v1/ai/ready
```

ou equivalente.

Readiness geral:

```text
PostgreSQL
domain
auth
critical services
```

AI readiness:

```text
AgentRuntime
ModelProvider
tool registry
policy
knowledge
```

A indisponibilidade do DeepSeek não deve tornar o hospital inteiro indisponível.

---

# 54. AGENT RUNTIME SUPERVISOR

Criar supervisor.

Responsabilidades:

```text
runtime health
session limits
provider health
queue depth
circuit breaker
plugin state
memory pressure
restart
shutdown
```

Estados:

```text
STARTING
READY
DEGRADED
DRAINING
UNAVAILABLE
STOPPED
```

---

# 55. GRACEFUL DRAIN

Durante deploy:

```text
stop accepting new sessions
        ↓
finish/cancel active turns
        ↓
persist checkpoints
        ↓
settle usage
        ↓
release leases
        ↓
shutdown
```

Adicionar deadline.

Depois do deadline:

```text
safe cancellation
```

---

# 56. VERSIONED RUNTIME CONTRACT

Versionar o AgentRuntime.

Exemplo:

```text
AgentRuntimeContract/v1
```

Preparar:

```text
v2
```

sem quebrar agentes existentes.

Criar compatibility matrix:

```text
CVG Corp version
AgentRuntime version
Plugin API version
Skill schema version
Tool schema version
ModelProvider version
```

---

# 57. RUNTIME MANIFEST

Gerar manifest determinístico:

```json
{
  "runtimeVersion": "...",
  "runtimeCommit": "...",
  "agentContractVersion": "...",
  "pluginApiVersion": "...",
  "skillSchemaVersion": "...",
  "toolRegistryDigest": "...",
  "policyRevision": "...",
  "supportedModelProviders": []
}
```

Digest desse manifest deve entrar em provenance.

---

# 58. PLUGIN DEPENDENCY GRAPH

Plugins podem depender de capabilities, mas evitar dependência arbitrária plugin→plugin.

Construir grafo.

Detectar:

```text
cycles
missing dependencies
version conflicts
capability conflicts
```

Startup deve falhar fechado quando uma dependência obrigatória não puder ser resolvida.

---

# 59. PLUGIN LIFECYCLE

Definir:

```text
DISCOVERED
VALIDATED
LOADED
INITIALIZED
READY
DEGRADED
DISABLED
FAILED
```

Nenhum plugin `FAILED` deve continuar oferecendo capabilities.

---

# 60. PLUGIN SANDBOX

Investigar isolamento para plugins de maior risco.

Opções:

```text
worker thread
child process
isolated VM/container
WASM
```

Não adicionar sandbox pesado sem necessidade.

Classificar plugin por risco.

Exemplo:

```text
LOW
MEDIUM
HIGH
UNTRUSTED
```

---

# 61. CAPABILITY-BASED PLUGIN SECURITY

Evitar entregar objetos poderosos aos plugins.

Nunca:

```ts
plugin.initialize({
  database,
  filesystem,
  secrets,
  httpClient
});
```

Preferir capabilities mínimas:

```ts
plugin.initialize({
  logger,
  metrics,
  approvedToolClient,
  scopedConfig
});
```

Princípio:

```text
no ambient authority
```

---

# 62. FILESYSTEM ACCESS

O Embedded Harness não recebe filesystem irrestrito.

Criar:

```text
WorkspaceFileCapability
```

com:

```text
allowed roots
read/write mode
file size limit
extension policy
audit
```

Nunca:

```text
/
```

como workspace.

---

# 63. NETWORK EGRESS

Model provider e plugins não recebem rede irrestrita.

Criar política:

```text
NONE
MODEL_PROVIDER
APPROVED_PROVIDER
INTERNAL_ONLY
```

Idealmente com allowlist.

Registrar:

```text
destination
purpose
provider
correlation
```

---

# 64. SECRET ACCESS

Agent Loop nunca vê secret plaintext.

Fluxo:

```text
Model/Agent
   ↓
tool request
   ↓
integration adapter
   ↓
SecretProvider
```

Nunca:

```text
SecretProvider
   ↓
Context Builder
   ↓
LLM
```

---

# 65. PROMPT FIREWALL

Criar camada antes do Context Builder finalizar o prompt.

Detectar:

```text
secret material
cross-tenant data
disallowed data classes
unapproved instructions
unexpected tool metadata
```

Não depender apenas de regex.

Usar structural policy.

---

# 66. DATA MINIMIZATION

Antes de mandar contexto para modelo:

```text
full business object
        ↓
context projection
        ↓
minimal required fields
```

Exemplo:

o modelo não precisa receber automaticamente:

```text
full guardian financial history
```

para responder sobre:

```text
appointment confirmation
```

---

# 67. DATA CLASS ENFORCEMENT

Usar as classes já existentes no CVG.

Exemplo:

```text
D0
D1
D2
D3
D4
D5
```

Cada:

```text
Agent
Skill
Plugin
Tool
ModelProvider
```

deve declarar classes aceitas.

---

# 68. MODEL PROVIDER DATA POLICY

ModelProvider deve declarar:

```text
allowedDataClasses
region
retentionPolicy
trainingPolicy
capabilities
```

Não inventar garantias do provider.

Configurar explicitamente com base no provider real.

---

# 69. LOCAL MODEL ADVANTAGE

Preparar arquitetura para que determinadas operações possam usar:

```text
LocalModelProvider
```

quando houver necessidade de:

```text
privacy
latency
offline operation
cost control
```

Sem alterar o Agent Kernel.

Arquitetura:

```text
AgentRuntime
     │
     ▼
ModelRouter
 ┌───┼────┐
 ▼   ▼    ▼
Local DeepSeek Future
```

---

# 70. MODEL ROUTER

Criar `ModelRouter` somente se houver benefício real.

Ele pode considerar:

```text
task
risk
data class
required capability
context size
latency budget
cost budget
availability
```

Nunca escolher provider que não esteja autorizado para a classe de dados.

---

# 71. MODEL ROUTING POLICY

Separar routing de decisão do Agent Loop.

Exemplo:

```text
Agent asks for model
       ↓
ModelRouter
       ↓
Policy
       ↓
Provider
```

Registrar decisão em provenance.

---

# 72. MODEL FALLBACK

Fallback só é permitido se:

```text
policy explicitly allows
+
capabilities compatible
+
data policy compatible
```

Nunca:

```text
DeepSeek failed
→ send clinical context to random provider
```

---

# 73. AGENT PROFILE

Criar profiles versionados.

Exemplos futuros:

```text
ReceptionAgent
HospitalizationAgent
ClinicalAgent
AdministrativeAgent
```

Profile:

```text
instructions
purpose
allowedTools
allowedSkills
allowedDataClasses
budgets
model requirements
risk limits
```

---

# 74. RECEPTION AGENT

Exemplo:

```text
ReceptionAgent
```

pode:

```text
read appointment
read patient minimal projection
stage communication
schedule
prepare response
```

Não pode:

```text
sign clinical record
prescribe medication
access unrestricted finance
```

---

# 75. CLINICAL AGENT

`ClinicalAgent` deve ter boundaries próprios.

Pode:

```text
retrieve approved clinical knowledge
summarize encounter
prepare draft
identify missing documentation
```

Mas:

```text
AI output
      ↓
DRAFT
```

e não automaticamente:

```text
SIGNED CLINICAL DOCUMENT
```

---

# 76. CLINICAL DRAFT PROMOTION

Fluxo obrigatório:

```text
AI generates
   ↓
DRAFT
   ↓
Veterinarian reviews
   ↓
EDIT / REJECT / APPROVE
   ↓
PROMOTE
   ↓
ClinicalDocument
```

Registrar provenance do draft.

---

# 77. HOSPITALIZATION AGENT

Preparar profile para:

```text
handoff summary
pending tasks
scheduled exams
medication reminders
documentation gaps
```

Nunca alterar automaticamente prescrição ou administração sem policy específica.

---

# 78. AGENT-TO-AGENT COMMUNICATION

Se múltiplos agentes forem introduzidos:

não permitir conversa livre sem governança.

Usar:

```text
typed message
purpose
sender
receiver
correlation
scope
TTL
```

---

# 79. ORCHESTRATOR

Se necessário, criar:

```text
AgentOrchestrator
```

Ele decide:

```text
which agent
which workflow
which task
```

Mas não substitui PDP.

Fluxo:

```text
request
 ↓
orchestrator
 ↓
agent selection
 ↓
policy
 ↓
AgentRuntime
```

---

# 80. ORCHESTRATOR NÃO É LLM OBRIGATORIAMENTE

Preferir roteamento determinístico quando possível.

Exemplo:

```text
appointment confirmation
→ ReceptionAgent
```

não precisa gastar um LLM para decidir isso.

Usar LLM routing apenas quando necessário.

---

# 81. WORKFLOW ENGINE VS AGENT

Não usar agente para tarefas determinísticas.

Exemplo:

```text
send reminder 1 hour before ultrasound
```

é:

```text
scheduler/workflow
```

e não:

```text
LLM reasoning loop
```

O agente pode ajudar a redigir a mensagem, mas não precisa controlar o relógio.

---

# 82. EVENT-DRIVEN INTEGRATION

Integrar Agent Runtime ao domínio por eventos quando apropriado.

Exemplo:

```text
AppointmentCreated
        ↓
workflow
        ↓
CommunicationRequested
        ↓
Agent prepares draft
```

Evitar polling desnecessário.

---

# 83. COMMAND / EVENT SEPARATION

Agente solicita:

```text
Command
```

Domínio produz:

```text
Event
```

Exemplo:

```text
Agent
 ↓
StageCommunicationCommand
 ↓
Application
 ↓
CommunicationStaged
```

---

# 84. NEVER TRUST MODEL OUTPUT

Todo structured output deve passar por:

```text
schema validation
semantic validation
policy
domain validation
```

LLM JSON válido ainda pode estar semanticamente errado.

---

# 85. STRUCTURED OUTPUT

Preferir structured output para operações.

Exemplo:

```json
{
  "intent": "STAGE_APPOINTMENT_CONFIRMATION",
  "appointmentId": "...",
  "messageDraft": "..."
}
```

Não parsear texto livre com regex para comandos críticos.

---

# 86. TOOL ARGUMENT VALIDATION

Tool call:

```text
Model
 ↓
JSON schema
 ↓
semantic validator
 ↓
PDP
 ↓
Tool Gateway
```

Qualquer falha:

```text
DENY
```

---

# 87. TOOL RESULT SANITIZATION

Resultados de tools também são dados potencialmente não confiáveis.

Especialmente:

```text
web
external APIs
retrieved documents
provider responses
```

Marcar provenance e trust level.

---

# 88. TOOL LOOP DETECTION

Detectar:

```text
tool A
→ model
→ tool A
→ model
→ tool A
```

sem progresso.

Interromper após threshold.

Registrar:

```text
LOOP_DETECTED
```

---

# 89. PROGRESS DETECTION

Agent Loop deve manter:

```text
task state
completed objectives
pending objectives
```

Não depender somente da memória textual do modelo.

---

# 90. STOP CONDITIONS

Stop conditions explícitas:

```text
TASK_COMPLETED
WAITING_HUMAN
BUDGET_EXCEEDED
POLICY_DENIED
CANCELLED
TIMEOUT
NO_PROGRESS
DEPENDENCY_UNAVAILABLE
ERROR
```

---

# 91. RETRY SEMANTICS

Separar:

```text
MODEL retry
TOOL retry
EXTERNAL EFFECT retry
```

São coisas diferentes.

Modelo:

pode ser retryable.

Read-only tool:

pode ser retryable.

External effect:

só conforme effect ledger/reconciliation.

---

# 92. MODEL RETRY

Aplicar:

```text
exponential backoff
jitter
max attempts
```

somente para erros retryable.

Não retry:

```text
policy denied
invalid request
budget exceeded
```

---

# 93. PROVIDER USAGE RECONCILIATION

Comparar:

```text
local token estimate
provider reported usage
```

Registrar discrepancy.

Não alterar registros históricos silenciosamente.

---

# 94. CONTEXT OBSERVABILITY

Registrar metadados:

```text
contextTokens
conversationTokens
retrievalTokens
toolTokens
systemTokens
```

Sem registrar conteúdo sensível bruto.

---

# 95. RETRIEVAL QUALITY

Medir:

```text
retrieval hit rate
references used
irrelevant retrieval
empty retrieval
```

Preparar evals.

---

# 96. AGENT EVALS

Criar:

```text
evals/
```

Com cenários veterinários sintéticos.

Avaliar:

```text
task completion
policy compliance
tool correctness
hallucination
citation/reference correctness
safety
latency
cost
```

---

# 97. GOLDEN DATASET

Criar dataset sintético versionado.

Nunca usar prontuário real sem autorização.

Exemplos:

```text
appointment
hospitalization handoff
lab result
clinical summary
communication
```

---

# 98. REGRESSION EVALS

Toda alteração em:

```text
model
prompt
skill
plugin
context builder
retrieval
```

deve executar evals.

---

# 99. SHADOW EVALS

Durante migração:

```text
External Harness output
vs
Embedded Harness output
```

Não comparar apenas texto.

Comparar:

```text
tool choices
policy decisions
completion
latency
usage
```

---

# 100. DETERMINISTIC FIXTURES

Para CI, usar provider/model fixtures determinísticos.

Testes com LLM real devem ficar em gate separado.

---

# 101. REAL MODEL GATE

Criar:

```text
verify:model-real
```

Só executa com:

```text
explicit credentials
explicit endpoint
explicit authorization
```

Caso contrário:

```text
BLOCKED_EXTERNAL
```

---

# 102. MODEL QUALITY GATE

Real model não passa só porque HTTP 200.

Avaliar:

```text
schema compliance
tool correctness
policy compliance
task completion
```

---

# 103. COST GATE

Registrar custo por cenário.

Não definir limite arbitrário sem evidência.

Criar baseline.

---

# 104. LATENCY GATE

Medir:

```text
TTFT
full turn
tool roundtrip
complete workflow
```

---

# 105. PERFORMANCE BUDGETS

Depois de baseline real:

definir budgets.

Até lá:

```text
PROPOSED
```

---

# 106. HARNESS BENCHMARK

Criar benchmark isolado:

```text
Context Builder
Agent Loop
Tool Gateway overhead
Session persistence
```

Separar do tempo do modelo.

---

# 107. MEMORY PRESSURE

Testar muitas sessões.

Exemplo:

```text
10
50
100
500
```

conforme hardware disponível.

Medir:

```text
heap
RSS
GC
queue
latency
```

---

# 108. SESSION EVICTION

Sessões inativas não devem ficar eternamente na RAM.

Implementar:

```text
TTL
checkpoint
eviction
resume
```

---

# 109. SESSION OWNERSHIP

Em múltiplas instâncias:

evitar duas instâncias executarem simultaneamente a mesma sessão.

Usar:

```text
lease
fence
```

# 109. SESSION OWNERSHIP (continuação)

Em múltiplas instâncias, impedir que duas instâncias executem simultaneamente a mesma sessão.

Usar:

```text
lease
+
fencing token
+
expiration
```

Modelo:

```text
Agent Runtime A
      │
      ├── acquire session lease
      │
      ▼
   Session X
      │
      └── fence=42

Agent Runtime B
      │
      └── tentativa de execução
             ↓
          DENIED
```

Se A perder lease:

```text
A fence=42  → stale
B fence=43  → authoritative
```

A instância antiga não pode persistir novo estado.

---

# 110. DISTRIBUTED SESSION STORE

A sessão não pode depender exclusivamente da memória do processo.

Criar boundary:

```ts
interface AgentSessionStore {
  create(...)
  load(...)
  checkpoint(...)
  acquireLease(...)
  renewLease(...)
  releaseLease(...)
  complete(...)
}
```

Implementação inicial de produção:

```text
PostgreSQLAgentSessionStore
```

Pode existir:

```text
MemoryAgentSessionStore
```

somente para desenvolvimento/testes.

---

# 111. SESSION CHECKPOINT

Checkpoint deve conter estado mínimo necessário para recuperação.

Exemplo:

```text
session
turn
task state
budget
pending approval
pending tool
tool results
model provenance
runtime version
fencing token
```

Nunca armazenar:

```text
plaintext secrets
provider credentials
unnecessary clinical payload
```

---

# 112. TURN LEDGER

Criar ledger durável de turns.

Modelo conceitual:

```text
AgentSession
     │
     ├── Turn 001
     ├── Turn 002
     ├── Turn 003
     └── Turn 004
```

Cada turn:

```text
turnId
sessionId
sequence
status
inputDigest
contextDigest
modelRequestDigest
modelResponseDigest
toolRequests
usageRecordId
provenance
startedAt
completedAt
```

---

# 113. APPEND-ONLY TURN HISTORY

Turns concluídos não devem ser silenciosamente sobrescritos.

Correções devem gerar:

```text
new event
new revision
new turn
```

quando apropriado.

Preservar auditabilidade.

---

# 114. MULTI-INSTANCE AGENT RUNTIME

Provar:

```text
AgentRuntime-1
AgentRuntime-2
AgentRuntime-3
```

contra:

```text
PostgreSQL
```

Testar:

```text
session lease contention
lease expiration
fencing
crash takeover
duplicate turn prevention
checkpoint resume
```

---

# 115. RUNTIME HORIZONTAL SCALING

O Embedded Harness deve poder escalar sem alterar domínio.

Arquitetura:

```text
             CVG API
                │
        ┌───────┼───────┐
        ▼       ▼       ▼
     Runtime  Runtime  Runtime
       #1       #2       #3
        │       │       │
        └───────┼───────┘
                ▼
            PostgreSQL
```

Não usar sticky session como requisito de integridade.

Pode ser otimização, não autoridade.

---

# 116. MODEL PROVIDER POOL

Se necessário, preparar múltiplos endpoints.

Exemplo:

```text
DeepSeek endpoint A
DeepSeek endpoint B
Local endpoint
```

Mas routing deve continuar policy-driven.

---

# 117. DISTRIBUTED RATE LIMIT

Rate limits do Agent Runtime devem ser compartilhados entre instâncias.

Controlar:

```text
organization
actor
session
model
provider
tool
```

Não depender de `Map` local em produção.

---

# 118. DISTRIBUTED BUDGET

Budget também precisa ser durável.

Duas instâncias não podem gastar simultaneamente o mesmo saldo reservado.

Usar:

```text
reservation
CAS
transaction
settlement
```

---

# 119. COST RESERVATION

Antes de operação potencialmente cara:

```text
estimate
   ↓
reserve budget
   ↓
execute
   ↓
settle actual
```

Se usage real ficar desconhecido:

```text
SETTLEMENT_UNKNOWN
```

e não liberar saldo automaticamente.

---

# 120. EMBEDDED HARNESS PACKAGE BOUNDARY

Não despejar o código do DeepSeek Harness diretamente em:

```text
apps/api/
```

Criar boundary claro.

Exemplo:

```text
packages/
└── agent-kernel/
    ├── loop/
    ├── context/
    ├── session/
    ├── plugins/
    ├── skills/
    └── runtime/
```

Código originado/adaptado do Harness deve permanecer identificável.

---

# 121. UPSTREAM TRACKING

Se código do DeepSeek Harness for incorporado:

registrar:

```text
upstream repository
upstream commit
import date
local modifications
license
```

Criar:

```text
docs/third-party/deepseek-harness-upstream.md
```

---

# 122. UPSTREAM DIFF

Criar mecanismo para comparar:

```text
CVG embedded version
        vs
DeepSeek upstream
```

Não precisa sincronizar automaticamente.

Mas deve ser possível identificar:

```text
new upstream changes
security fixes
breaking changes
```

---

# 123. NEVER BLIND UPDATE

Nunca executar:

```text
copy latest upstream
→ overwrite embedded runtime
```

Fluxo obrigatório:

```text
upstream update
 ↓
diff
 ↓
security review
 ↓
compatibility review
 ↓
tests
 ↓
shadow
 ↓
promotion
```

---

# 124. EMBEDDED HARNESS SBOM

SBOM deve distinguir:

```text
CVG-owned
third-party embedded
npm dependencies
runtime dependencies
```

---

# 125. CODE OWNERSHIP

Definir ownership lógico:

```text
CVG Domain
CVG Security
Agent Kernel
Model Providers
Integrations
Frontend
Persistence
Operations
```

Mudanças no Agent Kernel devem disparar gates específicos.

---

# 126. HARNESS CHANGE GATE

Criar:

```bash
npm run verify:agent-runtime
```

Executar:

```text
kernel tests
context tests
session tests
plugin tests
skill tests
tool boundary tests
model adapter tests
replay tests
budget tests
approval tests
```

---

# 127. CONTEXT BUILDER GATE

Criar testes próprios.

Cobrir:

```text
priority
truncation
compaction
data classification
cross-tenant rejection
prompt injection
token budget
retrieval filtering
```

---

# 128. PLUGIN GATE

Criar:

```bash
npm run verify:plugins
```

Testar:

```text
invalid manifest
wrong digest
missing capability
forbidden permission
dependency cycle
initialization crash
shutdown failure
```

---

# 129. SKILL GATE

Criar:

```bash
npm run verify:skills
```

Testar:

```text
schema
digest
required tools
required capabilities
version
data classes
untrusted content
```

---

# 130. MODEL ADAPTER CONTRACT TEST

Todos os ModelProviders devem passar pelo mesmo contract suite.

Exemplo:

```text
health
complete
structured output
cancel
timeout
usage
error normalization
```

---

# 131. REPLAY COMPATIBILITY

Uma atualização do Agent Kernel não deve falsamente alegar que um replay antigo é equivalente.

Registrar:

```text
runtimeVersion
```

e classificar:

```text
EXACT_REPLAY
COMPATIBLE_REPLAY
NON_EQUIVALENT_REPLAY
```

---

# 132. EVENT SCHEMA VERSIONING

Todos os eventos do Agent Runtime precisam de versão.

Exemplo:

```text
agent.session.created/v1
agent.turn.completed/v1
agent.tool.requested/v1
agent.approval.required/v1
```

---

# 133. UPCONVERSION

Criar upcasters explícitos para eventos antigos quando necessário.

Nunca aceitar schema desconhecido silenciosamente.

---

# 134. DATABASE MIGRATION

Se o Embedded Harness precisar de tabelas próprias:

usar migrations CVG normais.

Exemplo:

```text
agent_sessions
agent_turns
agent_checkpoints
agent_leases
agent_usage
```

Aplicar:

```text
organization provenance
RLS
FK
indexes
```

---

# 135. NO SECOND DATABASE AUTHORITY

Não criar outro banco “do Harness” como fonte paralela de verdade sem justificativa forte.

Preferir:

```text
PostgreSQL CVG
  ├── domain
  └── agent runtime state
```

com schemas/boundaries apropriados.

---

# 136. AGENT RLS

Estado de agente também deve possuir isolamento organizacional.

Testar:

```text
Organization A
cannot access
Organization B session
```

---

# 137. SESSION DATA RETENTION

Definir política separada para:

```text
turn metadata
raw model response
context snapshots
tool results
```

Não assumir retenção infinita.

Decisões legais/regulatórias devem permanecer `PROPOSED` até aprovação humana.

---

# 138. SENSITIVE CONTEXT RETENTION

Evitar persistir prompt completo quando não necessário.

Preferir:

```text
digest
+
structured provenance
+
approved evidence
```

quando suficiente.

---

# 139. DEBUG MODE

Debug de IA nunca pode automaticamente logar:

```text
full prompt
clinical data
secrets
authorization tokens
```

Criar redaction obrigatória.

---

# 140. SUPPORT BUNDLE

Criar bundle de diagnóstico sanitizado.

Exemplo:

```text
runtime version
manifest
health
metrics
recent error codes
queue status
provider status
```

Sem PII/PHI desnecessária.

---

# 141. ERROR TAXONOMY DO AGENT RUNTIME

Padronizar:

```text
RUNTIME_UNAVAILABLE
MODEL_UNAVAILABLE
MODEL_TIMEOUT
MODEL_INVALID_RESPONSE
CONTEXT_REJECTED
CONTEXT_TOO_LARGE
POLICY_DENIED
TOOL_DENIED
TOOL_TIMEOUT
TOOL_OUTCOME_UNKNOWN
APPROVAL_REQUIRED
APPROVAL_REJECTED
BUDGET_EXCEEDED
LOOP_DETECTED
NO_PROGRESS
CANCELLED
```

---

# 142. RETRY CLASSIFICATION

Cada erro deve declarar:

```text
retryable
nonRetryable
reconciliationRequired
humanActionRequired
```

---

# 143. USER-FACING FAILURE STATES

UI não deve mostrar apenas:

```text
Erro de IA
```

Distinguir:

```text
IA temporariamente indisponível
Aguardando aprovação
Limite atingido
Operação não permitida
Resultado externo em reconciliação
```

Sem expor detalhes internos sensíveis.

---

# 144. AI-DEGRADED UX

Se DeepSeek cair:

```text
agenda
prontuário
internação
estoque
financeiro
```

continuam funcionando.

A UI apenas marca:

```text
Assistente de IA indisponível
```

---

# 145. AGENT FEATURE FLAGS

Adicionar flags governadas para:

```text
embeddedRuntime
externalRuntime
specificAgent
specificTool
specificPlugin
specificModel
```

Feature flag não substitui PDP.

---

# 146. KILL SWITCH

Criar kill switch operacional para:

```text
all AI
specific provider
specific tool
specific plugin
```

Ativação auditada.

---

# 147. TOOL KILL SWITCH

Particularmente importante.

Se houver comportamento anômalo:

```text
disable communication.send
```

sem precisar derrubar o sistema inteiro.

---

# 148. MODEL KILL SWITCH

Permitir:

```text
DeepSeekProvider = DISABLED
```

e manter CVG operacional.

---

# 149. SAFE MODE

Criar:

```text
AI_SAFE_MODE
```

onde:

```text
read-only AI
no external effects
no high-impact tools
```

---

# 150. INCIDENT MODE

Durante incidente de IA:

```text
disable risky tools
increase audit
preserve evidence
restrict plugins
```

---

# 151. RUNTIME AUDIT EVENTS

Auditar:

```text
session create
session end
model selection
tool request
tool deny
tool execution
approval
budget exceeded
plugin load
plugin disable
kill switch
safe mode
```

---

# 152. SECURITY EVENT SEPARATION

Eventos de segurança devem ser facilmente consultáveis sem analisar todos os logs.

---

# 153. ANOMALY SIGNALS

Produzir métricas para:

```text
tool denial spike
prompt injection detection spike
model failure spike
budget spike
loop detection spike
cross-scope denial spike
```

---

# 154. PROMPT INJECTION QUARANTINE

Conteúdo suspeito deve poder ser:

```text
QUARANTINED
```

sem entrar no contexto principal.

Registrar motivo.

---

# 155. RETRIEVAL DOCUMENT QUARANTINE

Documentos comprometidos:

```text
APPROVED
→ QUARANTINED
```

devem parar de entrar em novos contextos imediatamente.

---

# 156. KNOWLEDGE INVALIDATION

Se documento aprovado for substituído:

invalidar cache/retrieval index associado quando necessário.

---

# 157. CACHE POLICY

Caches nunca podem bypassar:

```text
RLS
PDP
data classification
document approval
```

---

# 158. CONTEXT CACHE

Se implementar cache de contexto:

key deve considerar:

```text
organization
actor permissions
purpose
policy revision
knowledge revision
```

Nunca compartilhar cache cross-tenant.

---

# 159. TOOL RESULT CACHE

Somente para ferramentas declaradas cacheable/read-only.

Nunca cachear external effect.

---

# 160. PLUGIN HOT RELOAD

Não implementar hot reload em produção sem necessidade.

Preferir:

```text
validated deployment
```

Hot reload pode existir em desenvolvimento.

---

# 161. RUNTIME DEPLOYMENT

Adicionar imagem/processo:

```text
cvg-agent-runtime
```

se a decisão arquitetural for process isolation.

Compose:

```text
proxy
web
api
worker
agent-runtime
postgres
observability
```

---

# 162. CONTAINER HARDENING

Agent runtime container:

```text
non-root
read-only filesystem
cap_drop ALL
no-new-privileges
resource limits
pids limit
healthcheck
```

---

# 163. NETWORK SEGMENTATION

Ideal:

```text
Web
 │
Proxy
 │
API
 │
Agent Runtime
 │
Model Provider
```

Agent Runtime não precisa de acesso arbitrário ao PostgreSQL se a arquitetura usar API/application boundary.

Se precisar de session persistence direta, limitar ao schema/capabilities específicas.

---

# 164. DATABASE ROLE SEPARATION

Se Agent Runtime acessar PostgreSQL:

criar role dedicada:

```text
cvg_agent_runtime
```

com acesso somente às tabelas necessárias.

Nunca usar:

```text
cvg_migration
```

ou role administrativa.

---

# 165. DEPLOYMENT TOPOLOGY ADR

Documentar a decisão final em:

```text
docs/adr/ADR-embedded-agent-runtime-topology.md
```

Comparar:

```text
in-process
separate process
sidecar
external service
```

com:

```text
security
latency
operability
blast radius
complexity
```

---

# 166. DECISION GATE: EMBED OU NÃO EMBED

Após toda auditoria inicial, o Codex NÃO deve assumir que embedding é automaticamente melhor.

Produzir decisão formal:

```text
EMBED_APPROVED
```

ou:

```text
KEEP_EXTERNAL
```

ou:

```text
HYBRID
```

Com evidências.

---

# 167. PREFER HYBRID MIGRATION

Se embedding for aprovado, preferir inicialmente:

```text
Embedded runtime
+
External adapter
```

sob o mesmo `AgentRuntime`.

Isso preserva rollback.

---

# 168. NO DOMAIN FORK

Não criar:

```text
CVG domain for embedded
CVG domain for external
```

Ambos usam exatamente os mesmos application/domain boundaries.

---

# 169. NO TOOL FORK

Não criar tools duplicadas.

```text
Embedded
       ┐
       ├→ CVG Tool Gateway
External
       ┘
```

---

# 170. NO POLICY FORK

Mesma regra:

```text
Embedded
       ┐
       ├→ CVG PDP
External
       ┘
```

---

# 171. MIGRATION DIFFERENTIAL GATE

Antes de mudar primary runtime:

executar corpus de evals.

Exigir:

```text
zero security regressions
zero authorization regressions
zero critical tool regressions
```

Diferenças de texto podem ser aceitáveis.

---

# 172. SHADOW TRAFFIC

Em staging:

```text
request
  ├→ primary runtime
  └→ shadow runtime
```

Shadow:

```text
NO external effects
NO writes
```

Somente comparação.

---

# 173. SHADOW PRIVACY

Não duplicar dados para provider não autorizado.

Shadow runtime precisa obedecer exatamente à data policy.

---

# 174. PROMOTION

Somente promover Embedded Harness quando:

```text
contract tests
security tests
evals
load
chaos
recovery
shadow comparison
```

estiverem aprovados.

---

# 175. ROLLBACK

Rollback deve ser configuracional quando possível.

Exemplo:

```text
CVG_AGENT_RUNTIME=external
```

Sem migration destrutiva.

---

# 176. ROLLBACK STATE COMPATIBILITY

External e Embedded precisam compreender estado persistido necessário para rollback.

Se não for possível, documentar migration/compatibility strategy.

---

# 177. PRODUCTION CANARY

Promover gradualmente.

Exemplo:

```text
internal admin
↓
selected users
↓
selected workflows
↓
broader rollout
```

Não usar dados reais sem autorização correspondente.

---

# 178. CANARY METRICS

Comparar:

```text
error rate
latency
tool denials
tool failures
cost
user cancellation
approval rate
```

---

# 179. AUTO-ROLLBACK SIGNALS

Preparar critérios.

Exemplo:

```text
critical security violation
effect duplication
corruption
runtime crash loop
```

→ rollback imediato

# 180. AUTO-ROLLBACK POLICY

Formalizar sinais de rollback automático ou operacional imediato.

Triggers críticos:

```text
security boundary violation
cross-tenant exposure
duplicate external effect
domain corruption
audit corruption
fencing violation
approval bypass
secret exposure
runtime crash loop
unbounded resource growth
```

Triggers devem gerar:

```text
incident event
+
runtime isolation
+
safe mode
+
operator alert
```

Rollback automático só deve ocorrer quando comprovadamente seguro.

Caso contrário:

```text
SAFE_MODE
+
HUMAN_DECISION_REQUIRED
```

---

# 181. PRODUCTION PROMOTION INVARIANT

Formalizar:

```text
SOURCE SHA
   ==
CI SHA
   ==
ARTIFACT SHA
   ==
STAGING SHA
   ==
PROMOTED SHA
```

Nenhum rebuild entre staging aprovado e produção.

---

# 182. ARTIFACT IDENTITY

Cada release deve possuir:

```text
git SHA
container digest
SBOM digest
runtime manifest digest
tool registry digest
policy revision
migration set digest
embedded harness upstream commit
plugin registry digest
skill registry digest
```

---

# 183. RELEASE PROVENANCE

Gerar:

```text
artifacts/release-provenance.json
```

Schema obrigatório e versionado.

---

# 184. EMBEDDED HARNESS PROVENANCE

Registrar separadamente:

```text
source repository
source commit
license
imported files
modified files
CVG patches
security review
```

Isso permite saber exatamente:

```text
o que veio do Harness
vs
o que é CVG
```

---

# 185. BUILD REPRODUCIBILITY

Reduzir variação de build.

Usar:

```text
lockfile
pinned runtime
pinned actions
pinned container bases
```

Registrar digest.

---

# 186. SUPPLY-CHAIN SECURITY

Manter/fortalecer:

```text
SBOM
Trivy
npm audit
license audit
GitHub Actions pinned by SHA
container digest pinning
```

Adicionar análise específica de código incorporado do Harness.

---

# 187. THIRD-PARTY SECURITY WATCH

Documentar processo para acompanhar vulnerabilidades do upstream incorporado.

Se surgir CVE relevante:

```text
identify affected embedded component
↓
assess CVG exposure
↓
patch
↓
full regression
```

---

# 188. SECRET AUTHORITY

Staging/produção devem utilizar Secret Authority real.

Nunca:

```text
.env with production secrets
```

como autoridade final.

Usar solução aprovada.

---

# 189. SECRET ROTATION DRILL

Executar:

```text
rotate model provider credential
rotate provider credential
rotate callback secret
rotate recovery key reference
```

Provar que o sistema continua íntegro.

---

# 190. MODEL CREDENTIAL ISOLATION

DeepSeek credential pertence ao:

```text
ModelProvider boundary
```

Não ao:

```text
Agent
Skill
Plugin
Context Builder
```

---

# 191. PRODUCTION STAGING PARITY

Staging deve possuir mesma topologia lógica de produção:

```text
proxy
web
api
worker
agent-runtime
postgres
telemetry
secret authority
```

Diferenças devem ser documentadas.

---

# 192. CONTAINER SMOKE

Executar containers reais.

Provar:

```text
startup
health
readiness
login
patient lookup
controlled write
worker
agent runtime
model health
shutdown
restart
```

---

# 193. AGENT RUNTIME SMOKE

Adicionar:

```bash
npm run verify:agent-runtime-smoke
```

Executar:

```text
create session
build context
call model fixture
request read-only tool
complete turn
checkpoint
reload
complete session
```

---

# 194. EMBEDDED DEEPSEEK SMOKE

Quando autorizado:

```bash
npm run verify:embedded-deepseek
```

Deve provar o caminho real.

---

# 195. PRODUCTION-LIKE PROVIDER VERTICAL

Preservar o provider externo como boundary separado.

Provar uma vertical completa:

```text
appointment
↓
communication request
↓
agent draft
↓
approval
↓
outbox
↓
worker
↓
provider
↓
receipt
↓
callback
↓
reconciliation
↓
audit
```

---

# 196. END-TO-END TRACE

A vertical acima deve gerar trace correlacionado.

Exemplo:

```text
requestId
   ↓
correlationId
   ↓
agentSessionId
   ↓
turnId
   ↓
toolInvocationId
   ↓
outboxId
   ↓
providerRequestId
```

---

# 197. SLO MEASUREMENT

Medir, não inventar:

```text
API availability
API p95
patient lookup p95
agent queue delay
model TTFT
agent turn p95
tool execution p95
outbox delay
provider acknowledgment
```

---

# 198. AGENT-SPECIFIC SLO

Definir depois de medição.

Exemplos de dimensões:

```text
AgentRuntime availability
turn latency
queue wait
model failure rate
tool failure rate
context build latency
```

Até haver dados:

```text
PROPOSED
```

---

# 199. ERROR BUDGET

Criar error budget somente depois dos SLOs aprovados.

Não usar números arbitrários para obter selo AAA.

---

# 200. LOAD PROFILE

Executar workload representativo do uso real esperado.

Separar:

```text
normal
peak
burst
degraded dependency
```

---

# 201. MULTI-USER AGENT LOAD

Testar sessões simultâneas.

Medir:

```text
queue
CPU
RAM
DB
provider
tokens
latency
```

---

# 202. LOAD + BUSINESS TRAFFIC

Não testar IA isoladamente.

Executar simultaneamente:

```text
patient reads
appointments
clinical operations
worker processing
agent turns
```

para detectar resource contention.

---

# 203. BULKHEAD VALIDATION

Provar que carga de IA não derruba:

```text
prontuário
agenda
internação
```

Esse é um gate crítico.

---

# 204. AI RESOURCE QUOTAS

Agent Runtime deve possuir limites próprios.

Exemplo:

```text
CPU
memory
connections
concurrency
queue
```

---

# 205. DATABASE POOL ISOLATION

Avaliar pool separado para runtime de agentes quando necessário.

IA não deve consumir todas as conexões do sistema transacional.

---

# 206. CHAOS — MODEL PROVIDER

Testar:

```text
latency 5s
latency 30s
timeout
HTTP 429
HTTP 500
malformed response
disconnect
```

---

# 207. CHAOS — AGENT RUNTIME

Testar:

```text
kill during model call
kill during tool wait
kill during approval wait
kill after checkpoint
kill before checkpoint
```

---

# 208. CHAOS — DATABASE

Testar:

```text
temporary disconnect
transaction abort
pool exhaustion
restart
```

---

# 209. CHAOS — WORKER

Testar:

```text
lease loss
worker kill
duplicate worker
stale worker
```

---

# 210. CHAOS — PROVIDER

Testar:

```text
response lost after effect
duplicate callback
late callback
invalid callback
status query unavailable
```

---

# 211. CHAOS SUCCESS CRITERIA

Após qualquer fault:

```text
no domain corruption
no cross-tenant exposure
no duplicated external effect
audit preserved
recovery deterministic
```

---

# 212. RECOVERY — AGENT SESSION

Provar:

```text
session running
↓
runtime crashes
↓
new runtime acquires lease
↓
checkpoint loaded
↓
execution resumes
```

Sem repetir tool effect já settled.

---

# 213. RECOVERY — PENDING APPROVAL

Se crash ocorrer em:

```text
WAITING_HUMAN_APPROVAL
```

após restart deve continuar:

```text
WAITING_HUMAN_APPROVAL
```

Não gerar nova aprovação silenciosamente.

---

# 214. RECOVERY — OUTCOME UNKNOWN

Persistir:

```text
OUTCOME_UNKNOWN
```

através de restart.

Nunca convertê-lo para retryable automaticamente.

---

# 215. BACKUP DO AGENT STATE

Adicionar ao backup quando necessário:

```text
agent sessions
turn ledger
checkpoints
usage
provenance
```

Somente dados necessários.

---

# 216. RESTORE AGENT STATE

Restore deve validar digests antes de permitir retomada.

Sessões restauradas podem entrar inicialmente em:

```text
QUARANTINED_RESTORE
```

até validação.

---

# 217. RTO/RPO

Executar drill cronometrado.

Registrar:

```text
observed RTO
observed RPO
```

Não declarar objetivo atingido sem medição.

---

# 218. SECURITY RED TEAM — EMBEDDED HARNESS

Adicionar ataques específicos:

```text
plugin privilege escalation
skill instruction override
context injection
model adapter bypass
direct Tool Gateway bypass
PDP bypass
session hijacking
lease spoofing
fence replay
checkpoint tampering
provenance tampering
```

---

# 219. PLUGIN RED TEAM

Testar plugin malicioso tentando:

```text
filesystem access
network access
secret access
DB access
tool bypass
```

Deve falhar.

---

# 220. SKILL RED TEAM

Skill maliciosa tentando:

```text
override system
grant permissions
approve action
exfiltrate data
```

deve permanecer apenas dado/instrução de baixo privilégio.

---

# 221. RETRIEVAL RED TEAM

Documento contendo:

```text
Ignore previous instructions...
```

não pode modificar policy ou permissions.

---

# 222. MODEL OUTPUT RED TEAM

Modelo tentando chamar tool não permitida:

```text
DENIED
+
AUDITED
```

---

# 223. CROSS-PATIENT RED TEAM

Agente com contexto Patient A solicitando Patient B sem autorização:

```text
DENIED
```

---

# 224. CROSS-ORGANIZATION RED TEAM

Obrigatório:

```text
Organization A
→ Organization B
= DENIED
```

em:

```text
domain
retrieval
session
tool
cache
```

---

# 225. INDEPENDENT CRITICS

Executar critics separados:

```text
Architecture
Domain Integrity
Security
Authentication
Authorization
Agent Runtime
Plugin Security
AI Safety
DeepSeek
Database
Reliability
Workers
Observability
Frontend
Accessibility
DevOps
Recovery
Production Readiness
```

---

# 226. CRITIC RULES

Cada critic:

```text
fresh context
read-only
cannot modify code
must cite evidence
must identify residual risk
```

---

# 227. CRITIC OUTPUT

Formato:

```text
PASS
PASS_WITH_LIMITATIONS
FAIL
```

Findings:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

---

# 228. NO SELF-CERTIFICATION

O agente que implementou uma fase não deve ser a única autoridade para certificar a própria fase.

Usar critic independente quando disponível.

---

# 229. REPAIR LOOP

Para todo:

```text
CRITICAL
HIGH
```

executar:

```text
finding
↓
repair
↓
focused tests
↓
full regression
↓
fresh critic
```

---

# 230. MEDIUM FINDINGS

MEDIUM precisa:

```text
repair
```

ou:

```text
documented residual-risk acceptance
```

quando apropriado.

Não esconder.

---

# 231. HUMAN DECISION BOUNDARY

Não automatizar decisões que exigem autoridade humana.

Exemplos:

```text
production promotion
residual-risk acceptance
real patient data
retention policy
break-glass authority
RTO/RPO acceptance
```

---

# 232. MACHINE-READABLE EVIDENCE

Preservar o sistema atual de evidence bundle.

Cada gate precisa possuir:

```text
gateId
status
subjectSha
procedure
exitCode
environment
timestamp
artifactDigest
reviewer
limitations
residualRisk
```

---

# 233. EVIDENCE OUTSIDE WORKTREE

Preservar:

```text
CVG_TRIPLO_EVIDENCE_ROOT
```

fora do source checkout.

Não permitir que simples edição do repositório fabrique aprovação.

---

# 234. SAME-SHA RULE

Regra absoluta:

```text
AUDITED SHA
=
CI SHA
=
STAGING SHA
=
ARTIFACT SHA
=
EVIDENCE SHA
```

---

# 235. EVIDENCE FRESHNESS

Evidence deve possuir:

```text
timestamp
subject SHA
environment identity
```

Rejeitar:

```text
stale
future-dated
wrong SHA
missing artifact
```

---

# 236. TRIPLE AAA SCORECARD

Manter scorecard machine-readable.

Dimensões mínimas:

```text
Architecture
Domain Integrity
Security
Authentication
Authorization
PDP
Tool Gateway
Agent Runtime
Plugin Security
Database
Reliability
Workers
DeepSeek
AI Governance
Provider Integration
Frontend
Accessibility
Testing
Observability
Performance
Recovery
DevOps
Supply Chain
Production Readiness
```

---

# 237. SCORE REQUIREMENTS

Cada dimensão deve conter:

```text
score
evidence
SHA
tests
artifacts
limitations
residualRisk
```

Nenhum score sem evidence.

---

# 238. STATE OF ART GATE

Somente permitir:

```text
STATE_OF_THE_ART_CANDIDATE
```

se:

```text
[ ] architecture >= 95
[ ] domain integrity >= 95
[ ] security >= 95
[ ] authorization >= 95
[ ] reliability >= 95
[ ] AgentRuntime proven
[ ] Tool Gateway proven
[ ] no critical blocker
```

---

# 239. EMBEDDED HARNESS PROMOTION GATE

Somente promover Embedded Harness se:

```text
[ ] license verified
[ ] provenance verified
[ ] AgentRuntime contracts pass
[ ] plugin security pass
[ ] context security pass
[ ] model adapter pass
[ ] differential eval pass
[ ] shadow pass
[ ] load pass
[ ] chaos pass
[ ] recovery pass
```

---

# 240. TRIPLO AAA GATE

Somente permitir:

```text
TRIPLE_AAA_CANDIDATE
```

quando:

```text
[ ] all mandatory dimensions meet threshold
[ ] zero unresolved CRITICAL
[ ] zero unresolved HIGH
[ ] no mandatory PARTIAL
[ ] no mandatory NOT_RUN
[ ] no mandatory BLOCKED
[ ] same-SHA CI green
[ ] staging verified
[ ] real model verified
[ ] provider vertical verified
[ ] load verified
[ ] chaos verified
[ ] recovery verified
[ ] observability verified
[ ] critics approved
[ ] required human approvals present
```

---

# 241. VERIFY:TRIPLO-AAA

Fortalecer o comando existente:

```bash
npm run verify:triplo-aaa
```

Ele deve falhar se qualquer evidência obrigatória faltar.

Resultado:

```text
AAA_NOT_PROVEN
```

Exit code não zero.

---

# 242. VERIFY:EMBEDDED-HARNESS

Criar:

```bash
npm run verify:embedded-harness
```

Executar:

```text
license
provenance
kernel
context
session
plugins
skills
tools
model adapters
replay
budgets
approvals
security
```

---

# 243. VERIFY:AGENT-SECURITY

Criar:

```bash
npm run verify:agent-security
```

Cobrir ataques específicos do runtime incorporado.

---

# 244. VERIFY:AGENT-EVALS

Criar:

```bash
npm run verify:agent-evals
```

Executar golden dataset sintético.

# 245. VERIFY:AI-DISABLED

Criar:

```bash
npm run verify:ai-disabled
```

Provar continuidade operacional com o runtime de IA desabilitado.

---

# 246. VERIFY:AGENT-RUNTIME-SMOKE

Criar o smoke do runtime de agentes já descrito no item 193.

---

# 247. VERIFY:STATE-OF-ART

Criar:

```bash
npm run verify:state-of-art
```

Composição mínima no item 493.

---

# 248. VERIFY:STATE-OF-ART-EXTERNAL

Criar:

```bash
npm run verify:state-of-art-external
```

Somente quando autorizado (item 494).

---

# 249. VERIFY:DOCS-PROVENANCE

Criar:

```bash
npm run verify:docs-provenance
```

Validar candidate SHA, scorecard SHA, evidence SHA, README e manifest.

---

# 250. VERIFY:CLAIMS

Criar:

```bash
npm run verify:claims
```

Detector de overclaim documental (item 417).

---

# 251. CI — GATES DO AGENT RUNTIME

Adicionar ao CI os gates `verify:agent-runtime`, `verify:embedded-harness`,
`verify:agent-security`, `verify:plugins`, `verify:skills`, `verify:agent-evals`
e `verify:ai-disabled` no mesmo SHA.

---

# 252. CI — SBOM E SUPPLY CHAIN

Atualizar o SBOM para distinguir código CVG, código incorporado do Harness e
dependências npm/runtime.

---

# 253. CI — PINNING

Garantir GitHub Actions pinadas por SHA, bases de container pinadas por digest e
lockfile íntegro.

---

# 254. RUNBOOK — AGENT RUNTIME DOWN

Criar procedimento operacional para indisponibilidade do Agent Runtime.

---

# 255. RUNBOOK — MODEL PROVIDER DOWN

Criar procedimento operacional para indisponibilidade do provider de modelo.

---

# 256. RUNBOOK — PLUGIN FAILURE

Criar procedimento operacional para falha de plugin.

---

# 257. RUNBOOK — SESSION STUCK

Criar procedimento operacional para sessão travada.

---

# 258. RUNBOOK — AGENT LOOP RUNAWAY

Criar procedimento operacional para loop descontrolado.

---

# 259. RUNBOOK — PROMPT INJECTION INCIDENT

Criar procedimento operacional para incidente de prompt injection.

---

# 260. RUNBOOK — AGENT RUNTIME ROLLBACK

Criar procedimento de rollback do runtime de agentes.

---

# 261. RUNBOOK — EMBEDDED HARNESS UPGRADE

Criar procedimento de upgrade do harness incorporado.

---

# 262. THREAT MODEL

Criar:

```text
docs/agent-runtime-threat-model.md
```

---

# 263. SECURITY REVIEW

Criar:

```text
docs/agent-runtime-security-review.md
```

---

# 264. RED TEAM DOC

Criar:

```text
docs/agent-runtime-red-team.md
```

---

# 265. DATA FLOW DOC

Criar:

```text
docs/agent-runtime-data-flow.md
```

---

# 266. SECURITY TRACEABILITY MATRIX

Criar:

```text
docs/security-traceability-matrix.md
```

---

# 267. ARCHITECTURE FINAL

Criar:

```text
docs/architecture-final.md
```

---

# 268. ROLLOUT DOC

Criar:

```text
docs/embedded-runtime-rollout.md
```

---

# 269. VERIFICATION DOC

Criar:

```text
docs/embedded-harness-verification.md
```

---

# 270. AGENT EVALS DOC

Criar:

```text
docs/agent-evals.md
```

---

# 271. EMBEDDED VS EXTERNAL COMPARISON DOC

Criar:

```text
docs/embedded-vs-external-comparison.md
```

---

# 272. FINAL STATE OF ART SCORECARD DOC

Criar:

```text
docs/final-state-of-art-scorecard.md
```

---

# 273. TRIPLE AAA FINAL SCORECARD DOC

Criar:

```text
docs/triple-aaa-final-scorecard.md
```

---

# 274. FINAL REPORT DOC

Criar:

```text
docs/final-triplo-aaa-report.md
```

---

# 275. FINAL ARCHITECTURE LAWS

Documentar as leis arquiteturais (itens 402–408) no documento final.

---

# 276. CURRENT STATE MANIFEST

Manter:

```text
artifacts/quality/current-state.json
```

com `subjectSha`, `engineeringState`, `productionState`, `aaaState`, `blockers`,
`lastVerification`.

---

# 277. README STATUS AUTOMATION

README deve derivar o status do manifest machine-readable quando possível.

---

# 278. OVERCLAIM DETECTOR

Detectar frases de overclaim sem manifest correspondente.

---

# 279. DOC CONSISTENCY GATE

Corrigir documentos stale apontando para SHA antigo.

---

# 280. HISTORICAL EVIDENCE

Evidência antiga identificada como `HISTORICAL`.

---

# 281. CURRENT EVIDENCE

Somente `CURRENT` se `subjectSha == candidateSha`.

---

# 282. DOCUMENTATION VERSIONING

Documentos operacionais devem declarar `subject SHA`, data e status.

---

# 283. RELEASE NOTES

Changelog separando produto, segurança, agent runtime, database e operations.

---

# 284. MIGRATION RELEASE NOTES

Mudanças de DB devem listar migration IDs, compatibilidade, downtime, forward-fix.

---

# 285. EMBEDDED HARNESS RELEASE NOTES

Registrar upstream commit, adaptações CVG, mudanças de comportamento, plugin API e
model adapter changes.

---

# 286. SEMANTIC VERSIONING POLICY

Definir política para CVG product, AgentRuntime contract, Plugin API e Skill schema.

---

# 287. COMPATIBILITY MATRIX

Criar matriz de compatibilidade (item 56).

---

# 288. RUNTIME MANIFEST

Gerar manifest determinístico (item 57).

---

# 289. CHECKPOINT SCHEMA VERSION

Todo checkpoint declara versão.

---

# 290. CHECKPOINT MIGRATION

Upcaster explícito quando suportado.

---

# 291. CHECKPOINT TAMPER

Alteração de checkpoint detectável.

---

# 292. SESSION FENCING TEST

Teste adversarial de fencing (item 442).

---

# 293. TOOL FENCING

Fencing em operações assíncronas críticas.

---

# 294. APPROVAL FENCING

Approval vinculada ao request/turn correto.

---

# 295. CORRELATION INTEGRITY

Correlation ID não aceito cegamente do modelo.

---

# 296. MODEL-GENERATED IDS

IDs gerados pelo LLM não são confiáveis para resources críticos.

---

# 297. RESOURCE LOOKUP

Tool resolve resource authoritative pelo ID validado.

---

# 298. CONFUSED DEPUTY DEFENSE

PDP bloqueia capability autorizada usada fora do escopo.

---

# 299. PURPOSE BINDING

Autorização considera `purpose` (item 449).

---

# 300. PURPOSE PROPAGATION

Propagar purpose do request ao audit (item 450).

---

# 301. PURPOSE CHANGE

Mudança de finalidade exige reavaliação.

---

# 302. DATA MINIMIZATION TESTS

Testes garantindo que agents não recebam campos desnecessários.

---

# 303. CONTEXT SNAPSHOT TEST

Fixture do Context Builder mostra categorias incluídas sem expor conteúdo real.

---

# 304. CONTEXT POLICY DIFF

Mudança de política de contexto produz diff revisável.

---

# 305. PROMPT TEMPLATE VERSION

System/profile prompts possuem versão/digest.

---

# 306. PROMPT CHANGE EVAL

Alteração de prompt dispara evals.

---

# 307. PROMPT ROLLBACK

Rollback para versão aprovada anterior.

---

# 308. NO LIVE PROMPT EDIT

Sem edição ad hoc de prompt em produção.

---

# 309. KNOWLEDGE CHANGE EVAL

Mudanças críticas de knowledge base disparam evals.

---

# 310. RETRIEVAL INDEX VERSION

Registrar versão/digest do corpus/index.

---

# 311. RETRIEVAL REPRODUCIBILITY

Replay registra referências retornadas.

---

# 312. MODEL NONDETERMINISM

Não alegar replay bit-a-bit sem garantia do provider.

---

# 313. DETERMINISTIC CONTROL PLANE

Policy, autorização, approval, budget, tool validation e effect ledger
permanecem determinísticos.

---

# 314. MODEL CANNOT OVERRIDE STOP

Modelo não continua loop após STOP determinado pelo runtime.

---

# 315. TOOL CANNOT EXTEND BUDGET

Tool não aumenta budget.

---

# 316. PLUGIN CANNOT GRANT CAPABILITY

Plugin só usa capabilities concedidas.

---

# 317. SKILL CANNOT ENABLE TOOL

Skill declara requirement, não concede.

---

# 318. RETRIEVAL CANNOT ENABLE TOOL

Mesmo princípio.

---

# 319. MODEL CANNOT SELECT SECRET

Modelo solicita ação lógica, não escolhe secret reference.

---

# 320. PROVIDER CONFIGURATION AUTHORITY

Config do provider é operacional/admin.

---

# 321. FINAL SECURITY INVARIANTS

Transformar em testes:

```text
AI cannot bypass PDP
AI cannot bypass Tool Gateway
AI cannot access DB directly
AI cannot read secrets
AI cannot self-approve
AI cannot create domain truth directly
AI cannot bypass idempotency
AI cannot bypass audit
AI cannot cross tenant
```

---

# 322. FINAL RELIABILITY INVARIANTS

Testar:

```text
no duplicate external effect
no stale fence commit
no lost authoritative audit
no blind retry after unknown outcome
no corrupted session resume
```

---

# 323. FINAL ARCHITECTURE INVARIANTS

```text
Domain does not depend on AgentRuntime
Domain does not depend on DeepSeek
Application does not depend on provider-specific internals
```

---

# 324. FINAL MODEL INVARIANT

Provar troca de DeepSeek por Mock/Local adapter sem alterar Domain.

---

# 325. FINAL HARNESS INVARIANT

Provar troca de Embedded Harness por adapter external sem alterar domínio/tools/policies.

---

# 326. FINAL TOOL INVARIANT

Mesma Tool Gateway para todos os runtimes.

---

# 327. FINAL POLICY INVARIANT

Mesmo PDP para todos os runtimes.

---

# 328. FINAL DATA INVARIANT

Mesmo PostgreSQL/domain authority independentemente do runtime de IA.

---

# 329. STATE OF ART LOCAL CLOSURE

Permitir `LOCAL_STATE_OF_THE_ART_CANDIDATE` quando todos os gates locais estiverem verdes.

---

# 330. EXTERNAL CLOSURE

Fechar DeepSeek real, provider real, staging, observability, load, chaos, recovery, CI same-SHA.

---

# 331. INDEPENDENT CLOSURE

Fresh critics + signed evidence + human approvals.

# 332. APPROVAL UI

A interface de aprovação deve mostrar explicitamente:

```text
operation
tool
target
resource
organization
unit/workspace
effect
risk
request digest
expiration
```

O usuário não deve aprovar uma ação cujo efeito esteja escondido.

---

# 333. APPROVAL PREVIEW

Antes da aprovação, quando tecnicamente possível:

```text
Agent proposal
      ↓
Effect Preview
      ↓
Human Approval
      ↓
Execution
```

Exemplo:

```text
Enviar mensagem
Destino: tutor do paciente Bob
Canal: WhatsApp
Conteúdo: [...]
```

---

# 334. APPROVAL BINDING

Após aprovação, qualquer alteração em:

```text
tool
arguments
target
scope
content
policy revision
```

invalida a aprovação.

Novo digest:

```text
→ new approval required
```

---

# 335. APPROVAL RACE

Testar approval granted → resource changes → execution attempted.

Quando a mudança afetar segurança/semântica:

```text
REVALIDATE
```

---

# 336. STALE APPROVAL

Approval vencida:

```text
DENIED
```

Nunca renovar silenciosamente.

---

# 337. ONE-SHOT APPROVAL

Aprovação de efeito crítico:

```text
used once
↓
CONSUMED
```

Replay:

```text
DENIED
```

---

# 338. APPROVAL AUDIT

Registrar:

```text
requestedBy
approvedBy
requestDigest
policyRevision
createdAt
approvedAt
consumedAt
result
```

---

# 339. AGENT UX — CONFIDENCE

Não inventar porcentagem de confiança sem metodologia calibrada.

Preferir estados úteis:

```text
READY
NEEDS_REVIEW
MISSING_INFORMATION
POLICY_BLOCKED
DEPENDENCY_UNAVAILABLE
```

---

# 340. MISSING INFORMATION

Quando contexto obrigatório faltar:

```text
do not guess
```

Retornar:

```text
MISSING_INFORMATION
```

com os campos necessários.

---

# 341. CLINICAL UNCERTAINTY

Em fluxos clínicos, diferenciar:

```text
recorded fact
retrieved reference
model-generated suggestion
```

---

# 342. AI OUTPUT LABELING

UI deve deixar claro quando algo é:

```text
AI_GENERATED_DRAFT
```

---

# 343. HUMAN EDIT PROVENANCE

Se humano editar draft, registrar AI draft digest, human final digest, reviewer, timestamp.

---

# 344. PROMOTION TO AUTHORITATIVE STATE

Somente application/domain layer promove um draft.

---

# 345. AGENT NOTIFICATION POLICY

Deduplication, cooldown, prioridade, notification budget.

---

# 346. ALERT ≠ AGENT MESSAGE

Separar alerta operacional, lembrete clínico, sugestão de agente e notificação de usuário.

---

# 347. REMINDER ENGINE

Lembretes determinísticos continuam no scheduler.

---

# 348. EVENT-TO-AGENT ADMISSION

Nem todo evento deve chamar LLM.

---

# 349. AI COST CONTROL

Medir custo por agente, workflow, organização e task type.

---

# 350. COST ANOMALY

Alertar para token spike, retries repetidos e sessões runaway.

---

# 351. TOKEN BUDGET BY AGENT

Budgets diferentes por profile, baseados em medição.

---

# 352. CONTEXT SIZE LIMIT

Limite operacional menor quando apropriado.

---

# 353. TOOL DESCRIPTION BUDGET

Dynamic Tool Exposure para reduzir overhead.

---

# 354. AGENT LATENCY BREAKDOWN

Dashboard separa queue, context build, retrieval, model, tool, approval.

---

# 355. PERFORMANCE ROOT CAUSE

Instrumentar para descobrir a camada responsável.

---

# 356. EMBEDDED VS EXTERNAL BENCHMARK

Comparar runtime overhead, latência, memória, failure rate, operabilidade.

---

# 357. EMBEDDING DECISION SCORECARD

| Critério        | External | Embedded | Hybrid |
| --------------- | -------: | -------: | -----: |
| Latência        |          |          |        |
| Segurança       |          |          |        |
| Blast radius    |          |          |        |
| Atualização     |          |          |        |
| Debug           |          |          |        |
| Operação        |          |          |        |
| Portabilidade   |          |          |        |
| Licença         |          |          |        |
| Testabilidade   |          |          |        |
| Vendor coupling |          |          |        |

Não escolher vencedor por soma simplista. Registrar trade-offs.

---

# 358. ADR FINAL DE EMBEDDING

Criar:

```text
docs/adr/ADR-agent-runtime-embedding-decision.md
```

Resultado permitido:

```text
EMBED
HYBRID
KEEP_EXTERNAL
```

---

# 359. NÃO FORÇAR EMBEDDING

Se a auditoria demonstrar que incorporar o Harness aumenta significativamente
security risk, maintenance burden, license risk, upgrade burden ou blast radius,
não incorporar só porque o prompt mencionou a hipótese.

---

# 360. REUSE THE IDEAS, NOT NECESSARILY THE FILES

Se copiar código upstream for pior, reimplementar os conceitos sob contratos CVG.

---

# 361. MINIMUM EMBEDDING PRINCIPLE

Incorporar o mínimo necessário.

---

# 362. REMOVE DEAD HARNESS CODE

Nenhum código incorporado sem função real.

---

# 363. CODE SIZE BUDGET

State of Art = minimum sufficient complexity.

---

# 364. COMPLEXITY AUDIT

Identificar abstrações duplicadas, adapters redundantes, camadas mortas.

---

# 365. LEGACY EXTERNAL BRIDGE

Manter bridge antigo isolado; decidir depois de estabilidade.

---

# 366. FEATURE PARITY

Embedded demonstra paridade mínima antes de primary: session, turn, tool calls,
approval, replay, budget, provenance, cancellation, timeout, health.

---

# 367. SECURITY PARITY

PDP, Tool Gateway, RLS, approval, audit e data minimization não podem regredir.

---

# 368. FAILURE PARITY

Embedded deve ser fail-closed equivalente ou superior.

---

# 369. OBSERVABILITY PARITY

Telemetria suficiente para operação.

---

# 370. RECOVERY PARITY

Checkpoint/resume comprovado.

---

# 371. PRODUCTION ROLLOUT PLAN

Gerar `docs/embedded-runtime-rollout.md` com fases LAB, SHADOW, STAGING, CANARY,
PRODUCTION.

---

# 372. LAB

Somente dados sintéticos, fixture models, sandbox providers.

---

# 373. SHADOW

Dados apenas se autorizados. Sem efeitos.

---

# 374. STAGING

Topologia production-like. Sem dados reais salvo autorização.

---

# 375. CANARY

Usuários/workflows selecionados. Observação reforçada.

---

# 376. PRODUCTION

Somente após todos os gates.

---

# 377. ROLLOUT HALT

CRITICAL, security regression, duplicate effect ou data corruption interrompe rollout.

---

# 378. RELEASE FREEZE

Durante certificação final, evitar mudanças não relacionadas. Nova alteração gera
novo SHA e invalida same-SHA evidence.

---

# 379. CANDIDATE SHA

Escolher candidate SHA apenas depois de fechar código local.

---

# 380. EVIDENCE SNAPSHOT

Snapshot ligado ao candidate SHA.

---

# 381. CI CANDIDATE

CI executa exatamente no candidate SHA.

---

# 382. STAGING CANDIDATE

Staging recebe artifact do mesmo candidate SHA.

---

# 383. NO STAGING REBUILD

Deploy por digest.

---

# 384. EXTERNAL EVIDENCE BUNDLE

Gerar fora do checkout: CI, staging, DeepSeek, provider, load, chaos, recovery,
observability, critics, human approval.

---

# 385. EVIDENCE DIGESTS

Cada artifact precisa de digest.

---

# 386. EVIDENCE MANIFEST

Manifest raiz ligando todos os digests.

---

# 387. EVIDENCE IMMUTABILITY

Bundle final read-only, sem symlinks, same SHA.

---

# 388. INDEPENDENT REVIEW SIGNATURE

Reviewer independente assina receipt/bundle quando a infraestrutura permitir.

---

# 389. HUMAN APPROVAL

Não fabricar. Se ausente: `HUMAN_APPROVAL_MISSING`.

---

# 390. AAA VERIFIER INPUT

`verify:triplo-aaa` recebe somente evidence bundle explícito.

---

# 391. AAA VERIFIER FAIL-CLOSED

Qualquer missing evidence, wrong SHA, invalid signature, stale evidence, failed
gate ou critical finding → `AAA_NOT_PROVEN`.

---

# 392. STATE-OF-ART VERIFIER

Criar `npm run verify:state-of-art` separando maturidade de engenharia de
certificação AAA de produção.

---

# 393. ENGINEERING SCORECARD

Rotular `LOCAL_ENGINEERING_EVIDENCE`.

---

# 394. PRODUCTION SCORECARD

Somente evidência production-like.

---

# 395. DOCUMENTATION CONSISTENCY GATE

Criar `npm run verify:docs-provenance`.

---

# 396. NO STALE SCORECARD

Scorecard não pode afirmar HEAD = old SHA.

---

# 397. HISTORICAL EVIDENCE

Evidência antiga permanece `HISTORICAL`.

---

# 398. CURRENT EVIDENCE

Somente `CURRENT` se `subjectSha == candidateSha`.

---

# 399. DOCUMENTATION VERSIONING

Docs operacionais declaram subject SHA, data e status.

---

# 400. FINAL ARCHITECTURE DOCUMENT

Criar `docs/architecture-final.md` (item 267).

---

# 401. FINAL DIAGRAM

Documentar o diagrama final de arquitetura.

---

# 402. KEY ARCHITECTURAL LAW

> The AI runtime may reason about the CVG domain, but it never becomes the authority of the CVG domain.

---

# 403. SECOND ARCHITECTURAL LAW

> All side effects requested by AI must cross the same governed application boundaries used by non-AI callers.

---

# 404. THIRD ARCHITECTURAL LAW

> Model providers are replaceable infrastructure. They are not the agent architecture.

---

# 405. FOURTH ARCHITECTURAL LAW

> Skills provide knowledge and procedure; plugins provide executable capability; tools provide governed domain actions.

---

# 406. FIFTH ARCHITECTURAL LAW

> Retrieval contributes context. It does not grant authority.

---

# 407. SIXTH ARCHITECTURAL LAW

> Human approval is an external authority and can never be synthesized by the model.

---

# 408. SEVENTH ARCHITECTURAL LAW

> Failure of AI must degrade AI capabilities, not corrupt or disable the core hospital system.

---

# 409. FINAL TEST MATRIX

```text
Unit
Integration
Contract
Database
RLS
Security
Authorization
Agent Runtime
Context
Plugin
Skill
Model Adapter
Worker
Fault
E2E
Accessibility
Load
Chaos
Recovery
Supply Chain
```

---

# 410. REQUIRED LOCAL GATES

No mínimo:

```bash
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:security
npm run test:database
npm run test:fault
npm run build
npm run verify:static
npm run verify:pdp-universal
npm run verify:authoritative-writes
npm run verify:audit-chain
npm run verify:worker-runtime
npm run verify:architecture
npm run verify:agent-runtime
npm run verify:embedded-harness
npm run verify:agent-security
npm run verify:plugins
npm run verify:skills
npm run verify:agent-evals
npm run verify:production
```

---

# 411. EXTERNAL GATES

```bash
npm run verify:embedded-deepseek
npm run verify:provider-real
npm run verify:staging
npm run verify:load
npm run verify:chaos
npm run verify:recovery-production
npm run verify:observability
```

---

# 412. BLOCKED EXTERNAL

Se credenciais/infra não existirem: retornar `BLOCKED_EXTERNAL` e continuar com o
máximo de fechamento local possível.

---

# 413. NO FAKE EXTERNAL PROOF

Loopback não é provider externo. Mock não é DeepSeek real. Local PostgreSQL não é
staging. Compose renderizado não é container executado. Alert rule criada não é
alerta entregue. Backup criado não é recovery comprovado. Teste sintético não é
produção. Documentação não é evidência operacional.

---

# 414. EVIDENCE CLASSIFICATION

```text
STATIC
UNIT
INTEGRATION
SYNTHETIC
LOCAL_REAL
STAGING
PRODUCTION_LIKE
EXTERNAL_REAL
HUMAN_APPROVED
```

---

# 415. EVIDENCE HIERARCHY

STATIC → UNIT → INTEGRATION → SYNTHETIC → LOCAL_REAL → STAGING → PRODUCTION_LIKE → EXTERNAL_REAL.

---

# 416. CLAIM/EVIDENCE MATCHING

Cada claim declara a força mínima de evidence exigida.

---

# 417. OVERCLAIM DETECTOR

Detectar frases como production ready, AAA, verified in production, external
provider verified quando os manifests não existirem. Integrado a `verify:claims`.

---

# 418. README STATUS AUTOMATION

Status do README deriva de manifest machine-readable.

---

# 419. SINGLE SOURCE OF QUALITY STATE

```text
artifacts/quality/current-state.json
```

Campos: subjectSha, engineeringState, productionState, aaaState, blockers,
lastVerification.

---

# 420. NO MULTIPLE COMPETING SCORECARDS

Apenas um scorecard canônico de promoção.

---

# 421. HISTORICAL DIRECTORY

Mover snapshots antigos para `docs/history/` e `artifacts/history/` quando apropriado.

---

# 422. CURRENT POINTER

Pointer explícito: current candidate, current scorecard, current evidence manifest.

---

# 423. CANDIDATE INVALIDATION

Alteração de código após candidate selection invalida o candidate.

---

# 424. DOC-ONLY CHANGE POLICY

Definir quais alterações documentais invalidam ou não o candidate.

---

# 425. SECURITY DOC CHANGES

Mudanças em policy, runbook, approval contract e security config disparam gates.

---

# 426. RELEASE BRANCH POLICY

Avaliar branch/tag protegida sem burocracia desnecessária.

---

# 427. RELEASE TAG

`cvg-corp-vX.Y.Z` apontando exatamente para o candidate SHA.

---

# 428. SEMANTIC VERSIONING

Política para CVG product, AgentRuntime contract, Plugin API e Skill schema.

---

# 429. CHANGELOG

Changelog útil separando produto, segurança, agent runtime, database e operations.

---

# 430. MIGRATION RELEASE NOTES

Mudanças de DB listam migration IDs, compatibilidade, downtime e forward-fix.

---

# 431. EMBEDDED HARNESS RELEASE NOTES

Registrar upstream commit, adaptações CVG, mudanças de comportamento, plugin API e
model adapter changes.

---

# 432. UPGRADE RUNBOOK

`docs/runbooks/embedded-harness-upgrade.md`.

---

# 433. DOWNGRADE RUNBOOK

Rollback para versão anterior do Agent Runtime.

---

# 434. DATABASE COMPATIBILITY WINDOW

Compatibilidade entre versões coexistentes durante rollout.

---

# 435. RUNTIME VERSION SKEW

Testar Runtime N e N+1 simultaneamente.

---

# 436. PLUGIN VERSION SKEW

Plugin incompatível não carrega.

---

# 437. MODEL ADAPTER VERSION SKEW

Mesmo princípio.

---

# 438. SESSION UPGRADE POLICY

Sessão iniciada em Runtime N e retomada em N+1: compatível ou explicitamente rejeitada/quarentenada.

---

# 439. CHECKPOINT SCHEMA VERSION

Checkpoint declara versão.

---

# 440. CHECKPOINT MIGRATION

Upcaster explícito.

---

# 441. CHECKPOINT TAMPER

Alteração detectável via digest/ledger.

---

# 442. SESSION FENCING TEST

Runtime A owns fence 10, Runtime B takes fence 11, Runtime A attempts commit →
`DENIED_STALE_FENCE`.

---

# 443. TOOL FENCING

Operações assíncronas críticas vinculam fencing.

---

# 444. APPROVAL FENCING

Approval vinculada ao request/turn correto.

---

# 445. CORRELATION INTEGRITY

Correlation ID não aceito cegamente do modelo.

---

# 446. MODEL-GENERATED IDS

IDs do LLM não confiáveis para resources críticos.

---

# 447. RESOURCE LOOKUP

Tool resolve resource authoritative pelo ID validado.

---

# 448. CONFUSED DEPUTY DEFENSE

PDP bloqueia capability fora do escopo.

---

# 449. PURPOSE BINDING

`clinical care` não implica `marketing export`.

---

# 450. PURPOSE PROPAGATION

User request → Agent session → Tool request → PDP → Audit.

---

# 451. PURPOSE CHANGE

Mudança de finalidade exige reavaliação.

---

# 452. DATA MINIMIZATION TESTS

Agents não recebem campos desnecessários.

---

# 453. CONTEXT SNAPSHOT TEST

Fixture mostra categorias sem conteúdo sensível real.

---

# 454. CONTEXT POLICY DIFF

Mudança de política de contexto produz diff revisável.

---

# 455. PROMPT TEMPLATE VERSION

Prompts possuem versão/digest.

---

# 456. PROMPT CHANGE EVAL

Alteração de prompt dispara evals.

---

# 457. PROMPT ROLLBACK

Rollback para versão aprovada anterior.

---

# 458. NO LIVE PROMPT EDIT IN PRODUCTION

Sem edição ad hoc sem audit/promotion.

---

# 459. KNOWLEDGE CHANGE EVAL

Mudanças críticas de knowledge disparam evals.

---

# 460. RETRIEVAL INDEX VERSION

Registrar versão/digest do corpus/index.

---

# 461. RETRIEVAL REPRODUCIBILITY

Replay registra referências retornadas.

---

# 462. MODEL NONDETERMINISM

Não alegar replay bit-a-bit sem garantia.

---

# 463. DETERMINISTIC CONTROL PLANE

Policy, authorization, approval, budget, tool validation e effect ledger
permanecem determinísticos.

---

# 464. MODEL CANNOT OVERRIDE STOP

Modelo não continua após STOP.

---

# 465. TOOL CANNOT EXTEND BUDGET

Tool não aumenta budget.

---

# 466. PLUGIN CANNOT GRANT CAPABILITY

Plugin só usa capabilities concedidas.

---

# 467. SKILL CANNOT ENABLE TOOL

Skill declara requirement.

---

# 468. RETRIEVAL CANNOT ENABLE TOOL

Mesmo princípio.

---

# 469. MODEL CANNOT SELECT SECRET

Modelo não escolhe secret reference arbitrária.

---

# 470. PROVIDER CONFIGURATION AUTHORITY

Config do provider é operacional/admin.

---

# 471. FINAL SECURITY INVARIANTS

AI cannot bypass PDP / Tool Gateway / DB direct / secrets / self-approve /
domain truth / idempotency / audit / tenant.

---

# 472. FINAL RELIABILITY INVARIANTS

no duplicate external effect / no stale fence commit / no lost authoritative
audit / no blind retry after unknown outcome / no corrupted session resume.

---

# 473. FINAL ARCHITECTURE INVARIANTS

Domain does not depend on AgentRuntime / DeepSeek; Application does not depend on
provider-specific internals.

---

# 474. FINAL MODEL INVARIANT

Trocar DeepSeek por Mock/Local sem alterar Domain.

---

# 475. FINAL HARNESS INVARIANT

Trocar Embedded por external adapter sem alterar domínio/tools/policies.

---

# 476. FINAL TOOL INVARIANT

Mesma Tool Gateway para todos os runtimes.

---

# 477. FINAL POLICY INVARIANT

Mesmo PDP para todos os runtimes.

---

# 478. FINAL DATA INVARIANT

Mesmo PostgreSQL/domain authority.

---

# 479. STATE OF ART LOCAL CLOSURE

`LOCAL_STATE_OF_THE_ART_CANDIDATE` quando todos os gates locais estiverem verdes.

---

# 480. EXTERNAL CLOSURE

DeepSeek real, provider real, staging, observability, load, chaos, recovery, CI
same-SHA.

---

# 481. INDEPENDENT CLOSURE

Fresh critics + signed evidence + human approvals.

---

# 482. FINAL AAA DECISION

Somente emitir `TRIPLE_AAA_CANDIDATE`; nunca `TRIPLE_AAA_CERTIFIED` sem autoridade
externa de certificação.

---

# 483. TERMINOLOGY

Usar Candidate, Verified e Proven com precisão. Não usar “certified” sem entidade
certificadora.

---

# 484. FINAL DELIVERABLES — ARCHITECTURE

```text
docs/embedded-harness-audit.md
docs/architecture-final.md
docs/agent-runtime-data-flow.md
docs/security-traceability-matrix.md
docs/embedded-runtime-rollout.md
docs/third-party/deepseek-harness-provenance.md
docs/third-party/deepseek-harness-upstream.md
```

---

# 485. FINAL DELIVERABLES — ADR

```text
docs/adr/ADR-agent-runtime-embedding-decision.md
docs/adr/ADR-agent-runtime-process-boundary.md
docs/adr/ADR-model-provider-boundary.md
docs/adr/ADR-plugin-security-model.md
docs/adr/ADR-agent-session-persistence.md
```

---

# 486. FINAL DELIVERABLES — SECURITY

```text
docs/agent-runtime-threat-model.md
docs/agent-runtime-security-review.md
docs/agent-runtime-red-team.md
```

---

# 487. FINAL DELIVERABLES — OPERATIONS

```text
docs/runbooks/agent-runtime-down.md
docs/runbooks/model-provider-down.md
docs/runbooks/plugin-failure.md
docs/runbooks/session-stuck.md
docs/runbooks/agent-loop-runaway.md
docs/runbooks/prompt-injection-incident.md
docs/runbooks/agent-runtime-rollback.md
docs/runbooks/embedded-harness-upgrade.md
```

---

# 488. FINAL DELIVERABLES — VERIFICATION

```text
docs/embedded-harness-verification.md
docs/agent-evals.md
docs/embedded-vs-external-comparison.md
docs/final-state-of-art-scorecard.md
docs/triple-aaa-final-scorecard.md
```

---

# 489. FINAL DELIVERABLES — MACHINE READABLE

```text
artifacts/quality/current-state.json
artifacts/release-provenance.json
artifacts/evals/
artifacts/operational-proof/
```

Não versionar secrets.

---

# 490. README

Atualizar README explicando: o que é o CVG-Corp, o que é o Embedded Harness, o que
é o DeepSeek, o que é o AgentRuntime, como tools são governadas, como rodar dev,
como verificar, status de qualidade atual e blockers atuais.

---

# 491. README ARCHITECTURE SUMMARY

> CVG-Corp owns the business domain and security authority. The embedded agent runtime provides cognitive orchestration. DeepSeek is a replaceable model provider.

---

# 492. FINAL COMMAND MATRIX

```bash
npm run verify:architecture
npm run verify:agent-runtime
npm run verify:embedded-harness
npm run verify:agent-security
npm run verify:plugins
npm run verify:skills
npm run verify:agent-evals
npm run verify:pdp-universal
npm run verify:authoritative-writes
npm run verify:audit-chain
npm run verify:worker-runtime
npm run verify:postgres:concurrency
npm run verify:production
npm run verify:state-of-art
npm run verify:triplo-aaa
```

---

# 493. FINAL FULL LOCAL GATE

`npm run verify:state-of-art` com composição mínima: lint, typecheck, unit,
integration, contract, security, database, fault, architecture, AgentRuntime,
Embedded Harness, Context Builder, plugins, skills, agent security, agent evals,
PDP, authoritative writes, audit chain, worker, build, static, E2E supported,
accessibility supported, dependency audit, SBOM, production structural verification.

---

# 494. FINAL EXTERNAL GATE

`npm run verify:state-of-art-external` somente quando autorizado. Inclui DeepSeek
real, provider real, staging, load, chaos, recovery, observability.

---

# 495. FINAL AAA GATE

`verify:triplo-aaa` depende de local state-of-art + external state-of-art +
same-SHA CI + critics + human approvals.

---

# 496. PRIORIDADE DE IMPLEMENTAÇÃO

NÃO implementar os 495 itens simultaneamente. Executar em macrofases.

## MACROFASE A — DISCOVERY

```text
Harness audit
license
component classification
architecture decision
```

Nenhuma incorporação antes disso.

---

# 497. MACROFASE B — KERNEL

Implementar/adaptar: AgentRuntime, Agent Kernel, Agent Loop, Context Builder,
Session, ModelProvider.

---

# 498. MACROFASE C — GOVERNANCE INTEGRATION

Integrar o novo runtime com as autoridades já existentes do CVG: PDP, Tool
Gateway, Approval Engine, Budget Engine, Audit Ledger, Effect Ledger, Usage Ledger.

Regra:

```text
Embedded Harness
      ↓
CVG Governance
```

Nunca criar uma segunda governança paralela dentro do Harness.

---

# 499. MACROFASE D — PLUGINS / SKILLS

Somente depois do Kernel estar estável: Plugin Runtime, Skill Runtime, manifest,
digest, capabilities, permissions, lifecycle, versioning.

Não bloquear o Kernel esperando um sistema de plugins sofisticado.

---

# 500. MACROFASE E — PERSISTÊNCIA DO RUNTIME

AgentSessionStore, Turn Ledger, Checkpoint, Lease, Fencing, Usage, Provenance.
Usar PostgreSQL com RLS e least privilege quando essa for a decisão aprovada.

---

# 501. MACROFASE F — DEEPSEEK ADAPTER

Somente agora conectar AgentRuntime → ModelProvider → DeepSeekProvider. Isso prova
arquiteturalmente: Harness != DeepSeek.

---

# 502. MACROFASE G — SHADOW MIGRATION

External Harness + Embedded Harness, com Embedded = shadow. Sem side effects.

---

# 503. MACROFASE H — DIFFERENTIAL EVAL

Comparar task completion, tool selection, policy decisions, latency, usage e
failure modes. Corrigir regressões.

---

# 504. MACROFASE I — PRIMARY SWITCH

Somente após aprovação dos gates: Embedded = primary, External = rollback. Não
remover o adapter externo nessa etapa.

---

# 505. MACROFASE J — PRODUCTION PROOF

Staging, real DeepSeek, real provider, multi-instance PostgreSQL, observability,
load, chaos, recovery.

---

# 506. MACROFASE K — FINAL GAUNTLET

Critics independentes. Corrigir CRITICAL/HIGH e reavaliar.

---

# 507. MACROFASE L — PROMOTION CANDIDATE

Congelar CANDIDATE_SHA, gerar artifacts e evidence.

---

# 508. MACROFASE M — TRIPLE AAA GATE

`npm run verify:triplo-aaa` somente depois de todas as fases anteriores.

---

# 509. EXECUTION LOOP

```text
INSPECT
   ↓
PLAN
   ↓
IMPLEMENT
   ↓
FOCUSED TEST
   ↓
FULL REGRESSION
   ↓
CRITIC
   ↓
REPAIR
   ↓
DOCUMENT
   ↓
COMMIT
```

---

# 510. SMALL VERIFIED INCREMENTS

Preferir small verified increment a massive speculative rewrite.

---

# 511. COMMIT DISCIPLINE

Commits coerentes: `feat(agent-runtime): add provider-neutral kernel`,
`feat(context): add governed context builder`, `feat(session): add durable fenced
session store`, `feat(model): add DeepSeek provider adapter`.

---

# 512. NEVER COMMIT BROKEN MAIN INTENTIONALLY

---

# 513. CHECKPOINT AFTER EACH MACROPHASE

Produzir implemented, verified, remaining, blocked, risks, next.

---

# 514. CONTROL PLANE

Atualizar `.agent/` e `.gauntlet/` conforme convenções reais do projeto.

---

# 515. SINGLE ACTIVE PLAN

Manter um plano ativo canônico.

---

# 516. PLAN STATE

DISCOVERY, DESIGN, BUILD, VERIFY, EXTERNAL_VERIFY, GAUNTLET, PROMOTION, BLOCKED.

---

# 517. BLOCKERS

BLOCKED_CODE, BLOCKED_LICENSE, BLOCKED_INFRA, BLOCKED_EXTERNAL, BLOCKED_HUMAN.

---

# 518. DO NOT STOP ON EXTERNAL BLOCKER

Continuar fechando tudo que não depende dele.

---

# 519. DO NOT LOOP DOCUMENTATION

Não criar dezenas de documentos repetindo o mesmo blocker.

---

# 520. NO BUSYWORK

Cada artifact precisa justificar seu valor.

---

# 521. TEST VALUE

Priorizar testes que protejam domain integrity, authorization, external effects,
recovery e cross-tenant isolation.

---

# 522. COVERAGE

Coverage como sinal, não obsessão.

---

# 523. MUTATION TESTING

Avaliar para PDP, Tool Gateway, approval, idempotency e session fencing.

---

# 524. PROPERTY-BASED TESTING

Considerar para scope isolation, idempotency, fencing e budget accounting.

---

# 525. FUZZING

Avaliar para external callbacks, structured model output, plugin manifests e skill manifests.

---

# 526. SECURITY TEST PRIORITY

authorization, tenant isolation, effect safety, secret safety.

---

# 527. AGENT TEST PRIORITY

tool correctness, policy compliance, stop behavior, context isolation.

---

# 528. UI TEST PRIORITY

Jornadas reais: reception, clinical, hospitalization, diagnostics, communications.

---

# 529. PRODUCT COMPLETENESS

Agent Runtime é subsistema; não interromper evolução normal do ERP.

---

# 530. CORE SYSTEM MUST WORK WITHOUT AI

Gate obrigatório `CVG_AGENT_RUNTIME=disabled`.

---

# 531. AI OPTIONALITY TEST

`npm run verify:ai-disabled` provando auth, patients, appointments, clinical,
hospitalization, stock e finance operacionais.

---

# 532. MODEL OPTIONALITY TEST

Trocar DeepSeekProvider por MockModelProvider sem mudar domínio.

---

# 533. HARNESS OPTIONALITY TEST

Trocar EmbeddedAgentRuntime por ExternalAgentRuntime sem mudar domínio.

---

# 534. PROVIDER OPTIONALITY TEST

MessagingProvider continua adapter independente.

---

# 535. ARCHITECTURAL DECOUPLING SCORE

Provar desacoplamento com dependency graph, contract tests e adapter swaps.

---

# 536. FINAL LOCAL ACCEPTANCE

Todos os gates locais obrigatórios no mesmo SHA.

---

# 537. LOCAL CANDIDATE

`LOCAL_STATE_OF_THE_ART_CANDIDATE` somente então.

---

# 538. EXTERNAL PROOF ORDER

1. staging, 2. DeepSeek, 3. provider, 4. observability, 5. load, 6. chaos,
7. recovery.

---

# 539. STAGING FIRST

Não executar provider real de produção contra ambiente local improvisado.

---

# 540. SYNTHETIC DATA FIRST

External proofs começam com dados sintéticos.

---

# 541. REAL DATA

Somente mediante autorização explícita.

---

# 542. DEEPSEEK PROOF

Registrar endpoint identity, model, runtime, SHA, turn, tool, approval, usage,
provenance, sem expor credencial.

---

# 543. PROVIDER PROOF

Registrar request, receipt, callback, query, reconciliation, audit.

---

# 544. LOAD PROOF

Registrar amostras brutas, não apenas resumo.

---

# 545. CHAOS PROOF

Cada fault: injection, expected behavior, observed behavior, recovery.

---

# 546. RECOVERY PROOF

Registrar tempos observados.

---

# 547. OBSERVABILITY PROOF

Demonstrar trace, metric, alert e runbook para incidente controlado.

---

# 548. SAME-SHA REMOTE CI

CI remoto verde no SHA candidato.

---

# 549. ARTIFACT BUILD

CI produz artifacts por digest.

---

# 550. STAGING DEPLOY

Usar o artifact produzido.

---

# 551. PROMOTION INVARIANT

Revalidar source, CI, artifact, staging e evidence no mesmo candidato.

---

# 552. FINAL CRITICS

Somente depois das provas principais.

---

# 553. CRITIC INDEPENDENCE

Fresh review.

---

# 554. SECURITY CRITIC

threat model, runtime boundaries, plugins, tools, PDP, secrets, tenant isolation.

---

# 555. RELIABILITY CRITIC

leases, fences, idempotency, reconciliation, recovery.

---

# 556. AI CRITIC

context, retrieval, prompt injection, model adapters, tool behavior, evals.

---

# 557. OPERATIONS CRITIC

deploy, rollback, telemetry, alerts, runbooks, backups.

---

# 558. PRODUCT CRITIC

A arquitetura técnica não pode ter deteriorado jornadas reais do hospital.

---

# 559. FINAL REPAIR

Resolver todos os blockers críticos encontrados.

---

# 560. FREEZE CANDIDATE

Após reparo, novo SHA. Evidence anterior deixa de ser evidence final.

---

# 561. FINAL RE-RUN

Reexecutar gates necessários no novo SHA.

---

# 562. FINAL SCORECARD

Somente agora preencher scores machine-readable.

---

# 563. SCORE EVIDENCE

Nenhuma dimensão recebe score sem evidence.

---

# 564. THRESHOLDS

Preservar os thresholds rigorosos existentes; nunca reduzir para passar.

---

# 565. NO MOVING THE GOALPOST

Corrigir sistema, não enfraquecer gate.

---

# 566. AAA RESULT

```text
AAA_NOT_PROVEN
TRIPLE_AAA_CANDIDATE
```

---

# 567. PRODUCTION READY

Separado de architecture quality.

---

# 568. FINAL REPORT

`docs/final-triplo-aaa-report.md` com architecture, implementation, verification,
external proofs, critics, scores, limitations, residual risks, blockers.

---

# 569. FINAL REPORT HONESTY

Se algum external gate faltar, relatar `AAA_NOT_PROVEN`.

---

# 570. FINAL IMPLEMENTATION SUMMARY

What changed / why / what was preserved / rejected / remains external / verified /
blocked.

---

# 571. EMBEDDING DECISION SUMMARY

Responder claramente: embeddamos componentes do DeepSeek Harness? Quais, por quê,
source, adaptações; ou por que não.

---

# 572. TARGET ARCHITECTURE SUMMARY

O resultado desejado, SE embedding for tecnicamente aprovado.

---

# 573. CRITICAL ARCHITECTURAL RESULT

O DeepSeek Harness deixa de ser “the application” e passa a ser “an embedded
cognitive runtime” dentro de uma arquitetura governada pelo CVG.

---

# 574. MODEL RELATIONSHIP

```text
CVG Corp
   │
AgentRuntime
   │
Harness/Kernel
   │
ModelProvider
   │
DeepSeek
```

---

# 575. PLUGIN RELATIONSHIP

```text
Plugin
 ↓
Runtime capability
```

---

# 576. SKILL RELATIONSHIP

```text
Skill
 ↓
Context Builder
 ↓
Agent
```

---

# 577. TOOL RELATIONSHIP

```text
Agent
 ↓
Tool Request
 ↓
Tool Gateway
 ↓
PDP
 ↓
Domain
```

---

# 578. MCP RELATIONSHIP

MCP é integration/tool protocol. Não substitui PDP, Tool Gateway nem domain validation.

---

# 579. RETRIEVAL RELATIONSHIP

Retrieval = knowledge source; Context Builder = context composer; Agent Kernel =
execution engine; Model = reasoning/generation provider.

---

# 580. FINAL DEFINITION OF DONE

```text
Harness audited
+
embedding decision documented
+
license/provenance resolved
+
AgentRuntime architecture closed
+
Agent Kernel implemented/adapted
+
Context Builder governed
+
sessions durable
+
plugins/skills governed
+
ModelProvider separated
+
DeepSeek adapter implemented
+
Tool Gateway/PDP preserved
+
local gates green
+
security/evals green
+
architecture docs consistent
```

---

# 581. FINAL EXTERNAL DEFINITION OF DONE

A prova externa estará concluída quando houver evidência reproduzível de:

```text
real DeepSeek/model execution
+
real authorized provider
+
production-like staging
+
real Secret Authority
+
PostgreSQL multi-instance
+
container execution
+
observability pipeline
+
measured SLOs
+
load testing
+
chaos testing
+
recovery drill
+
observed RTO/RPO
+
same-SHA remote CI
```

Cada evidência deve estar ligada ao candidate SHA.

---

# 582. FINAL INDEPENDENT DEFINITION OF DONE

Fresh architecture critic, fresh security critic, fresh reliability critic, fresh
AI critic, fresh operations critic, fresh production-readiness critic — sem
CRITICAL/HIGH não resolvidos.

---

# 583. FINAL HUMAN DEFINITION OF DONE

Itens que exigem decisão humana continuam bloqueados até decisão real: produção,
residual-risk acceptance, break-glass, real-data authorization, RTO/RPO, SLO.

---

# 584. STATE OF ART DEFINITION

`STATE_OF_THE_ART_CANDIDATE` quando engenharia, arquitetura e verificação técnica
satisfizerem os thresholds definidos, mesmo que a promoção de produção dependa de
gates humanos separados.

---

# 585. TRIPLO AAA DEFINITION

`TRIPLE_AAA_CANDIDATE` exige simultaneamente engineering quality + security +
reliability + external proofs + same-SHA evidence + independent review + required
human decisions.

---

# 586. ABSOLUTE AAA INVARIANTS

Triplo AAA nunca pode ser emitido com CRITICAL/HIGH unresolved, cross-tenant leak,
authorization bypass, PDP bypass, Tool Gateway bypass, duplicate critical external
effect, domain corruption, secret exposure, unverified artifact identity ou
wrong-SHA evidence.

---

# 587. MANDATORY DIMENSIONS

```text
Architecture
Domain Integrity
Security
Authentication
Authorization
PDP
Tool Gateway
Agent Runtime
Embedded Harness
Plugin Security
Skill Governance
Context Governance
Database
Reliability
Workers
DeepSeek Integration
AI Governance
Provider Integration
Frontend
Accessibility
Testing
Observability
Performance
Recovery
DevOps
Supply Chain
Production Readiness
```

---

# 588. SCORE THRESHOLDS

Preservar os thresholds rigorosos já definidos pelo projeto. Referência de
intenção: dimensões críticas de engenharia >= 97, dimensões operacionais >= 95,
Overall >= 97. Usar o manifest canônico do repositório como autoridade. Não
reduzir thresholds para obter aprovação.

---

# 589. NULL IS BETTER THAN FAKE SCORE

Sem evidence suficiente: `score = null`.

---

# 590. FINAL SCORECARD ENTRY

```json
{
  "score": null,
  "status": "NOT_PROVEN",
  "evidence": [],
  "sha": "...",
  "tests": [],
  "artifacts": [],
  "limitations": [],
  "residualRisk": []
}
```

---

# 591. EVIDENCE TRACEABILITY

Requirement → Control → Implementation → Test → Evidence → Scorecard.

---

# 592. REQUIREMENT IDS

Atribuir IDs estáveis quando útil.

---

# 593. CONSOLIDATE REQUIREMENTS

Consolidar em epics verificáveis: EPIC-AGENT-KERNEL, EPIC-CONTEXT-GOVERNANCE,
EPIC-PLUGIN-SECURITY, EPIC-SESSION-RELIABILITY, EPIC-MODEL-BOUNDARY,
EPIC-EXTERNAL-PROOF.

---

# 594. DO NOT CREATE 500 TICKETS

Agrupar por dependência e risco.

---

# 595. PRIORITY P0

```text
license/provenance
embedding decision
domain sovereignty
PDP
Tool Gateway
session integrity
model boundary
cross-tenant security
external-effect safety
```

---

# 596. PRIORITY P1

```text
Context Builder
retrieval governance
plugins
skills
checkpoint/replay
observability
evals
```

---

# 597. PRIORITY P2

```text
performance optimization
advanced routing
admin UX
developer generators
optional sandbox enhancements
```

---

# 598. DO NOT BLOCK P0 ON P2

---

# 599. FIRST EXECUTION STEP

Antes de modificar qualquer código: auditoria estrutural completa do repositório
atual e do DeepSeek Harness source realmente disponível.

Gerar:

```text
docs/embedded-harness-audit.md
```

---

# 600. AUDIT QUESTIONS

```text
1. What exactly is the DeepSeek Harness?
2. Which directories form its actual runtime?
3. Which parts are generic?
4. Which parts are DeepSeek-specific?
5. Which parts are plugins?
6. Which parts are required for the Agent Loop?
7. Which parts overlap with CVG-Corp?
8. Which parts would duplicate CVG governance?
9. Which parts can legally be embedded?
10. Which parts should remain external?
```

---

# 601. DEPENDENCY MAP

```text
Harness component → dependency → external package → capability
```

---

# 602. OVERLAP MAP

Comparar com AgentRuntime, PDP, Tool Gateway, approval, budget, session, worker,
persistence, observability já existentes no CVG.

---

# 603. DUPLICATION RULE

Se CVG já possuir implementação superior: KEEP CVG.

---

# 604. HARNESS VALUE EXTRACTION

Extrair the useful agent-runtime mechanics sem perder CVG security/reliability/governance.

---

# 605. EMBEDDING DECISION DOCUMENT

Comparar External / Embedded / Hybrid e recomendar arquitetura baseada em evidência.

---

# 606. DECISION MUST PRECEDE MIGRATION

Não iniciar grande migração antes de ADR aprovado tecnicamente, licença clara e
component map completo.

---

# 607. IF EMBED IS APPROVED

Implementação incremental atrás do `AgentRuntime`. Não alterar callers.

---

# 608. IF HYBRID IS APPROVED

`EmbeddedAgentRuntime` e `ExternalAgentRuntime` selecionáveis por configuração.

---

# 609. IF EXTERNAL WINS

Não forçar embedding. Ainda implementar as melhorias arquiteturais úteis.

---

# 610. MOST IMPORTANT TEST

```text
CVG Domain
does not know
which Harness or Model is being used
```

---

# 611. SECOND MOST IMPORTANT TEST

```text
AI cannot perform a CVG side effect
without crossing CVG Tool Gateway + PDP
```

---

# 612. THIRD MOST IMPORTANT TEST

```text
complete AI outage
does not corrupt or disable
the core hospital system
```

---

# 613. FOURTH MOST IMPORTANT TEST

```text
crash/retry
does not duplicate
critical external effects
```

---

# 614. FIFTH MOST IMPORTANT TEST

```text
Organization A
can never access
Organization B
through AI context, retrieval, session or tools
```

---

# 615. STATE-OF-ART ENGINEERING BAR

Priorizar essas propriedades acima de número de abstrações/plugins/files/tests.

---

# 616. SIMPLICITY BAR

Quando duas arquiteturas satisfizerem os mesmos invariantes, preferir a mais simples.

---

# 617. EXTERNAL PROCESS IS NOT FAILURE

O runtime continuar em processo separado não significa que o design falhou.

---

# 618. EMBEDDED CODE IS NOT SAME PROCESS

same repository + same product + same release ≠ same process.

---

# 619. TARGET OWNERSHIP

CVG owns the Agent Runtime architecture; não necessariamente todo componente dentro
do Fastify.

---

# 620. TARGET RESULT

> CVG-Corp is the authoritative veterinary operating system; its governed Agent Runtime orchestrates agents and tools, while DeepSeek is one replaceable model provider.

---

# 621. FINAL IMPLEMENTATION REPORT

CURRENT SHA / DECISION / ARCHITECTURE / IMPLEMENTED / TESTED / EXTERNAL BLOCKERS /
CRITICAL FINDINGS / RESIDUAL RISKS / NEXT GATE.

---

# 622. REPORT FILES CHANGED

---

# 623. REPORT TEST RESULTS

---

# 624. REPORT BLOCKED TESTS

Separar FAILED de BLOCKED_EXTERNAL.

---

# 625. REPORT UNRUN TESTS

`NOT_RUN`.

---

# 626. REPORT SYNTHETIC TESTS

`SYNTHETIC`.

---

# 627. FINAL NO-OVERCLAIM RULE

Nunca concluir “Triplo AAA achieved” somente porque o trabalho local terminou.

---

# 628. FINAL SUCCESS STATES

```text
BUILD_COMPLETE
LOCAL_STATE_OF_THE_ART_CANDIDATE
STATE_OF_THE_ART_CANDIDATE
AAA_NOT_PROVEN
TRIPLE_AAA_CANDIDATE
```

---

# 629. STOP CONDITION

Se restarem apenas credentials, external infrastructure, real provider ou human
approval, parar com `BLOCKED_EXTERNAL` e produzir plano exato para o próximo gate.

---

# 630. FINAL COMMAND TO CODEX

Comece agora. Primeiro: AUDIT. Não copie nenhuma pasta do DeepSeek Harness ainda.
Inspecione o estado atual do `cvg-corp`, identifique o source real do DeepSeek
Harness disponível para este projeto, verifique licença e provenance e mapeie os
componentes.

Produza primeiro:

```text
docs/embedded-harness-audit.md
docs/adr/ADR-agent-runtime-embedding-decision.md
```

A decisão deve ser uma entre:

```text
EMBED
HYBRID
KEEP_EXTERNAL
```

Somente depois dessa decisão comece a implementação.

Se `EMBED` ou `HYBRID` forem aprovados, implemente incrementalmente atrás do
`AgentRuntime` existente.

Preserve CVG Domain, PDP, Tool Gateway, RLS, authoritative writes, audit,
idempotency, effect ledger, workers e recovery como autoridades do sistema.

Não permita que código importado do Harness substitua essas camadas.

Execute a implementação pelas macrofases deste prompt.

Depois de cada macrofase: focused tests → regression → critic → repair → evidence.

Não enfraqueça gates existentes. Não mova os thresholds para obter aprovação.
Não transforme mock em evidence externa. Não transforme documentação em proof
operacional. Não invente credenciais. Não invente aprovação humana. Não invente
resultado de staging.

Quando a implementação local estiver fechada, execute o gauntlet completo e gere
um candidate SHA. Somente então avance para as provas externas.

O resultado desejado é um CVG-Corp cuja arquitetura de IA seja:

```text
modular
provider-neutral
governed
observable
recoverable
secure
replaceable
testable
```

e cujo domínio veterinário continue íntegro mesmo com todo o subsistema de IA
indisponível.

O objetivo final não é “colocar o DeepSeek Harness dentro do CVG-Corp”.

O objetivo final é:

> **transformar os melhores mecanismos do Harness em um runtime cognitivo governado pelo CVG-Corp, sem entregar ao Harness autoridade sobre o hospital.**

Construa isso no nível **State of the Art / Triplo AAA**, mas somente declare
Triplo AAA quando a evidência real satisfizer a barra.
