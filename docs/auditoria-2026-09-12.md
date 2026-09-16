# Auditoria técnica do CVG-Corp — 12/09/2026

**Nota geral: 72/100.** O sistema tem bons controles de autorização, contratos e testes de interface, mas apresenta defeitos funcionais reproduzidos, ações de negócio incompletas e falhas nos próprios gates de verificação. **A prontidão para produção não está comprovada.**

## Registro, escopo e método

- Identificador: AUDIT-CVG-20260912. Revisão: `1c22c5dc79c52151f4c7c94c4402dfdc86812cbc`, versão 0.1.0.
- Ambiente: Linux, Node 24.20.0, npm 11.19.0; dados sintéticos. Data local: 12/09/2026, America/Sao_Paulo; os logs em UTC registram 13/09.
- Estado inicial do Git: limpo. Código do produto não foi corrigido nesta auditoria; foram acrescentados este relatório e suas evidências.
- Escopo: arquitetura, contratos, autenticação, autorização, governança de IA, persistência, worker, funcionalidades web, financeiro, acessibilidade, testes, dependências, desempenho, observabilidade, documentação e entrega.
- Referências de expectativa: README, contratos executáveis, scripts do package.json e comportamento anunciado pela interface no commit auditado. Relatórios históricos foram tratados como antecedentes, sem assumir seus resultados como prova atual.
- Critérios: comportamento anunciado deve funcionar; cálculos devem refletir o estado do domínio; falhas não devem induzir o usuário a acreditar em uma operação concluída; build e verificações devem ser reproduzíveis; produção exige provas de suas dependências reais.
- Método: inspeção conectada de código/rotas/consumidores, execução das suítes existentes, instalação limpa do commit em diretório temporário e duas reproduções adicionais no navegador.
- Limitações: auditoria por um único agente, sem revisão independente; sem pentest externo, validação clínica, avaliação jurídica, leitores de tela humanos, carga real, PostgreSQL real nesta rodada, restore real, deploy ou integrações externas. A amostra de código não equivale a revisão exaustiva de cada linha.

## Notas por item

Notas são avaliações técnicas de maturidade comprovada, não percentuais de cobertura nem probabilidades de segurança. Escala: 90–100 forte no escopo; 75–89 bom com lacunas; 60–74 parcial; 40–59 limitações relevantes; 0–39 insuficiente. A nota geral é a média simples dos 16 itens: 72,125, arredondada para 72. Uma média não compensa um bloqueio de produção.

| Item analisado | Nota /100 | Avaliação e fundamento |
| --- | ---: | --- |
| Arquitetura e manutenção | 72 | Workspaces e services estabelecem fronteiras úteis, mas API e persistência ainda concentram milhares de linhas. Lint próprio cobre regras restritas. |
| Contratos e validação de entrada | 88 | Zod, catálogo de rotas, envelopes versionados e TypeScript estrito; build/typecheck aprovados. Cliente valida envelope, mas não todo payload de cada recurso. |
| Autenticação, autorização e sessão | 76 | Cookies HttpOnly/SameSite, CSRF, MFA e políticas no servidor; problema de logout reproduzido reduz a nota. |
| Governança de IA | 86 | Aprovação, budgets, proveniência, replay e bloqueio por ausência de dependência. O teste ACP real permanece pulado; operação externa não foi comprovada. |
| Persistência e integridade | 78 | Transações, CAS, RLS, encadeamento de auditoria e migrations; snapshot agregado continua central e não houve execução real de PostgreSQL nesta rodada. |
| Worker e resiliência | 80 | Jobs tipados, lease/fencing, retry, quarentena e auditoria durável previstos e cobertos localmente; dependências reais não exercitadas. |
| Completude funcional | 58 | Navegação, agenda e administração funcionam na amostra; entradas de estoque, cobrança e outros controles continuam apenas emitindo avisos. |
| Correção do financeiro | 50 | Domínio registra pagamentos e estados, mas a interface contabiliza cobrança paga como valor em aberto. |
| Interface e usabilidade | 84 | Navegação responsiva, foco, estados de erro e bloqueio funcionam; existem ações sem conclusão e feedback enganoso de logout. |
| Acessibilidade | 90 | Axe, foco, navegação mobile, zoom/reflow e contraste aprovados na amostra Chromium. Sem certificação global ou validação humana com leitor de tela. |
| Testes e confiabilidade das verificações | 72 | 328 testes aprovados de 330, um falhou e um foi pulado. Suíte E2E local passa, mas o teste de evidências depende do estado do checkout. |
| Desempenho e escalabilidade | 58 | Bundle compacto e baseline sintético; serialização por organização, snapshots e hashing síncrono exigem medição real de concorrência. |
| Observabilidade e recuperação | 72 | OTLP, métricas, dashboards/runbooks e código de backup/restore existem; alertas, retenção e recuperação em ambiente real não comprovados nesta rodada. |
| Dependências e cadeia de fornecimento | 85 | Audit do lockfile sem vulnerabilidades reportadas; 163 pacotes aprovados pela política local de licenças; instalação limpa funciona. node_modules original diverge do lockfile. |
| CI/CD e prontidão para produção | 45 | CI detalhado, ações fixadas por SHA e imagens endurecidas; gate local de produção falhou e não há validação operacional alvo nesta auditoria. |
| Documentação e rastreabilidade | 60 | Documentação extensa e limitações explicitadas; snapshot de evidência aponta a outro SHA e perde validade no checkout atual. |

