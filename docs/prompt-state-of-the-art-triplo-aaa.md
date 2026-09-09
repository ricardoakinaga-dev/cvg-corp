# MISSÃO

Você é o engenheiro principal responsável por elevar o repositório:

https://github.com/ricardoakinaga-dev/cvg-corp

ao nível **State of the Art, Triplo AAA**, com qualidade de arquitetura, segurança, confiabilidade, observabilidade, testabilidade, operação, ergonomia, IA governada e produção comparável a software corporativo de missão crítica.

Não trate esta tarefa como simples refatoração.

Você deverá executar uma **modernização arquitetural completa**, preservando o que já funciona, corrigindo os gaps encontrados e produzindo evidência verificável de cada melhoria.

O sistema é um software operacional veterinário corporativo, com:

* gestão clínica;
* pacientes e tutores;
* agenda;
* internação;
* diagnóstico;
* estoque;
* financeiro;
* comunicação;
* integrações;
* automações;
* agentes de IA;
* DeepSeek Harness como motor de agentes;
* PostgreSQL como sistema transacional;
* frontend React;
* backend Fastify/TypeScript.

A IA NÃO é fonte de verdade.

A fonte de verdade deve continuar sendo o domínio transacional do CVG-Corp.

---

# OBJETIVO FINAL

Transformar o CVG-Corp de uma excelente fundação pré-produção em um sistema:

**production-grade**
**enterprise-grade**
**mission-critical ready**
**agent-native**
**secure-by-default**
**observable**
**recoverable**
**testable**
**portable**
**modular**
**maintainable**
**fail-closed**
**zero-trust oriented**

Meta final:

```text
Architecture Quality       >= 95/100
Security                   >= 95/100
Reliability                >= 95/100
Testing                    >= 95/100
AI Governance              >= 95/100
Operations                 >= 95/100
Developer Experience       >= 95/100
Production Readiness       >= 95/100
Documentation              >= 95/100
Overall                    >= 95/100
```

Não declare esses números como alcançados sem evidência executável.

---

# REGRA PRINCIPAL

O DeepSeek Harness deve ser tratado como:

```text
external cognitive runtime
```

e NÃO como:

```text
core do CVG-Corp
```

Arquitetura obrigatória:

```text
CVG Domain
    ↓
Application Layer
    ↓
Agent Runtime Interface
    ↓
Harness Adapter
    ↓
DeepSeek Harness
```

O CVG-Corp NÃO deve depender da estrutura interna do DeepSeek Harness.

Deve depender apenas de contratos públicos definidos pelo próprio CVG-Corp.

---

# PRINCÍPIOS INEGOCIÁVEIS

Mantenha estes princípios durante toda a implementação.

## 1. Domain sovereignty

A conversa do agente nunca substitui o estado do sistema.

Fonte de verdade:

```text
Patient
Guardian
Appointment
Encounter
ClinicalDocument
DiagnosticRequest
DiagnosticResult
HospitalEpisode
MedicationOrder
Dispensation
Administration
StockMovement
Charge
Payment
Ledger
Audit
```

LLM, memória, RAG, sessão e contexto de agente são apenas camadas auxiliares.

---

## 2. Fail closed

Quando houver:

* credencial ausente;
* policy desconhecida;
* contexto incompleto;
* autorização ambígua;
* provider indisponível;
* receipt ausente;
* resultado externo desconhecido;
* schema incompatível;
* corrupção;
* contexto de usuário inválido;
* versão incompatível do Harness;

o sistema deve falhar fechado.

Nunca escolher permissividade como fallback.

---

## 3. Least privilege

Nenhum agente, worker, integration adapter ou usuário recebe acesso além do necessário.

Aplicar:

```text
organization
unit
workspace
role
resource
purpose
capability
risk
policy revision
```

como dimensões de autorização.

---

## 4. Defense in depth

Não confiar apenas em application-level authorization.

Preservar e ampliar:

```text
RBAC
ABAC/PDP
RLS PostgreSQL
scope validation
schema validation
CSRF
rate limiting
idempotency
audit
approval
tool admission
secret boundaries
```

---

## 5. No overclaim

Se algo não foi executado:

```text
NOT_RUN
```

