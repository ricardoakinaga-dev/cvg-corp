# Prompt de execução Codex — CVG-AUD27

Copie e cole o bloco abaixo em uma nova sessão do Codex aberta na raiz deste repositório.

```text
Você está na raiz do repositório CVG-Corp. Execute integralmente a rodada CVG-AUD27 descrita nestes documentos, nesta ordem de autoridade:

1. docs/auditoria-resultado-cvg-aud27-2026-09-21.md
2. docs/roadmap-melhorias-cvg-aud27-2026-09-21.md
3. docs/backlog-melhorias-cvg-aud27-2026-09-21.md
4. docs/auditoria-resultado-cvg-aud26-2026-09-21.md, somente como evidência histórica
5. .agent/state.json, .agent/backlog.json, .agent/plans/2026-09-21-cvg-aud26.md e .gauntlet/bar-aud26-v1.json, preservando o histórico append-only

Objetivo

Implementar todas as 27 tarefas AUD27, em ordem de dependência, até produzir um candidato limpo, reproduzível e qualificável. O veredito inicial e default é PROMOTION_BLOCKED — AAA_NOT_PROVEN. Ele só pode mudar se todos os gates obrigatórios tiverem prova real, duas qualificações independentes concordarem no mesmo commit/fingerprint e o owner humano aprovar explicitamente.

Autorização e limites

- Você está autorizado a inspecionar e alterar localmente código, testes, scripts, migrations forward-only, configurações e documentação necessários ao backlog.
- Não apague, reverta, sobrescreva ou formate alterações preexistentes que não sejam suas.
- Não use git reset --hard, git checkout --, clean destrutivo ou comandos equivalentes.
- Não faça commit, push, merge, tag, release, deploy, envio de mensagem externa, criação de infraestrutura paga ou uso de credenciais/dados reais sem autorização explícita do usuário.
- Se a tarefa AUD27-004 exigir commit para concluir seu aceite, prepare a árvore e peça autorização para o commit; não simule uma revisão limpa.
- Nenhuma ausência de infraestrutura, segredo, provider, registry, browser/AT ou aprovação humana pode ser inferida como PASS.
- Não altere migrations já aplicadas; crie migrations forward-only.
- Nenhum banco preexistente pode ser removido. Recursos temporários devem ser identificados, isolados e removidos apenas se tiverem sido criados por esta execução.

Método obrigatório

1. Leia integralmente os três documentos AUD27 antes de editar qualquer arquivo.
2. Inspecione AGENTS.md e skills aplicáveis. Use o framework de engenharia para descoberta, especificação, implementação e verificação. Use o Gauntlet somente com barra congelada, artefato real e crítico review-only.
3. Fotografe o estado inicial: HEAD, status Git, inventário tracked/untracked, testes/gates relevantes, estado do control plane e recursos externos existentes.
4. Comece por AUD27-001. Reconcile a rodada AUD26 por eventos append-only. Não edite fatos históricos para fazê-los parecer corretos.
5. Implemente AUD27-002 e AUD27-003 antes de registrar novos DONE. O verificador precisa rejeitar os deslocamentos semânticos conhecidos e distinguir observed, planned, blocked e done.
6. Execute o restante conforme dependências do backlog. Itens XL devem ser quebrados em sub-slices pequenos, reversíveis e testáveis, sem enfraquecer o aceite final.
7. Antes de editar cada área, localize testes, contratos, consumidores e arquivos compartilhados. Evite trabalho paralelo em arquivos sobrepostos.
8. Depois de cada slice, rode testes focados. Nos marcos, rode a regressão proporcional completa e grave evidência focal com comando, exit code, timestamp, ambiente, commit/fingerprint, resultado e artefato.
9. Rebind serve apenas como metadado de identidade. Nunca use SUBJECT_REBIND como substituto da execução comportamental focal.
10. Crie a evidence root externa real prevista em AUD27-005. O gate deve falhar se ela não existir, estiver dentro do repositório, não contiver o pacote ou tiver sido adulterada. Não grave segredos nos recibos.
11. Mantenha a documentação alinhada ao estado real. Qualquer mudança abrangida pelo subject manifest invalida o fingerprint anterior e exige nova qualificação.
12. Antes do freeze final, remova somente artefatos efêmeros criados por você, verifique diff, segredos e dependências, e prepare um candidato versionável. Não declare worktree limpo se houver mudanças pendentes.
13. Execute a dupla qualificação AUD27-025 com pacote selado e revisores fresh-context somente quando o sujeito estiver congelado. Registre identidade/proveniência dos revisores, hashes pre/post e parecer bruto. O crítico não pode alterar o candidato.
14. Se qualquer crítico encontrar falha material, reabra a tarefa relacionada, corrija, gere novo fingerprint e repita a qualificação. Não escolha arbitrariamente o parecer mais favorável.

Ordem executiva

- M0 / AUD27-001–003: verdade e semântica do control plane.
- M1 / AUD27-004–006: candidato e evidência reproduzíveis.
- M2 / AUD27-007–014: 80/80 schemas específicos e 0/32 slices snapshot-primary.
- M3 / AUD27-015–017: imagem real, licenças e supply chain.
- M4 / AUD27-018–020: coverage/mutation, browsers/a11y e modularização.
- M5 / AUD27-021–022: observabilidade, staging, carga, caos e DR.
- M6 / AUD27-023–025: protocolo, documentação e dupla qualificação.
- M7 / AUD27-026–027: gates externos e decisão humana.

Gates mínimos no candidato final

- testes focados e npm test;
- typecheck e lint sem warnings;
- build e verificações estáticas;
- contratos de request/response e catálogo 80/80;
- coverage com ratchet e mutation testing seletivo;
- audit de licenças verde e LICENSE/COPYING de raiz;
- PostgreSQL, migrations, concorrência, role/least privilege, restore e replay;
- zero slice snapshot-primary;
- build/smoke do container real por digest, non-root, health/readiness e shutdown;
- SBOM, scan, imagens pinadas e, quando autorizado, assinatura/proveniência OCI;
- Chromium, Firefox, WebKit, contraste renderizado, teclado, zoom/reflow e AT;
- logs duráveis, SLOs, dashboards, alertas, carga, soak, caos e RTO/RPO em staging autorizado;
- control plane sem divergência semântica;
- evidence root externa validada e duas críticas independentes no mesmo sujeito;
- aprovação humana explícita.

Comunicação durante a execução

- Informe periodicamente o item ativo, mudanças realizadas, testes executados, evidência produzida e bloqueios.
- Para cada blocker, diga exatamente o que falta, quem pode fornecer e qual trabalho independente ainda pode avançar.
- Não pare por dificuldade enquanto houver trabalho local seguro e independente no backlog.
- Peça ao usuário somente decisões que realmente exigem autoridade, credencial, ambiente externo, commit/deploy ou julgamento humano.

Formato de entrega final

1. veredito: PROMOTION_ELIGIBLE ou PROMOTION_BLOCKED, sem linguagem intermediária ambígua;
2. contagem AUD27 por status e lista de qualquer item não concluído;
3. commit e fingerprint exatos do sujeito, ou declaração explícita de que não foi possível congelá-lo;
4. tabela de gates com comando, resultado, ambiente e link de evidência;
5. métricas finais: testes, coverage, mutation score, contratos específicos, slices migrados, browsers, licenças, container e RTO/RPO;
6. riscos residuais e rollback;
7. resultados dos dois críticos independentes;
8. decisão humana, quando fornecida;
9. lista exata dos arquivos alterados e comandos de reprodução.

Comece agora pela inspeção read-only e pela AUD27-001. Preserve toda alteração preexistente e mantenha PROMOTION_BLOCKED até que a barra completa seja objetivamente satisfeita.
```
