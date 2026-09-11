# Prova de browser e acessibilidade

Status: `PARTIAL_ASSISTIVE`.

Playwright/axe cobrem Chromium, Firefox e WebKit nos viewports versionados, com estados de autorização, reconnect e reduced motion presentes. A fotografia local corrente cobre 153 casos, com 124 pass, 29 skips condicionais e zero falhas; WebKit foi executado com o binário real e um prefixo temporário de bibliotecas Ubuntu extraídas sem alterar o sistema. A suíte de stress agora verifica navegação por teclado, foco visível, anúncio `role=status` e um suplemento automatizado de reflow em CSS zoom 200%; isso não substitui leitor de tela, teclado manual assistivo, foco auditado por tecnologia assistiva ou zoom real de 200%, que continuam sem execução independente.

Evidência: [`artifacts/operational-proof/browser-matrix-local-2026-09-10.json`](../artifacts/operational-proof/browser-matrix-local-2026-09-10.json). A suíte padrão ainda falha fechado neste host quando o prefixo não é fornecido, pois o sistema não possui as dependências WebKit; isso não foi convertido em skip silencioso.

## Revalidação — 2026-09-11

A matriz local atualizada cobre 153 casos (124 pass, 29 skips, zero falhas), conforme o artifact browser. Essa execução não substitui leitor de tela, teclado assistivo manual, avaliação por tecnologia assistiva ou zoom real de 200%; esses gates continuam pendentes.

## Revalidação de ambiente — VER-CVG-258 — 2026-09-11

A matriz Playwright registrada continua sendo o último run completo bem-sucedido com prefixo de bibliotecas no espaço do usuário (153 casos, 124 pass, 29 skips, zero falhas). Uma tentativa posterior de `npm run test:e2e:full` no host nativo executou 153 casos, mas 51 projetos WebKit foram bloqueados antes do teste por `libgstcodecparsers-1.0.so.0` ausente; os demais projetos tiveram 83 pass e 19 skips. O artifact registra ambas as observações e mantém a limitação explícita. Leitor de tela, revisão assistiva independente, zoom real de 200% e baseline visual continuam sem prova.

## Revalidação de qualidade — VER-CVG-259 — 2026-09-11

O artifact browser permanece byte-bound ao snapshot atual: 153 casos, 124 pass, 29 skips e zero falhas no run com prefixo de bibliotecas de usuário. O host-native `npm run test:e2e:full` continua limitado por `libgstcodecparsers-1.0.so.0` ausente, com 51 lançamentos WebKit bloqueados. Leitor de tela, avaliação assistiva independente, zoom real de 200%, baseline visual e touch fora do Chromium continuam sem prova.

## Fotografia final — VER-CVG-260 — 2026-09-11

O artifact browser vinculado ao snapshot final mantém 153 casos, 124 pass, 29 skips e zero falhas no prefixo de bibliotecas de usuário. A tentativa host-native bloqueou 51 lançamentos WebKit por `libgstcodecparsers-1.0.so.0`; revisão assistiva independente, zoom real, baseline visual e touch fora do Chromium seguem pendentes.