Se foi parcialmente validado:

```text
PARTIAL
```

Se foi demonstrado apenas com fixture sintética:

```text
SYNTHETIC_EVIDENCE
```

Somente declarar:

```text
VERIFIED
```

quando houver teste reproduzível.

Somente declarar:

```text
PRODUCTION_READY
```

depois de todos os gates obrigatórios.

---

# FASE 0 — DISCOVERY E BASELINE

Antes de modificar qualquer código:

1. Ler todo o README.
2. Ler toda a documentação em `docs/`.
3. Inspecionar `.agent/`.
4. Inspecionar `.gauntlet/`.
5. Inspecionar todas as migrations.
6. Mapear packages.
7. Mapear apps.
8. Mapear scripts.
9. Mapear testes.
10. Mapear contratos.
11. Mapear integração PostgreSQL.
12. Mapear camada de Harness.
13. Mapear integrações externas.
14. Mapear frontend.
15. Mapear pontos de persistência.
16. Mapear trust boundaries.

Produzir:

```text
docs/architecture-audit-vNext.md
```

contendo:

* arquitetura atual;
* pontos fortes;
* gaps;
* riscos;
* dívida técnica;
* dependências;
* plano de migração;
* módulos afetados;
* plano de rollback.

Não começar grandes alterações sem esse mapa.

---

# FASE 1 — AGENT RUNTIME ABSTRACTION

Esta é uma das mudanças mais importantes.

O código atual não deve expor o DeepSeek Harness diretamente ao domínio.

Criar algo equivalente a:

```text
packages/
  agent-runtime/
  agent-policy/
  agent-tools/
  harness-adapters/
      mock/
      deepseek/
```

Criar contrato equivalente a:

```ts
interface AgentRuntime {
  health(): Promise<AgentRuntimeHealth>;

  createSession(
    context: AgentContext,
    input: CreateAgentSessionInput
  ): Promise<AgentSession>;

  executeTurn(
    context: AgentContext,
    input: AgentTurnInput
  ): Promise<AgentTurnResult>;

  approve(
    context: AgentContext,
    input: AgentApprovalInput
  ): Promise<AgentApproval>;

  replay(
    context: AgentContext,
    input: ReplayInput
  ): Promise<ReplayResult>;

  shutdown(): Promise<void>;
}
```

O domínio não pode saber:

```text
deepseek
codex
opencode
provider-specific details
```

Implementar pelo menos:

```text
MockAgentRuntime
DeepSeekHarnessAdapter
```

---

# FASE 2 — INTEGRAÇÃO REAL DO DEEPSEEK HARNESS

Substituir o stub como único runtime.

Criar adapter real com boundary explícito.

Suportar:

* health;
* version check;
* engine commit;
* capability manifest;
* tool registry;
* session lifecycle;
* timeout;
* cancellation;
* token budget;
* tool calls;
* approval;
* replay;
* provenance;
* correlation ID;
* structured errors;
* structured output.

Nunca deixar o Harness escrever diretamente no banco do CVG.

Fluxo obrigatório:

```text
DeepSeek Harness
      ↓
CVG Tool Gateway
      ↓
Policy
      ↓
Application Service
      ↓
Domain
      ↓
Persistence
```

Nunca:

```text
Harness
   ↓
database
```

---

# FASE 3 — TOOL GATEWAY STATE OF THE ART

Construir um gateway universal de ferramentas.

Cada tool deve possuir:

```text
name
version
description
risk
capability
allowed roles
allowed scopes
input schema
output schema
approval requirement
timeout
idempotency strategy
audit policy
secret requirements
egress policy
data classification
```

Riscos mínimos:

```text
READ_ONLY
DRAFT
REVERSIBLE
HIGH_IMPACT
CRITICAL
```

Para HIGH_IMPACT e CRITICAL:

* aprovação humana obrigatória;
* actor != approver;
* approval one-shot;
* TTL;
* request digest;
* scope binding;
* resource binding;
* tool version binding;
* policy revision binding.

---

# FASE 4 — PDP / ABAC

Criar Policy Decision Point separado.

Não espalhar autorização complexa em `if` pelo código.

Modelo esperado:

