# Proveniência — DeepSeek Harness (terceiro)

**Status:** REGISTRADA em 2026-09-16, antes de qualquer incorporação de código.
**Decisão relacionada:** `HYBRID` em
[`docs/adr/ADR-agent-runtime-embedding-decision.md`](../adr/ADR-agent-runtime-embedding-decision.md).

## 1. Identificação

| Campo | Valor |
| --- | --- |
| Repositório upstream | `https://github.com/deepseek-ai/deepseek-harness.git` (remote `deepseek-official` no clone local) |
| Clone local auditado | `/home/ricardo/deepseek-harness` |
| Commit | `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (`5dda764ed3`) |
| Release | `dsh 0.1.5-alpha.1` |
| Data da auditoria | 2026-09-16 |
| Licença raiz | MIT — `Copyright (c) 2026 DeepSeek` |
| Licença por pacote | 267 manifests em `packages/*/*` declaram `"license": "MIT"` |
| Avisos de terceiros | `THIRD_PARTY_NOTICES.md` (gerado por `scripts/gen-third-party-notices.ts`) |
| Código vendorizado no upstream | `vendor/` (9 pacotes Cordis, MIT, com `LICENSE` preservado e log de 19 modificações locais) |

## 2. Código incorporado ao CVG-Corp

**Nenhum.** A decisão arquitetural foi `HYBRID` com `REIMPLEMENT/ADAPT` dos conceitos, conforme
o princípio "reuse the ideas, not necessarily the files" (item 360 do prompt). A implementação
embarcada é autoral do CVG-Corp; não há arquivos, trechos, nomes de classe ou estruturas de dados
copiados do upstream.

Consequências:

- a obrigação MIT de preservar copyright/NOTICE **não é acionada** por incorporação de código
  (não há código de terceiro no produto);
- não é necessário manter `NOTICE` de código embarcado; permanece o registro documental desta
  auditoria e do commit de referência;
- qualquer trabalho futuro que pretenda incorporar arquivos upstream exige nova revisão de
  licença, geração de `NOTICE` e gate de licenciamento (item 40) antes de Phase C.

## 3. Dependências de terceiros

O CVG-Corp **não adicionou** dependências do upstream. As dependências usadas pelas novas
camadas são as já presentes no repositório (`zod`, `pg`, `node:*`). O runtime externo do
harness, quando acionado como processo separado (`external`), é operado como produto de
terceiro, não redistribuído.

Licenças relevantes observadas no ecossistema upstream, mantidas como referência de vigilância:

| Dependência upstream | Licença observada |
| --- | --- |
| `@agentclientprotocol/sdk` | Apache-2.0 |
| `@anthropic-ai/claude-agent-sdk` | "SEE LICENSE IN README.md" |
| `@openai/codex` | própria do fornecedor |
| demais dependências diretas listadas em `THIRD_PARTY_NOTICES.md` | MIT |

## 4. Auditoria de licença do CVG

`npm run audit:licenses` permanece o gate de licenças do repositório. Nenhuma nova dependência
foi introduzida para o runtime embarcado.

## 5. Revisão de segurança da fonte

- A worktree do clone local estava *dirty* (modificações não commitadas em docs e
  `packages/shell/tool-bash-persistent` / `tool-pwsh-persistent`); a referência é o commit
  `5dda764ed3`.
- O upstream documenta que o runner dinâmico de plugins (`node:vm`) **não é boundary de
  segurança** e que presets são configuração confiável. Nada disso foi adotado.
- Nenhum scanner de CVE foi executado sobre o upstream nesta auditoria. Para o runtime externo,
  a vigilância segue o processo de [third-party security watch](../agent-runtime-security-review.md).
- Não há CVE conhecido avaliado nesta fase; a afirmação "sem CVE" seria overclaim e não é feita.

## 6. Acompanhamento

Ver [`docs/third-party/deepseek-harness-upstream.md`](deepseek-harness-upstream.md) para o
registro de commits, procedimento de diff e política de atualização (nunca *blind update*).
