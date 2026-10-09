# Relatório parcial — 25/09/2026

**Objeto:** candidatos 1–6, com o staging local e a correção do edge registrados no candidato 7. Candidato 5: commit `b43adc80dd630d1bfa686d4059450e11e67d7812`, fingerprint de sujeito `sha256:ff4b97a865ea1556068804510aa62a7e7a8cd195a0acd9902199c8eb5ac60e1a`, 727 arquivos de sujeito, worktree limpo (candidato 6: `30e66ee6`, `sha256:1ec07792…`, 728 arquivos).  
**Veredito:** `PROMOTION_BLOCKED / AAA_NOT_PROVEN` (inalterado).  
**Fonte canônica de status:** `.agent` (append-only); este relatório é a fotografia datada da execução.

## 1. Estado verificado

| Gate | Resultado |
|---|---|
| `npm test` | 746 testes, 745 aprovados, 0 falhas, 1 skip |
| `verify:coverage` | 88,45–88,49% linhas / 76,6–76,7% branches ≥ ratchet 88,40% |
| `verify:mutation` | 30/30 mutantes mortos, 0 sobreviventes, score 100%, `status=FROZEN` |
| E2E 3 browsers (12 projetos) | 503 aprovados, 37 skips, 0 falhas — WebKit host-native 167/13 |
| `verify:control-plane` | 334 itens, ação ativa `AUD27-011:MIGRATION-HARNESS` |
| `verify:static`, `docs-integrity`, `schema-manifest`, `aud27-semantics`, `architecture`, `authoritative-writes`, `secrets` | PASS |
| `npm run doctor` | `DOCTOR_VERDICT=PASS` (0 falhas obrigatórias; aviso opcional de `psql`) |
| `verify:aud27-evidence-root` | `BLOCKED` para o marcador local (falta a autoridade externa); kit validado com `PASS` e adulteração rejeitada |

Tarefas AUD27 concluídas no candidato congelado: **001, 002, 003, 004, 007, 008, 009, 010, 016, 018** (10). Parciais: **011** (harness de migração) e **019** (browsers/a11y). Contagens do control plane: `done=36`, `partial=62`, `rebind-only=0`.

## 2. O que foi entregue nesta sequência

- **Suíte restaurada:** causa-raiz era o duplo `fakePool` sem `snapshot`/`snapshot_digest`, sem a tabela `products` e sem rollback/escopo de organização; corrigido com fidelidade a PostgreSQL e teste de contrato das 24 projeções AUD27.
- **Gates estruturais:** `app.ts` reduzido a 2.446 linhas (budget 2.500) via `http-helpers.ts`; `verify:authoritative-writes` passou a ler todo o pacote e a provar a fiação dos seams; `verify:secrets` com exceção documentada; `verify:production --skip-local-gates` documentado.
- **Cobertura e mutação:** testes reais (copiloto, IA desabilitada, writer) e matriz de mutação ampliada de 25 para **30** mutantes (auditoria, agenda, idempotência, escrita AUD27, WebAuthn), 100% mortos; artefato agora lê o `fingerprint_status` real do control plane.
- **Candidatos congelados:** candidato 1 (`f1b7bdd6`), 2 (`e50ef96`), 3 (`4b22e9e`), 4 (`ce308b6`), 5 (`b43adc8`), cada um com fingerprint reproduzido em checkout novo.
- **Licença:** decisão proprietária registrada; `LICENSE` + `package.json` `UNLICENSED`; gate de licença raiz no `audit:licenses`.
- **Evidência externa:** kit da autoridade de release (`scripts/external-evidence-package.ts`) + runbook, validado com `AUD27_EVIDENCE_ROOT_PASS` e rejeição de adulteração de 1 byte.
- **Dependências:** `npm run doctor` + `docs/instalacao-e-dependencias.md` + seção no README, incluindo a correção do PATH do nvm para as bibliotecas do WebKit.
- **Operação/documentação:** 5 runbooks novos (LGPD, incidente clínico, perda de chave, TLS, disco), runbook de publicação de evidência, crosswalk MEL24→AUD27/MEL23 e reconciliação de contradições documentais.

## 3. Bloqueios atuais

