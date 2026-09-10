# Visual QA vNext

## Correções aplicadas após crítica fresca

- `REVALIDATING` virou estado bloqueador: conteúdo contextual e composer ficam ocultos durante `/me` + `/contexts`; falha terminal descarta o buffer.
- O botão de fechar menu móvel não é focável no desktop; o seletor de contexto revela foco visível; o anel de foco usa cor sólida; o banner usa texto com contraste revisado.
- O dashboard passa a uma coluna antes da faixa estreita que truncava a agenda.
- A busca rápida navega para Pacientes com filtro e histórico do navegador; Agenda alterna hoje, sete dias e fila por consultas reais.

## Evidência revalidada — 2026-09-09

- Playwright agora declara Chromium, Firefox e WebKit em 375×812, 768×1024 e 1440×1000.
- A inspeção humana dos screenshots renderizados em Chromium confirmou hierarquia, responsividade, ausência de overflow conhecido e estados locais coerentes em desktop/mobile.
- @axe-core/playwright passou em login, dashboard e administração nos seis runs executáveis de Chromium/Firefox e no projeto stress: 8/8 estados auditados.
- A suíte funcional passou com 52 testes e 4 skips intencionais da busca global em viewports móveis; o projeto stress adiciona 320 CSS px, DPR 2, touch, reduced-motion, foco e ausência de overflow horizontal.
- WebKit foi baixado, mas os três projetos WebKit ficaram bloqueados pelas bibliotecas nativas ausentes no host; playwright install-deps webkit não pôde elevar privilégios porque o sudo exige senha. Isso é BLOCKED, não pass.

## Limitações ainda abertas

O audit de contraste continua determinístico para pares declarados, mas agora é complementado por axe em estilos computados do navegador. O projeto stress fornece evidência local de reflow estreito, DPR 2, touch e reduced-motion; leitor de tela, comparação visual por baseline e zoom real de 200% ainda exigem execução específica.

## Fotografia corrente — 2026-09-10

Os seis screenshots nativos do dashboard foram revalidados após o ajuste de mobile em `8395ee5` e permanecem válidos no HEAD `63487af` porque o commit seguinte altera somente API/teste de sessão. Os hashes são: Chromium wide `4b9ad3ada449f643ec5b283cd9a0dc6c3029bef31a7a6476a378086ceca26278`, tablet `34b236770baed501a72ad263e8896a217cb5da38fb0ee7d12381d6b62f2b95af`, mobile `eb0b196e3ee6bcf39875e832bf7433617c3af786a9156ae5ca85bfe5566072cc`; Firefox wide `2eb75295e05389ad34d6d289fa7b400d58e5ad9889ef95b6eb2b47597dbae19b`, tablet `858609c38097cd59a67e204e77aaf958724265ec0d8c7da9ba83d7b480cf7c61`, mobile `d7fdc15d3d1bdecc44a8cc5199e322e74e63262e8f1cacee561e43cf7f856544`.

O E2E atual passou os seis captures, fluxo Chromium/Firefox e stress: `64 pass`, `4 skips` condicionais. A inspeção estática confirma que mobile exibe a primeira linha da agenda dentro do fold e que o mini-gráfico tem caption e `aria-label`. A crítica fresh visual específica deste SHA não devolveu relatório após janelas bounded e foi registrada como `NOT_COMPLETED`; a crítica anterior ao ajuste visual não é usada como aprovação corrente. Foco/teclado, zoom real, leitor de tela, hover, touch interativo, recovery de rede e AAA continuam `NOT_RUN` ou cobertos somente por testes específicos, não por screenshot.

## Achado corrigido — confiança financeira

Uma inspeção read-only de QA identificou que `openCharges` é uma contagem da
API, mas era renderizado como `contagem × R$220`. O dashboard agora rotula o
KPI como `Cobranças em aberto` e mostra a quantidade no contexto. Não existe
mais um valor monetário derivado sem um agregado financeiro real.

Os demais achados do snapshot — loading inicial de sessão, seleção de outro
contexto, foco após navegação SPA, empty states secundários e cobertura visual
de rotas/estados — permanecem backlog; não foram mascarados por esta correção.