```text
PEP
 ↓
PDP
 ↓
Policy Store
```

A decisão deve considerar:

```text
actor
role
organization
unit
workspace
resource
purpose
operation
risk
time
policy revision
session
```

Resultado:

```ts
{
  decision: "allow" | "deny",
  reason,
  policyRevision,
  obligations,
  constraints
}
```

Toda mutação sensível deve passar pelo PDP.

---

# FASE 5 — REFATORAÇÃO DO BACKEND

O arquivo:

```text
apps/api/src/server.ts
```

não deve continuar monolítico.

Separar:

```text
apps/api/src/
  server.ts
  app.ts

  plugins/
  middleware/
  auth/
  context/
  routes/
  services/
  errors/
  telemetry/
```

Routes:

```text
auth
guardians
patients
appointments
queue
encounters
clinical
diagnostics
hospitalization
medication
stock
finance
communication
knowledge
ai
integrations
operations
```

Meta:

```text
server.ts < 300 linhas
```

Nenhum arquivo deve concentrar dezenas de responsabilidades.

---

# FASE 6 — APPLICATION LAYER

Criar application services/use cases explícitos.

Modelo:

```text
route
 ↓
application service
 ↓
authorization
 ↓
domain
 ↓
persistence
```

Evitar:

```text
route
 ↓
store diretamente
```

Criar use cases para operações relevantes.

---

# FASE 7 — PERSISTÊNCIA

Preservar tudo que já é bom:

* CAS;
* advisory lock;
* RLS;
* journal;
* snapshot;
* outbox;
* inbox;
* receipts;
* fencing;
* restore;
* reconciliation.

Mas evoluir a fonte agregada baseada em JSONB.

Meta:

```text
normalized repositories
+
event/journal evidence
+
snapshot for recovery
```

Não deixar JSONB permanecer indefinidamente como principal modelo operacional.

Criar repositories tipados:

```text
GuardianRepository
PatientRepository
AppointmentRepository
EncounterRepository
ClinicalRepository
DiagnosticRepository
HospitalizationRepository
MedicationRepository
StockRepository
FinanceRepository
AuditRepository
```

---

# FASE 8 — OUTBOX / INBOX / EFFECT LEDGER

Aprimorar o modelo para nível enterprise.

Implementar:

```text
claim
lease
fencing token
retry policy
dead-letter
backoff
receipt verification
unknown outcome
reconciliation
provider state query
idempotency
```

Nenhum worker deve realizar retry cego após resultado desconhecido.

Estados mínimos:

```text
PENDING
CLAIMED
DISPATCHING
OUTCOME_UNKNOWN
SUCCEEDED
FAILED_RETRYABLE
FAILED_FINAL
RECONCILING
RECONCILED
```

---

# FASE 9 — WORKERS

Separar API de workers.

Criar aplicação própria:

```text
apps/worker/
```

Responsável por:

* outbox;
* jobs;
* scheduled operations;
* reconciliation;
* notifications;
* maintenance tasks.

Workers não devem compartilhar privilégios administrativos desnecessários.

---

# FASE 10 — SECRET MANAGEMENT

Remover dependência de secrets fixos.

Adicionar abstraction:

```text
SecretProvider
```

Suportar inicialmente:

```text
EnvironmentSecretProvider
FileSecretProvider apenas para desenvolvimento
```

Arquitetura preparada para:

```text
Vault
AWS Secrets Manager
GCP Secret Manager
Azure Key Vault
Docker Secrets
Kubernetes Secrets
```

Nunca logar secrets.

Nunca retornar secrets em erro.

---

# FASE 11 — AUTENTICAÇÃO DE PRODUÇÃO

Preparar autenticação enterprise.

Implementar ou preparar boundary para:

```text
MFA
password policy
credential rotation
session revocation
device/session tracking
account lockout
recovery
audit
```

Cookies:

```text
HttpOnly
Secure
SameSite
```

Produção obrigatoriamente HTTPS.

---

# FASE 12 — FRONTEND MODULAR

O arquivo:

```text
apps/web/src/main.tsx
```

deve ser dividido.

Estrutura:

```text
apps/web/src/
  app/
  routes/
  pages/
  features/
  components/
  hooks/
  api/
  state/
  design-system/
  styles/
```

