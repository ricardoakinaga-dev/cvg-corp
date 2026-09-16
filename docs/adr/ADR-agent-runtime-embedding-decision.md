# ADR 034 — Decisão de embedding do Agent Runtime

**Status:** accepted (HYBRID) em 2026-09-16. Nenhuma incorporação de código upstream.
**Relacionados:** [auditoria](../embedded-harness-audit.md) ·
[proveniência](../third-party/deepseek-harness-provenance.md) ·
[ADR 009 — Harness externo](009-deepseek-harness-external-runtime.md)

## Contexto

O programa exige evoluir o CVG-Corp para um runtime cognitivo governado, avaliando a
incorporação controlada de componentes genéricos do DeepSeek Harness. A auditoria da Macrofase A
(`docs/embedded-harness-audit.md`) mapeou o upstream: `dsh 0.1.5-alpha.1` @ `5dda764ed3`, MIT,
267 manifests, ~222k LOC TS em `packages/`, construído sobre o framework Cordis vendorizado, com
sessão/persistência/aprovação/sandbox/credenciais próprios e dependências nativas
(`node-pty`, `koffi`, addons `node-addon-system*`, `sharp`, ripgrep, Electron, SDKs Anthropic/OpenAI).

O CVG-Corp já possui autoridades superiores para todas as fronteiras críticas: `AgentRuntime`
como porta, PDP, Tool Gateway, approval engine, budget/settlement, audit chain, RLS, effect
ledger, worker com fencing e PostgreSQL como fonte de verdade.

## Opções consideradas

1. **EMBED** — importar pacotes genéricos do upstream para o repositório e usá-los como runtime.
2. **KEEP_EXTERNAL** — manter o harness apenas como processo externo via `DeepSeekHarnessAdapter`,
   sem runtime interno novo.
3. **HYBRID** — implementar um runtime interno provider-neutral, autoral, atrás do `AgentRuntime`,
   reutilizando os *mecanismos* identificados na auditoria, e preservar o runtime externo como
   adapter selecionável/rollback.

## Análise

| Critério | External | Embedded (importar upstream) | Hybrid |
| --- | --- | --- | --- |
| Latência | Pior (hop externo, processo ACP/HTTP) | Melhor em teoria | Boa (in-process por contrato) |
| Segurança | Boundary já governado pelo CVG | Ruim: runtime traz approval/sandbox/credenciais/persistência próprios que competiriam com PDP/RLS | Boa: kernel sem autoridade, só portas CVG |
| Blast radius | Isolado por processo | Alto: módulos nativos e Cordis no mesmo repo/release | Médio: código CVG, fail-closed e readiness separada |
| Atualização | Alinhada ao upstream | Fork vendorizado + 267 pacotes + patches de lockfile = custo permanente | Kernel próprio estável; upstream só via contrato `/v1` |
| Debug | Difícil (processo opaco) | Muito difícil (plugin tree Cordis + eventos dsh) | Kernel local testável e determinístico |
| Operação | Segundo runtime de terceiro | Segundo toolchain (pnpm 11.7, Node ^22, TS 6 RC, Electron) | Um toolchain (npm, Node >=24) |
| Portabilidade | Presa ao produto upstream | Presa ao fork | Provider-neutral por contrato próprio |
| Licença | MIT consumida como produto externo | MIT permite, mas exige NOTICE e arrasta dependências heterogêneas (Apache-2.0, licenças de SDK, binários) | MIT permite conceitos; sem código de terceiro no produto |
| Testabilidade | Limitada (mock da ponte) | Testes do upstream não cobrem o CVG | Alta: kernel com fixtures determinísticos |
| Vendor coupling | Alto (produto) | Altíssimo (fork) | Baixo (contrato `/v1` e `ModelProvider`) |
| Tamanho | 0 LOC | +222k LOC e ~267 manifests | Mínimo suficiente (7 pacotes novos) |

Fatos decisivos contra `EMBED`:

- o upstream **não é uma biblioteca de kernel**: o loop depende de Cordis, da sessão event-sourced
  v0→v3, do vocabulário `dsh` e de ~50 grupos de pacotes;
- o pipeline de tools, approval, permissões, sandbox e credenciais do upstream **duplicaria**
  governança CVG — proibido pelo princípio "nunca criar uma segunda governança paralela";
- o runtime completo exige toolchain divergente (pnpm/Node/TS/patches) e módulos nativos, elevando
  supply chain, build e blast radius sem benefício ao domínio veterinário;
- o "mínimo necessário" não é extraível sem poda profunda, o que na prática é reescrever o kernel
  — logo, a opção honesta é reimplementar os mecanismos sob contratos CVG (`REIMPLEMENT/ADAPT`).

Fatos contra `KEEP_EXTERNAL` puro:

- o produto precisa de runtime com latência local para fluxos de recepção/hospitalização e de um
  caminho testável sem credencial externa;
- sem runtime interno não há como provar `Harness != DeepSeek` nem executar shadow/differential
  testing;
- o prompt exige um runtime interno governado como capacidade do produto.

## Decisão

**HYBRID.**

1. Implementar o runtime embarcado **CVG-owned** atrás do `AgentRuntime` existente:
   `packages/agent-kernel`, `agent-context`, `agent-session`, `agent-plugins`, `agent-skills`,
   `model-runtime`, `model-adapters` e `embedded-agent-runtime`.
2. **Não importar** arquivos do upstream. Aplicar `REIMPLEMENT`/`ADAPT` apenas para conceitos
   (loop com limites, contexto por prioridade, sessão com checkpoint, seam de modelo com
   capabilities, plugins por capability, skills como conhecimento, compaction governada).
3. Manter o runtime externo (`DeepSeekHarnessAdapter` + `apps/deepseek-bridge`) selecionável por
   configuração (`CVG_AGENT_RUNTIME=external`) como rollback e para shadow/differential testing.
4. Toda ação de tool continua atravessando `ToolGateway` → PDP → application/domain; nenhuma
   autoridade nova é criada.

## Consequências

- Positivas: rollback configuracional, domínio desacoplado de provider, testabilidade local,
  licença sem código de terceiro, sem toolchain paralelo.
- Negativas: o CVG mantém o kernel (custo de manutenção próprio); paridade com o upstream não é
  automática nem pretendida — só os mecanismos necessários entram.
- Migração: fases LAB → SHADOW → STAGING → CANARY → PRODUCTION
  (`docs/embedded-runtime-rollout.md`). Nenhuma promoção sem evals diferenciais e gates.

## Alternativas rejeitadas

- `EMBED`: rejeitado por blast radius, duplicação de governança, toolchain e licenças de
  dependências; nenhum arquivo upstream foi copiado.
- `KEEP_EXTERNAL` puro: rejeitado por impedir latência local, shadow testing e prova
  de neutralidade de provider.
