# 50 melhorias priorizadas — 23/09/2026

**Origem:** [auditoria do repositório](./auditoria-repositorio-2026-09-23.md).  
**Estado:** propostas para reconciliação com o programa AUD27 em curso; esta lista não marca tarefas como concluídas nem altera `.agent`.  
**Execução:** [plano](./plano-executivo-2026-09-23.md), [roadmap](./roadmap-2026-09-23.md) e [backlog com aceite](./backlog-2026-09-23.md).

## Alta prioridade — 20

1. **MEL23-001:** Reconciliar ponteiros de `.agent/state.json` com as caudas dos ledgers.
2. **MEL23-002:** Corrigir o teste `missing_transition` para alterar o evento efetivamente validado.
3. **MEL23-003:** Deixar `npm test` integralmente verde no candidato atual.
4. **MEL23-004:** Consolidar alterações em revisão Git limpa e reproduzível.
5. **MEL23-005:** Recalcular o fingerprint após consolidar o candidato.
6. **MEL23-006:** Vincular a raiz externa de evidências ao fingerprint exato.
7. **MEL23-007:** Proteger o pacote de evidências contra alteração silenciosa e reproduzir hashes em outro checkout.
8. **MEL23-008:** Migrar as 24 coleções `SNAPSHOT_PRIMARY` para comandos autoritativos.
9. **MEL23-009:** Comprovar backfill e paridade de cada coleção migrada.
10. **MEL23-010:** Testar concorrência, replay e idempotência de cada novo caminho de escrita.
11. **MEL23-011:** Comprovar rollback de cada cutover antes de retirar fallback por snapshot.
12. **MEL23-012:** Reexecutar restore sobre o modelo final após os cutovers.
13. **MEL23-013:** Resolver as 10 dependências rejeitadas pela política de licenças.
14. **MEL23-014:** Adicionar `LICENSE` ou `COPYING` de raiz conforme decisão do responsável.
15. **MEL23-015:** Executar smoke da imagem real com health, privilégio mínimo, persistência e shutdown.
16. **MEL23-016:** Vincular SBOM, scan e proveniência OCI às imagens candidatas.
17. **MEL23-017:** Qualificar segredos, autenticação e revogação em staging autorizado.
18. **MEL23-018:** Validar provedores e DeepSeek reais, incluindo receipts e reconciliação.
19. **MEL23-019:** Medir restore, RTO e RPO em infraestrutura equivalente.
20. **MEL23-020:** Obter revisão independente e aprovação humana para o mesmo candidato.

## Média prioridade — 20

21. **MEL23-021:** Verificar respostas reais das 105 rotas contra seus schemas.
22. **MEL23-022:** Testar campos sensíveis, payload excessivo e respostas inválidas por família de API.
23. **MEL23-023:** Repetir isolamento organizacional e de workspace em PostgreSQL após cada onda.
24. **MEL23-024:** Testar crash e retomada entre commit, checkpoint e receipt.
25. **MEL23-025:** Definir metas de cobertura por áreas clínicas, financeiras, autorização e persistência.
26. **MEL23-026:** Ampliar mutation testing para regras críticas.
27. **MEL23-027:** Executar a matriz E2E completa na CI e reproduzir falhas intermitentes.
28. **MEL23-028:** Qualificar WebKit em ambiente suportado.
29. **MEL23-029:** Testar contraste renderizado, zoom, reflow e teclado.
30. **MEL23-030:** Avaliar fluxos prioritários com tecnologia assistiva.
31. **MEL23-031:** Extrair responsabilidades coesas de `packages/persistence/src/index.ts`.
32. **MEL23-032:** Dividir `apps/api/src/app.ts` por rotas e serviços.
33. **MEL23-033:** Reduzir acoplamento dos arquivos centrais de domínio e contratos.
34. **MEL23-034:** Testar backpressure e recuperação do worker sob carga sustentada.
35. **MEL23-035:** Exercitar timeout, resposta perdida e resultado desconhecido em integrações.
36. **MEL23-036:** Medir SLOs com tráfego representativo e aprovar metas.
37. **MEL23-037:** Validar entrega de alertas, retenção de logs e perda de telemetria.
38. **MEL23-038:** Ensaiar carga e caos em staging com critérios de parada.
39. **MEL23-039:** Revisar permissões e isolamento do Compose junto das imagens finais.
40. **MEL23-040:** Automatizar rastreabilidade requisito → teste → recibo → fingerprint.

## Baixa prioridade — 10

41. **MEL23-041:** Atualizar o estado corrente de `docs/README.md`.
42. **MEL23-042:** Corrigir afirmações vencidas em `12-estado-da-implementacao.md`.
43. **MEL23-043:** Marcar `production-readiness-vNext.md` como histórico ou atualizá-lo.
44. **MEL23-044:** Resolver a numeração duplicada de ADR 036 e ajustar links.
45. **MEL23-045:** Separar estado atual de relatórios históricos nos índices.
46. **MEL23-046:** Padronizar nomes e status de evidências entre docs, backlog e `.agent`.
47. **MEL23-047:** Incluir exemplos de requisição, resposta e erro nos contratos principais.
48. **MEL23-048:** Melhorar o guia de contribuição com checks por área.
49. **MEL23-049:** Registrar cutovers e mudanças de contrato por versão no changelog.
50. **MEL23-050:** Automatizar checagem de links, IDs de ADR e referências removidas.

As prioridades indicam risco e ordem de atenção; não significam que toda ação de baixa prioridade deva aguardar o fim de todas as demais. O [backlog](./backlog-2026-09-23.md) define dependências e prova de aceite para cada ID.