Criar design system.

Evitar CSS monolítico.

Implementar:

* accessibility;
* keyboard navigation;
* mobile;
* desktop;
* tablet;
* loading;
* empty;
* error;
* offline;
* degraded;
* unauthorized;
* permission denied;
* stale context.

---

# FASE 13 — OFFLINE MODEL

Implementar política offline explícita.

Offline nunca pode permitir escrita não confirmada em áreas clínicas ou financeiras críticas.

Criar estados:

```text
ONLINE
DEGRADED
OFFLINE_READ_ONLY
REVALIDATING
CONTEXT_INVALID
```

Cache apenas para classes autorizadas.

Nunca presumir autorização antiga após reconnect.

Sempre revalidar contexto.

---

# FASE 14 — DOCKER PRODUÇÃO

Criar compose completo.

Esperado:

```text
reverse-proxy
cvg-web
cvg-api
cvg-worker
deepseek-harness
postgres
redis opcional
telemetry
```

Adicionar:

```text
Dockerfile
Dockerfile.prod
docker-compose.dev.yml
docker-compose.prod.yml
```

Containers:

* non-root;
* read-only filesystem quando possível;
* healthcheck;
* resource limits;
* restart policy;
* secrets externos;
* minimal base image.

---

# FASE 15 — PORTABILIDADE

Remover qualquer dependência hardcoded de:

```text
/home/ricardo/
```

Scripts do projeto precisam funcionar em:

```text
Linux workstation
CI
VPS
container
```

Ferramentas auxiliares devem ser:

* vendored;
* npm dev dependencies;
* scripts internos;
* optional tooling.

---

# FASE 16 — CI/CD

Criar:

```text
.github/workflows/
```

Pipelines obrigatórios:

```text
lint
typecheck
unit
integration
postgres integration
e2e
security
dependency audit
migration verification
docker build
SBOM
artifact verification
```

PR não pode ser mergeado se quality gates falharem.

---

# FASE 17 — TESTING AAA

Criar pirâmide:

```text
unit
integration
contract
database
authorization
security
e2e
fault injection
recovery
performance
```

Cobrir especialmente testes negativos.

Exemplos:

```text
cross organization access
cross unit access
cross workspace access
role escalation
approval replay
approval reuse
expired approval
tampered approval
wrong resource
wrong purpose
wrong policy revision
invalid CSRF
stolen session
missing receipt
duplicate webhook
provider timeout
provider unknown outcome
database crash
worker crash
network partition
restore corruption
migration rollback
```

---

# FASE 18 — CHAOS / FAULT TESTS

Adicionar testes reproduzíveis para:

```text
crash before commit
crash after commit
crash before dispatch
crash after dispatch
crash before provider receipt
crash after receipt
worker lease loss
database reconnect
provider timeout
duplicate provider callback
corrupted restore
partial restore
```

Provar que não ocorre:

```text
double charge
double notification
double medication action
double stock movement
double refund
```

---

# FASE 19 — OBSERVABILITY

Adicionar observabilidade estruturada.

Implementar:

```text
logs
metrics
traces
correlation IDs
request IDs
actor IDs redacted when appropriate
organization context
tool invocation metrics
outbox metrics
reconciliation metrics
AI cost/token metrics
error taxonomy
```

Preparar OpenTelemetry.

Criar dashboards conceituais/documentação para:

```text
availability
latency
errors
outbox backlog
worker health
DB health
AI usage
security denials
approval queue
integration failures
```

---

# FASE 20 — SLO / ERROR BUDGET

Definir SLOs.

Exemplos:

```text
API availability
p95 latency
login latency
patient lookup latency
outbox processing delay
message delivery acknowledgement
restore RTO
restore RPO
```

Não inventar números de produção.

Marcar como PROPOSED até medição real.

---

# FASE 21 — AUDIT

Audit ledger deve ser:

```text
append-only
tamper-evident quando possível
scope aware
correlation aware
actor aware
resource aware
```

Eventos sensíveis:

```text
login
logout
failed login
role grant
role revoke
patient access
clinical write
clinical sign
medication
stock
refund
approval
AI tool execution
secret access
restore
export
break-glass
```

