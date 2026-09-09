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
