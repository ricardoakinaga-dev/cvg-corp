# Visual QA vNext

## Correções aplicadas após crítica fresca

- `REVALIDATING` virou estado bloqueador: conteúdo contextual e composer ficam ocultos durante `/me` + `/contexts`; falha terminal descarta o buffer.
- O botão de fechar menu móvel não é focável no desktop; o seletor de contexto revela foco visível; o anel de foco usa cor sólida; o banner usa texto com contraste revisado.
- O dashboard passa a uma coluna antes da faixa estreita que truncava a agenda.
- A busca rápida navega para Pacientes com filtro e histórico do navegador; Agenda alterna hoje, sete dias e fila por consultas reais.

## Limitações ainda abertas

Playwright continua Chromium-only no workspace; Firefox/WebKit, axe/equivalente, DPR/touch, leitor de tela, comparação visual por baseline e inspeção humana ainda exigem execução dedicada. O audit de contraste é determinístico para pares declarados, não substitui estilos computados do navegador.