---

# FASE 22 — BREAK GLASS

Criar arquitetura de break-glass separada.

Exigir:

```text
explicit invocation
reason
short TTL
independent audit
enhanced logging
mandatory review
automatic expiration
```

Nunca misturar break-glass com role admin comum.

---

# FASE 23 — DATA CLASSIFICATION

Formalizar:

```text
D0 Public/Internal
D1 Operational
D2 Restricted
D3 Clinical sensitive
D4 Financial sensitive
D5 Secret/credential
```

Cada ferramenta, endpoint e integração deve declarar quais classes aceita.

---

# FASE 24 — AI SECURITY

Expandir proteção contra:

```text
prompt injection
indirect prompt injection
tool injection
data exfiltration
secret leakage
retrieval poisoning
malicious documents
capability escalation
approval bypass
model confusion
context poisoning
```

Nenhum conteúdo recuperado pode alterar policy.

Prompt externo = dado não confiável.

---

# FASE 25 — AI PROVENANCE

Toda resposta de IA deve registrar:

```text
model/provider
engine version
engine commit
profile digest
tool registry revision
policy revision
knowledge references
prompt digest
session ID
turn ID
usage
approvals
```

---

# FASE 26 — MODEL PROVIDER ABSTRACTION

Não acoplar ao modelo.

Criar boundary para:

```text
DeepSeek
local model
OpenAI
Anthropic
future provider
```

O Harness decide como usar o provider, mas o CVG conhece apenas o contrato.

---

# FASE 27 — KNOWLEDGE / RAG

Criar pipeline governado.

Documentos devem possuir:

```text
source
owner
classification
scope
version
checksum
approval status
expiry/review date
```

Somente documentos:

```text
APPROVED
```

podem entrar no contexto.

---

# FASE 28 — API CONTRACTS

Criar versionamento consistente.

Manter:

```text
/v1
```

e preparar estratégia para:

```text
/v2
```

Adicionar:

```text
schema version
contract version
compatibility policy
deprecation policy
migration/upcaster strategy
```

---

# FASE 29 — RATE LIMITING / ABUSE

Rate limits específicos para:

```text
login
AI turns
exports
search
integrations
webhooks
high-risk commands
```

Rate limit não deve depender apenas de memória em produção.

---

# FASE 30 — FIRST REAL VERTICAL SLICE

Implementar uma integração real ponta a ponta.

Preferencialmente:

```text
Appointment
   ↓
Communication staged
   ↓
Human approval
   ↓
Messaging provider
   ↓
Outbox
   ↓
Receipt
   ↓
Audit
   ↓
Reconciliation
```

Não espalhar cinco integrações incompletas.

Fazer UMA completa.

---

# FASE 31 — PERFORMANCE

Adicionar benchmarks.

Avaliar:

```text
patient lookup
appointment list
login
AI turn
outbox processing
Postgres commit
RLS overhead
recovery
```

Ferramentas possíveis:

```text
autocannon
k6
pgbench
```

Não otimizar cegamente.

Medir antes.

---

# FASE 32 — SUPPLY CHAIN

Adicionar:

```text
npm audit
SBOM
lockfile enforcement
dependency pinning policy
container scanning
license inventory
```

Preparar Dependabot/Renovate.

---

# FASE 33 — MIGRATION SAFETY

Migrations devem ser:

```text
append-only
checksummed
ordered
validated
```

Adicionar:

```text
migration dry run
compatibility checks
backup gate
rollback/forward-fix policy
```

Nunca modificar migration já aplicada.

---

# FASE 34 — BACKUP / RESTORE

Preservar e ampliar o excelente restore drill existente.

Criar:

```text
backup manifest
encrypted backup
key reference
checksum
quarantine restore
validation
session revocation
restore audit
```

Testar:

```text
full restore
tampered backup
partial backup
wrong key
stale backup
migration mismatch
```

---

# FASE 35 — SECURITY HEADERS

Adicionar headers adequados no frontend/API:

```text
CSP
HSTS
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
frame protection
```

Adaptar corretamente para ambientes local/dev/prod.

---

# FASE 36 — CONFIGURATION