## Verificações executadas

As saídas estão em [evidências desta auditoria](../artifacts/audit-2026-09-12/). Os resultados abaixo distinguem prova de produto, reprodução de defeito e limitação ambiental.

| Procedimento | Resultado observado | Limite |
| --- | --- | --- |
| `npm test` | 330 testes: 328 pass, 1 fail, 1 skip | Falha em `evidence-snapshot.test.ts`; ACP real pulado por configuração. |
| `npm run build` no workspace | PASS, incluindo TypeScript | Vite instalado 7.3.6; resultado não representa o lockfile 8.3.0. |
| `npm ci --ignore-scripts` e build em cópia limpa | PASS; Vite 8.3.0 | Cópia do commit via git archive, sem alterar dependências do workspace. |
| `npm run lint` | PASS, 169 fontes | Regras customizadas; não mede complexidade nem substitui lint semântico completo. |
| `npm run verify:static` | FAIL | SHA, estado Git e mtimes das evidências divergem. |
| Chromium wide/mobile/stress no workspace | 31 pass, 5 skip | Dados sintéticos e dependências originalmente instaladas. |
| Mesma matriz na instalação limpa + reproduções | 33 pass, 7 skip | 31 casos existentes + 2 casos que confirmam defeitos; dois skips adicionais evitam repetir reproduções desktop em mobile. |
| `npm audit --json` | 0 vulnerabilidades reportadas | Consulta ao registro para o lockfile; não demonstra ausência de vulnerabilidades desconhecidas nem equivalência do node_modules original. |
| `npm run audit:licenses` | PASS, 163 pacotes | Política SPDX do projeto; não é parecer jurídico. |
| `npm run audit:contrast` | 7 combinações aprovadas | Paleta selecionada; não cobre toda combinação dinâmica. |
| `npm run audit:tokens` | 0 achados altos, 73 médios | Médios são pares de cores próximas por distância RGB, sem confirmação de defeito perceptual. |
| `npm run benchmark:local` | Executado, 30 amostras por operação | Fixture em memória, concorrendo com outras verificações; não estabelece SLO. |
| `npm run verify:production` | FAIL | Reportou falhas de testes, static e SBOM por dependências inválidas. |
| `git diff --check` antes do relatório | PASS | Código auditado permaneceu sem alterações. |

A execução limpa precisou de portas alternativas 4311/5174 para não colidir com o E2E disparado pelo gate de produção. Uma tentativa foi bloqueada pela porta ocupada; outra, antes de ajustar `CVG_WEB_ORIGIN`, teve duas falhas por configuração do harness. Com origem e portas consistentes, a matriz final passou. Esses resultados intermediários não são atribuídos ao produto e foram preservados.

## Achados e correções recomendadas