| Bloqueio | Tipo | Responsável | Ação necessária |
|---|---|---|---|
| `AUD27-005` evidence root externo | Externo | Autoridade de release | Rodar o kit no candidato 5 e publicar o pacote ancorado |
| Staging/provedores/registry (`017/021/022`) | Externo | Ricardo + plataforma | Provisionar staging local agora e VPS dedicada depois |
| Carga/caos/DR | Externo | Plataforma | Executar harness local e depois em ambiente equivalente |
| WebKit/AT e skips (`019`) | Humano | QA/Acessibilidade | Justificar os 37 skips e revisar com tecnologia assistiva |
| Qualificação independente (`023/025`) | Humano | Revisor independente | Protocolo selado + parecer ligado ao digest |
| Decisão final (`027`) | Humano | Ricardo | Aprovação explícita após todos os gates |

## 4. Próximos passos

1. **Publicar a evidência externa (você, candidato 5):**
   ```bash
   npx tsx scripts/external-evidence-package.ts \
     --output /caminho/fora/do/repo \
     --authority-id "<sua-autoridade>" \
     --run-anchor \
     --recovery-evidence /caminho/drill-recuperacao.json
   CVG_EVIDENCE_ROOT=/caminho/fora/do/repo npm run verify:aud27-evidence-root
   ```
   Saída esperada: `AUD27_EVIDENCE_ROOT_PASS`; em seguida o AUD27-005 é fechado e 006/015/021/023 destravam.
2. **Provisionar staging local (eu):** PostgreSQL dedicado com roles separadas, secret provider `file`, TLS local, registry local e stack de observabilidade; rodar `verify:staging`, `verify:container-smoke`, `verify:load-local`, `verify:chaos-local` e `verify:dr-local`. VPS depois, com os mesmos templates e endpoints reais.
3. **Justificar os 37 skips (eu):** classificar cada cenário condicional, ajustar configuração/testes quando indevido e registrar a evidência no AUD27-019.
4. **Qualificação independente (você/terceiro):** executar o protocolo de crítica selada sobre o candidato congelado e registrar o parecer com digest.
5. **Decisão de promoção (você):** com todos os gates fechados, registrar a decisão humana no fluxo append-only.

## 5. Staging local e correção do edge — 25/09/2026

O staging local foi provisionado em containers dedicados, fora do repositório: projeto Compose `cvg-staging` com PostgreSQL 18, API, worker, web e proxy TLS self-signed (portas de loopback `18090` HTTP, `18443` HTTPS e `15440` PostgreSQL), secrets sintéticos via provider `file` e certificado local. O sujeito congelado não foi alterado pelo provisionamento.

| Verificação | Resultado |
|---|---|
| `verify:staging` (`CVG_STAGING_URL=https://127.0.0.1:18443`) | PASS em health/readiness/TLS; exit 2 = `PROMOTION BLOCKED` (health/readiness não promovem nada) |
| `verify:container-smoke` | `CONTAINER_EDGE_SMOKE_VERIFIED`: health 200, ready 200, headers verificados, redirect HTTP→HTTPS 308 |
| Cenário autenticado completo | `CONTAINER_SMOKE_INCOMPLETE`: login/write/provider/DeepSeek/shutdown exigem cenário aprovado (externo) |

**Achado corrigido (candidato 7):** a API já emitia os headers de segurança (`x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, CSP) e o proxy TLS os adicionava de novo; o `fetch` combinava as duplicatas (`nosniff, nosniff`) e o próprio gate falhava. O edge agora oculta os headers do upstream com `proxy_hide_header` em `docker/nginx/proxy.tls.conf`, mantendo o proxy como fonte única.

Subir/derrubar o staging local:

```bash
cd <repo>
docker compose --env-file /home/ricardo/cvg-staging/staging.env \
  -f docker-compose.yml -f /home/ricardo/cvg-staging/staging.override.yml \
  -p cvg-staging up -d --no-build
docker compose -p cvg-staging down
```

## 6. Limites

Nenhum resultado local substitui staging, dados reais, autoridade de segredo, provider real, tecnologia assistiva, revisão independente ou decisão humana. Os candidatos 1–6 permanecem históricos e o veredito só muda com os gates acima.