Criar configuração fortemente tipada.

Exemplo:

```text
packages/config
```

Validar no startup com Zod.

Nenhum fallback inseguro.

Config desconhecida deve gerar erro claro.

---

# FASE 37 — ERROR TAXONOMY

Padronizar erros:

```text
VALIDATION_ERROR
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
RESOURCE_NOT_FOUND
CONFLICT
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
PROVIDER_TIMEOUT
OUTCOME_UNKNOWN
POLICY_DENIED
CORRUPTED_STATE
QUARANTINED
INTERNAL_ERROR
```

Erros externos não podem vazar stack trace ou segredo.

---

# FASE 38 — DOCUMENTAÇÃO OPERACIONAL

Criar:

```text
docs/runbooks/
```

Incluindo:

```text
deployment.md
rollback.md
backup.md
restore.md
database-incident.md
provider-outage.md
deepseek-harness-outage.md
security-incident.md
credential-rotation.md
worker-backlog.md
quarantine.md
break-glass.md
```

---

# FASE 39 — ADR

Criar Architecture Decision Records.

```text
docs/adr/
```

Registrar decisões importantes como:

```text
ADR-001 Agent Runtime Boundary
ADR-002 DeepSeek Harness as External Runtime
ADR-003 PostgreSQL RLS
ADR-004 Outbox
ADR-005 Approval Model
ADR-006 AI Source-of-Truth Boundary
ADR-007 Restore Quarantine
ADR-008 PDP
```

---

# FASE 40 — QUALITY GATE FINAL

Criar comando único:

```bash
npm run verify:production
```

Esse comando deve executar, direta ou indiretamente:

```text
typecheck
lint
unit
integration
contracts
security tests
authorization tests
database tests
migration checks
e2e
build
dependency audit
static verification
AI policy tests
outbox/inbox tests
restore tests
```

Testes que exigem providers externos podem ser separados, mas devem possuir gate próprio.

---

# CRITÉRIOS DE STATE OF THE ART

Antes de concluir, verificar se:

### Arquitetura

```text
[ ] Domain independente do Harness
[ ] AgentRuntime abstrato
[ ] DeepSeek adapter real
[ ] application layer
[ ] modular backend
[ ] modular frontend
[ ] worker separado
```

### Security

```text
[ ] RBAC
[ ] ABAC/PDP
[ ] RLS
[ ] approval
[ ] CSRF
[ ] rate limit
[ ] secrets
[ ] least privilege
[ ] break-glass
[ ] audit
```

### Reliability

```text
[ ] idempotency
[ ] outbox
[ ] inbox
[ ] fencing
[ ] reconciliation
[ ] restore
[ ] crash tests
```

### AI

```text
[ ] tool admission
[ ] provider abstraction
[ ] provenance
[ ] budget
[ ] approval
[ ] replay
[ ] injection defense
[ ] knowledge governance
```

### Operations

```text
[ ] Docker
[ ] CI/CD
[ ] metrics
[ ] logs
[ ] traces
[ ] health
[ ] readiness
[ ] runbooks
[ ] backup
```

### Quality

```text
[ ] unit
[ ] integration
[ ] e2e
[ ] fault tests
[ ] security tests
[ ] migration tests
[ ] performance baseline
```

---

# PROIBIÇÕES

Não:

* reescrever tudo sem necessidade;
* quebrar invariantes existentes;
* remover RLS;
* remover outbox;
* remover restore drill;
* remover auditoria;
* remover approval;
* misturar domínio com Harness;
* permitir Harness escrever diretamente no banco;
* adicionar secrets hardcoded;
* deixar dependências `/home/ricardo`;
* declarar produção sem evidência;
* criar abstrações inúteis;
* adicionar microservices sem necessidade;
* substituir consistência por complexidade.

---

# ESTRATÉGIA DE IMPLEMENTAÇÃO

Execute em ciclos pequenos:

```text
inspect
→ plan
→ implement
→ test
→ critic
→ repair
→ verify
→ document
```

Após cada fase relevante:

1. executar testes;
2. executar typecheck;
3. executar build;
4. revisar segurança;
5. revisar regressões;
6. atualizar documentação;
7. registrar evidências.

---

