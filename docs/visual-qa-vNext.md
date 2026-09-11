# Visual QA vNext

Fotografia corrente: a matriz local combinada executou 153 casos, com 124 pass, 29 skips condicionais e zero falhas em Chromium, Firefox, WebKit e stress. Leitor de tela, teclado assistivo, zoom real de 200% e baseline visual independente continuam sem execução.

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
- A execução padrão ainda encontra dependências nativas WebKit ausentes no host. Para obter prova sem alterar o sistema, um prefixo temporário recebeu as bibliotecas Ubuntu `libgstreamer-plugins-bad1.0-0`, `libavif16`, `libgav1-1` e `libyuv0`, e o wrapper do binário Playwright foi apontado explicitamente para esse prefixo. A matriz completa executou 102 casos com 96 pass e 6 skips condicionais; isso é evidência local do browser real, não staging.

## Limitações ainda abertas

O audit de contraste continua determinístico para pares declarados, mas agora é complementado por axe em estilos computados do navegador. O projeto stress fornece evidência local de reflow estreito, DPR 2, touch e reduced-motion; leitor de tela, comparação visual por baseline e zoom real de 200% ainda exigem execução específica.

## Fotografia anterior — 2026-09-10

Os screenshots nativos do dashboard foram revalidados no checkout atual `e43b3b0032aafb9d17563b1fce00fbae88ee0d51` com worktree modificado. Os hashes observados são: Chromium wide `7181e851edbda63db97230a7d6c350051b8913b6bdc5db99f3a7b0f4eeeafc77`, tablet `b40f7becea02affc3bcdba803ed6ebdf4ef8f9d91619542ba60cbe9fa4aec0ee`, mobile `44faeefbec87ad8ff84b0355482c1709b725393850a0260d25b4e838aab2c436`; Firefox wide `a3c9093f0cac1481176881de5b5f350168d7ac6db9800880653422f0fd1877f7`, tablet `e2a81468eb08c958ebfcbb6913a8a9aa9dd74cc273dcb79c0061937fd5ba803a`, mobile `7f88262847f631b2d18840e1a979b3a8247de961afd3b2806b5526e71adc36e9`; WebKit wide `ddd0aa8c81831567deaa9196fcf14d9a220f96226dfb01719c7e27757d9ef79c`, tablet `d8ced283b1921b41ae88bdbfcfa412b15c1033c183e32058ff22d10d3c40398c`, mobile `0fceaceb2e42d5df9ea5a5a634bafc1e8d31c7911701467cef25967acdcf2d9a`.

O E2E completo reexecutado com o prefixo local passou Chromium/Firefox/WebKit e stress: `96 pass`, `6 skips` condicionais. A inspeção estática confirma que mobile exibe a primeira linha da agenda dentro do fold e que o mini-gráfico tem caption e `aria-label`. A crítica fresh visual específica deste SHA não devolveu relatório após janelas bounded e foi registrada como `NOT_COMPLETED`; a crítica anterior ao ajuste visual não é usada como aprovação corrente. Foco/teclado assistivo, zoom real, leitor de tela, hover, touch interativo, recovery de rede e AAA continuam `NOT_RUN` ou cobertos somente por testes específicos, não por screenshot.

## Achado corrigido — confiança financeira

Uma inspeção read-only de QA identificou que `openCharges` é uma contagem da
API, mas era renderizado como `contagem × R$220`. O dashboard agora rotula o
KPI como `Cobranças em aberto` e mostra a quantidade no contexto. Não existe
mais um valor monetário derivado sem um agregado financeiro real.

Os achados de empty states secundários e cobertura visual de rotas/estados
permanecem backlog; não foram mascarados pelas correções abaixo.

## Correções de estado e navegação — 2026-09-10

- A aplicação agora mantém uma tela explícita de validação enquanto `/me` e
  `/contexts` resolvem, evitando o flash de login para uma sessão que ainda
  não foi confirmada.
- O estado `PERMISSION_DENIED` expõe os contextos autorizados disponíveis para
  troca e revalidação, quando houver mais de um, em vez de prometer uma ação
  de contexto alternativo inexistente.
- A navegação SPA move o foco para o `main` da nova rota; no mobile, selecionar
  uma rota fecha o menu sem roubar esse foco de volta para o botão de abertura.
- O teste de rotas verifica explicitamente foco no conteúdo e ausência de
  overflow nos seis projetos Chromium/Firefox executáveis.

Evidência: typecheck e lint passaram; `PLAYWRIGHT_BROWSERS_PATH=<prefixo-temporário> npx playwright test` passou 102 casos, com 96 pass e 6 skips condicionais intencionais. WebKit agora tem execução local auditável; leitor de tela, zoom real de 200%, baseline visual e operação de contexto autorizado continuam fora da evidência executável.

## Execução corrente — 2026-09-11

A matriz local combinada executou 153 casos: 124 pass, 29 skips condicionais e zero falhas em Chromium/Firefox/WebKit wide/tablet/mobile e stress. O comando bounded CI cobriu 75 casos em Chromium/Firefox; uma execução WebKit autorizada com prefixo de bibliotecas no espaço do usuário cobriu mais 42 casos (36 pass, 6 skips). Leitor de tela, assistive tech, zoom real de 200% e baseline visual independente permanecem fora da prova. O artefato atualizado é browser-matrix-local-2026-09-10.json.

## Revalidação da matriz corrente — 2026-09-11

A matriz browser corrente registrada no artifact é de 153 casos: 124 pass, 29 skips condicionais e zero falhas em Chromium, Firefox, WebKit e stress. Os skips refletem capacidades ausentes do engine/host; leitor de tela, assistive tech, zoom real de 200% e baseline visual independente continuam sem execução.

## Revalidação de ambiente — VER-CVG-258 — 2026-09-11

O último run completo positivo permanece o prefixo de bibliotecas de usuário: 153 casos, 124 pass, 29 skips e zero falhas. A tentativa host-native posterior foi bloqueada no lançamento do WebKit pela biblioteca `libgstcodecparsers-1.0.so.0` ausente (51 casos WebKit bloqueados; 83 pass e 19 skips nos demais projetos). Isso é uma limitação de ambiente registrada no artifact, não uma aprovação visual independente. Baseline visual, zoom real e avaliação assistiva continuam pendentes.

## Revalidação de qualidade — VER-CVG-259 — 2026-09-11

A matriz visual registrada permanece em 153 casos (124 pass, 29 skips, zero falhas) no prefixo de bibliotecas de usuário. A tentativa host-native não conseguiu iniciar 51 casos WebKit pela dependência `libgstcodecparsers-1.0.so.0` ausente no host; o artifact preserva a distinção. Baseline visual independente, zoom real, assistive tech e touch fora do Chromium continuam gates pendentes.

## Fotografia final — VER-CVG-260 — 2026-09-11

O snapshot final referencia a matriz local 153/124/29/0 com prefixo de usuário e preserva o bloqueio host-native de 51 casos WebKit pela dependência ausente. Não há aprovação visual independente, zoom real, assistive tech ou touch fora do Chromium.
