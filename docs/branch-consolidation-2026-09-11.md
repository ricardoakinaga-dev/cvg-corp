# Consolidação de branches — 2026-09-11

Escopo: revisar as cinco branches remotas do Dependabot e manter `main` como
única branch no GitHub. Base examinada: `e43b3b0032aafb9d17563b1fce00fbae88ee0d51`.
As alterações não commitadas da cópia de trabalho existente não fazem parte
desta consolidação e foram preservadas. Não houve mudança de regras clínicas,
API, banco de dados ou implantação de produção.

## Decisões

| PR | Proposta | Decisão e evidência |
| --- | --- | --- |
| #2 | Vite 8.2.2 | Incorporada a faixa `^8.2.2` nos dois manifests; o lockfile resolveu Vite 8.3.0, versão efetivamente testada. |
| #4 | Plugin React 6.1.1 | Incorporada junto com Vite 8, mantendo uma única versão deduplicada entre raiz e workspace web. |
| #6 | TypeScript 7.0.2 | Descartada nesta consolidação: a branch falha em `npm run typecheck` com TS5102 (`baseUrl` removido) e TS5090 (aliases não relativos). A migração exige adaptação própria. Mantido TypeScript 5.9.3 no lockfile. |
| #5 | Imagem Node 26 | Descartada nesta consolidação: altera somente Dockerfiles, deixando CI em Node 24.20.0. Mantida a versão comum já validada. Não foi alegada falha de execução do Node 26. |
| #3 | Tipos Node 26 | Descartada para manter os tipos alinhados ao runtime Node 24. Mantido `@types/node` 24.13.3 no lockfile. |

Os cinco PRs tinham checks com falha na consulta inicial; isso foi tratado como
evidência histórica, não como diagnóstico individual da causa.

## Verificação da combinação selecionada

Ambiente isolado: Node 24.20.0, npm 11.19.0. Critérios: instalação reproduzível,
tipagem e build válidos, nenhuma regressão na suíte existente, navegação desktop
e mobile funcional e histórico recuperável antes de excluir branches.

- Base: `npm ci --ignore-scripts`, typecheck e testes; 171 passaram, 1 ignorado.
- Candidata: `npm ci --ignore-scripts` e `npm run verify:m1` passaram; 171 testes
  passaram, 1 ignorado, build e verificações de PDP e estrutura passaram.
- `npm run lint`, `npm run audit:licenses`, `npm audit` e `git diff --check`
  passaram. Nenhuma vulnerabilidade reportada pelo npm.
- Playwright Chromium desktop 1440 e mobile 375: 21 passaram, 1 ignorado.
- Revisão separada do diff: alterações restritas aos manifests e lockfile de
  ferramentas frontend; dependências de aplicação preservadas. Revisão feita
  pelo mesmo agente, sem alegação de revisão independente.

Limites: não foi executada nesta consolidação a matriz completa de browsers,
o gate PostgreSQL real ou o build/scan de containers. Os testes ignorados
continuam explicitamente ignorados. Estes resultados não certificam produção.

## Recuperação e manutenção

Antes da consolidação foi criado e validado um bundle completo, fora do
repositório, contendo `main` e todas as cinco referências originais. O caminho
local é informado na entrega ao mantenedor. `git clone CAMINHO_DO_BUNDLE DESTINO`
permite inspecionar o histórico preservado; `git bundle list-heads` lista as
referências originais.

O push de `main` deve ser fast-forward. As exclusões devem usar os SHAs
examinados como leases, impedindo apagar alterações concorrentes. O Dependabot
continua habilitado e poderá criar novas branches para atualizações futuras.
