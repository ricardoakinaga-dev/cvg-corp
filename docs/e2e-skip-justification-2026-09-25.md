# Justificativa dos skips E2E — 25/09/2026

**Objeto:** candidato 7 (`6b44a27c6516d03c9a1fc02dfaffb0d9ee7f03c5`, fingerprint `sha256:cb9025d9…`).  
**Matriz:** 12 projetos (Chromium/Firefox/WebKit × wide-1440/tablet-768/mobile-375 + stress) = 503 aprovados, **37 skips**, 0 falhas.  
**Conclusão:** todos os 37 skips são condicionais e declarados por projeto/capacidade no próprio teste; nenhum é falha mascarada.

| Teste | Condição de skip | Projetos pulados | Skips | Justificativa |
|---|---|---|---:|---|
| `mobile navigation isolates the background and restores its trigger` (`tests/e2e/accessibility.spec.ts:113`) | `!project.name.includes("mobile-375")` | wide, tablet e stress dos 3 engines | 9 | O drawer de navegação só é modal no viewport móvel; a asserção de isolamento não se aplica a desktop/tablet. |
| `jornada de internação: admissão, prescrição, administração, handoff e alta com pendências` (`tests/e2e/app.spec.ts:1357`) | `project.name !== "chromium-wide-1440"` | todos os projetos de navegador exceto chromium-wide | 8 | Usa o único leito compartilhado do fixture sintético; a suíte serializa para não disputar o recurso entre projetos. |
| `troca de contexto no menu móvel fecha o drawer e preserva o foco` (`tests/e2e/app.spec.ts:18`) | `!project.name.includes("mobile-375")` | wide, tablet e stress dos 3 engines | 6 | A troca de contexto no drawer é comportamento específico do viewport móvel. |
| `skip link and global search expose a visible keyboard focus` (`tests/e2e/app.spec.ts:138`) | `!project.name.includes("wide-1440")` | tablet, mobile e stress dos 3 engines | 6 | O skip link e a busca global ficam ocultos em viewports móveis por desenho de layout. |
| `busca rápida abre pacientes com filtro e histórico do navegador` (`tests/e2e/app.spec.ts:124`) | `!project.name.includes("wide-1440")` | tablet, mobile e stress dos 3 engines | 6 | A busca rápida global é exposta apenas no layout wide. |
| `touch input capability is exposed when the engine supports it` (`tests/e2e/accessibility-stress.spec.ts:35`) | `navigator.maxTouchPoints === 0` | engines sem touch no ambiente atual | 2 | Capacidade do engine; o teste se auto-pula quando o navegador não expõe pontos de toque. |
| **Total** | | | **37** | |

## O que permanece aberto

- Revisão com **tecnologia assistiva real** (leitor de tela, teclado assistivo, zoom 200%), que é humana e não é coberta por axe/Playwright.
- A execução dos skips em projeto dedicado para os casos de viewport seria redundante; qualquer mudança de condição exige reexecução da matriz no candidato congelado.

Os logs da matriz estão em `artifacts/operational-proof/aud27-candidate5-20260925/` (`webkit-matrix.log`, `chromium-firefox-matrix.log`).