# GAUNTLET OBRIGATÓRIO

Antes da conclusão, executar múltiplas críticas independentes.

No mínimo:

```text
architecture critic
security critic
reliability critic
AI safety critic
database critic
frontend critic
operations critic
final adversarial critic
```

Cada critic deve possuir contexto fresco.

Não permitir que o critic altere o código.

Critics apenas avaliam.

Depois:

```text
critic
↓
findings
↓
repair
↓
re-run tests
↓
final critic
```

---

# DELIVERABLES

Ao final, entregar no repositório:

```text
docs/
  architecture-audit-vNext.md
  production-readiness-vNext.md
  security-review-vNext.md
  ai-runtime-vNext.md
  deployment-vNext.md
  verification-vNext.md
  state-of-the-art-scorecard.md
```

Além de:

```text
docs/adr/
docs/runbooks/
```

Atualizar README.

---

# SCORECARD FINAL

Gerar uma avaliação real de 0–100:

```text
Architecture
Domain Design
Security
Authorization
Database
Reliability
AI Governance
DeepSeek Harness Integration
Backend
Frontend
Testing
Observability
DevOps
Recovery
Documentation
Production Readiness
```

Para cada nota:

* evidência;
* gaps;
* arquivos relacionados;
* testes relacionados;
* risco residual.

---

# DEFINITION OF DONE

A tarefa NÃO termina quando:

```text
o código compila
```

Ela termina quando:

```text
architecture sound
+
tests passing
+
security reviewed
+
failure modes exercised
+
recovery verified
+
DeepSeek boundary correct
+
deploy reproducible
+
documentation consistent
+
critics satisfied
```

Se alguma parte continuar incompleta, declare explicitamente:

```text
PARTIAL
BLOCKED
NOT_RUN
```

e não esconda o gap.

---

# PRIORIDADE DE EXECUÇÃO

A sequência recomendada é:

```text
1  Discovery
2  AgentRuntime
3  DeepSeek Harness Adapter
4  Tool Gateway
5  PDP
6  Backend modularization
7  Application layer
8  Persistence repositories
9  Outbox/inbox hardening
10 Worker
11 Secrets
12 Frontend modularization
13 Docker
14 CI/CD
15 Observability
16 Security hardening
17 Fault tests
18 First real integration
19 Performance
20 Final gauntlet
```

Não tente implementar tudo simultaneamente.

---

# RESULTADO ESPERADO

Ao final, o CVG-Corp deverá possuir uma arquitetura próxima de:

```text
                         USERS
                           │
                           ▼
                     ┌──────────┐
                     │ CVG WEB  │
                     └────┬─────┘
                          │
                          ▼
                     ┌──────────┐
                     │ CVG API  │
                     └────┬─────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
      Application       PDP         Agent API
           │              │              │
           ▼              │              ▼
         Domain ◄─────────┘        Agent Runtime
           │                              │
           ▼                              ▼
       Persistence                  Harness Adapter
           │                              │
           ▼                              ▼
       PostgreSQL                 DeepSeek Harness
           │                              │
       ┌───┴────┐                 ┌───────┼───────┐
       ▼        ▼                 ▼       ▼       ▼
     Audit    Outbox             LLM     MCP    Skills
                │
                ▼
              Worker
                │
                ▼
           Integrations
```

Essa arquitetura deve preservar a soberania do domínio CVG mesmo que:

```text
DeepSeek Harness desapareça
provider fique offline
LLM seja substituído
modelo mude
skill falhe
MCP fique indisponível
```

O sistema hospitalar deve continuar íntegro.

---

# COMANDO FINAL

Comece agora realizando a Discovery completa do repositório.

Não faça grandes alterações antes de produzir:

```text
docs/architecture-audit-vNext.md
```

Depois implemente as fases em ordem de dependência.

Use o estado real do repositório como fonte de verdade.

Preserve tudo que já estiver melhor que a proposta.

Não faça refatoração estética sem ganho mensurável.

Para cada melhoria, exija evidência.

O objetivo não é produzir mais código.

O objetivo é transformar o CVG-Corp em um sistema **State of the Art, Triplo AAA, seguro, confiável e sustentável para operação corporativa real.**