### A01 — Logout aparenta conclusão quando o servidor não encerrou a sessão

**Severidade alta; prioridade P1; confirmado no navegador.** Em [use-session.ts](../apps/web/src/hooks/use-session.ts#L106), o `finally` limpa a interface e transita para SIGNED_OUT mesmo se o POST falhar. Fora de ONLINE, nem tenta revogar. A chamada em App.tsx descarta a Promise sem tratar a rejeição.

Reprodução: entrar na demonstração; interceptar `/auth/logout` com falha de rede; clicar em Sair; observar a tela de login; restaurar rede e recarregar. O dashboard reaparece sem nova autenticação. Isso não é bypass da autenticação: o cookie e a sessão continuam válidos. O risco é o usuário acreditar que encerrou o acesso, particularmente em dispositivo compartilhado.

Correção: distinguir saída local de revogação confirmada, apresentar falha/pendência e permitir nova tentativa ao recuperar conectividade. Tratar a Promise. Aceite: cenários de sucesso, falha, offline e recarga mostram o estado real e não anunciam encerramento confirmado sem recibo do servidor.

### A02 — Cobranças pagas entram no total “EM ABERTO”

**Severidade alta; prioridade P1; confirmado no navegador com resposta sintética.** [Finance.tsx](../apps/web/src/features/finance/Finance.tsx#L27) soma todos os `amountCents`. A rota [app.ts](../apps/api/src/app.ts#L1573) usa `listCharges`, sem filtrar abertos. O domínio admite OPEN, PARTIALLY_PAID, PAID e REFUNDED.

Reprodução: retornar uma cobrança PAID de 10.000 centavos. A tela mostra “Pago” na linha e R$ 100,00 em “EM ABERTO”. A apresentação de qualquer estado diferente de PAID como “Em aberto” também não distingue REFUNDED. Não foi demonstrada corrupção do ledger; o defeito confirmado está no resumo e na apresentação.

Correção: devolver saldo pendente calculado a partir de cobranças, pagamentos e estornos; mapear estados explicitamente. Aceite: cobrança integralmente paga não aumenta o total aberto; pagamentos parciais usam o restante e estornos seguem regra de negócio explícita.

### A03 — Suíte depende de um snapshot histórico e do estado do Git

**Severidade média; prioridade P1; confirmado por execução e inspeção.** [evidence-snapshot.test.ts](../tests/unit/evidence-snapshot.test.ts#L16) inverte o estado do snapshot versionado, em vez de construir uma fixture correspondente ao estado atual. O snapshot informa MODIFIED e o checkout estava CLEAN; a inversão produz CLEAN, portanto a divergência esperada deixa de existir.

Impacto: checkout limpo falha e uma alteração irrelevante pode mudar o resultado do teste. Correção: fixture temporária controlada ou abstração explícita de Git/filesystem/clock. Aceite: teste negativo rejeita adulteração em checkout limpo e modificado, sem depender do histórico de execução.

### A04 — Evidência versionada não corresponde ao commit auditado

**Severidade média; prioridade P1; confirmado por `verify:static`.** [evidence-snapshot.json](../artifacts/operational-proof/evidence-snapshot.json#L4) referencia `e43b3b0032aafb9d17563b1fce00fbae88ee0d51`; HEAD é `1c22c5dc...`. Há divergências em mtimes dos dez artefatos vinculados.

O verificador está rejeitando evidência incompatível, o que é positivo. A deficiência é a portabilidade e atualidade da prova entregue. Correção: produzir evidências para o candidato efetivamente testado, ligar hashes/commit/run ID e separar metadados locais de arquivos de provas transportáveis. Não basta atualizar o timestamp de testes históricos. Aceite: checkout novo e pipeline reproduzem a prova do mesmo candidato.

### A05 — Instalação local diverge do manifesto

**Severidade média; prioridade P1 para validação/release; confirmado.** `npm ls` identifica Vite 7.3.6 e plugin-react 5.2.0 como inválidos para as faixas ^8.2.2 e ^6.1.1. O lockfile resolve Vite 8.3.0. O gate falhou ao gerar SBOM.

A instalação limpa e o build aprovados mostram que não há bloqueio de instalação demonstrado no lockfile. Correção: padronizar verificação em instalação limpa e gerar SBOM do artefato efetivamente produzido. Aceite: `npm ls`, build, E2E e SBOM usam a mesma árvore resolvida.

### A06 — Ações centrais da interface ainda não executam o fluxo anunciado

**Severidade média; prioridade P2; confirmado por inspeção.** “Nova cobrança” em Finance.tsx e “Registrar entrada”/“Abrir inventário” em [Stock.tsx](../apps/web/src/features/stock/Stock.tsx#L51) chamam somente `notify`. Há avisos semelhantes em Atendimento e Overview.

O escopo sintético explica parte dos bloqueios, mas handlers incondicionais não implementam o fluxo para um usuário autorizado. Correção: implementar formulário/API/validação/retorno ou apresentar indisponibilidade persistente e clara. Aceite: cada ação habilitada completa uma operação observável ou comunica sua restrição antes do clique.

### A07 — Grandes módulos e serialização limitam manutenção e exigem prova de capacidade

**Severidade média; prioridade P2; estrutura confirmada, impacto de escala inferido.** Persistência tem 4.199 linhas, API 1.940, domínio 1.648 e integrações 1.296. [app.ts](../apps/api/src/app.ts#L633) coordena requisições por organização e carrega/hidrata snapshot; o domínio usa `scryptSync` na autenticação.

O desenho favorece consistência, mas pode bloquear o event loop no login e ampliar custo/espera conforme crescem dados e concorrência. Não foi demonstrada saturação em produção. Correção: medir p95/p99, event-loop lag e contenção com PostgreSQL/dataset representativo; então reduzir as seções críticas e decompor módulos conforme as fronteiras existentes. Aceite: metas explícitas sustentadas por carga reproduzível.

### A08 — Prova operacional de produção permanece incompleta

**Lacuna de evidência alta para promoção; prioridade P1 antes de produção.** Existem código e fixtures para PostgreSQL, backups, OTLP, workers e adapters, mas esta rodada não provou migrations/RLS/restore em banco real, observação de alertas, entrega externa ou execução DeepSeek real. O gate local ainda falhou antes da validação final de Compose.

Isso não significa que todo recurso esteja ausente. Significa que implementação e testes sintéticos não bastam para declarar operação pronta. Aceite: pipeline limpo, banco efêmero real, restore, container smoke, carga e integrações em ambiente autorizado, com evidências vinculadas ao mesmo candidato.

### A09 — Lint restrito e excesso de cores semelhantes

**Severidade baixa; prioridade P3; confirmado por inspeção/scan.** [lint.ts](../scripts/lint.ts#L4) não inclui a árvore de testes e verifica principalmente newline, padrões de credenciais/storage e algumas fronteiras de imports/mutações. O scan de tokens detecta 73 pares de cores próximas, sem achados altos.

Correção: complementar lint com regras semânticas úteis e revisar tokens por uso real, sem assumir que todo par próximo precisa ser eliminado. Aceite: regras alcançam testes e fronteiras relevantes; alterações de tokens mantêm contraste e estados visuais.

## Parecer e sequência de trabalho

**Auditoria concluída; sistema parcialmente conforme no recorte local. Gate de produção: FAIL nesta execução.** Os defeitos foram diagnosticados, não corrigidos. Todos os achados ficam abertos, sem responsável designado e sem aceite de risco presumido. Nova execução após a correção de cada item é o gatilho de reauditoria.

1. Corrigir logout e saldo financeiro, promovendo as reproduções a testes de regressão que exijam o comportamento correto.
2. Tornar o teste de snapshot determinístico, produzir evidências atuais e repetir o gate em instalação limpa.
3. Completar ações essenciais e executar a prova operacional com PostgreSQL, restore e dependências autorizadas.
4. Medir capacidade antes de refatorações de desempenho; reduzir complexidade e duplicações visuais conforme evidência.

O próximo passo recomendado é corrigir **A01 e A02**, que afetam diretamente a confiança do usuário no resultado apresentado pelo programa.
