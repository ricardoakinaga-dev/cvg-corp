# 14 — Dependências e cadeia de fornecimento

Baseline da auditoria: **85/100**. Meta de planejamento da área: **≥ 95/100**, sem substituir os limiares individuais das dimensões `supplyChain`. Todas precisam da própria evidência.

Resultado executivo: Dependências, SBOM, imagens e proveniência correspondem ao artefato entregue.

Papel líder: **Supply chain**. Achados de origem: A05.

Este arquivo é uma visão do [catálogo](../backlog.json). Status e atribuição real pertencem exclusivamente a `.agent/backlog.json`, após AAA-000. Leia o [protocolo multiagente](../multiagentes.md) antes de executar.

## Roadmap da área

| Marco | Tarefa | Entrega |
|---|---|---|
| M0 | SUP-01 | Padronizar instalação limpa e inventário |
| M2 | SUP-02 | Gerar SBOM e escanear artefatos construídos |
| M5 | SUP-03 | Verificar proveniência e adulteração da promoção |

## Backlog executável

### SUP-01 — Padronizar instalação limpa e inventário

**P1 · S · M0 · R2**. Dependências: AAA-000.

Garantir que todas as provas usem a mesma árvore resolvida, corrigindo A05 sem update indiscriminado.

Entradas e superfície permitida: `package.json`; `package-lock.json`; `apps/*/package.json`; `packages/*/package.json`; `docs/deployment-vNext.md`.

Reservas exclusivas: `dependencies`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- npm ci e npm ls funcionam em checkout novo com Node/npm declarados
- Build usa versões do lockfile; todos os workspaces têm dependências corretas
- Inventário e licença refletem árvore real; nenhuma mudança de versão sem motivo

Validação planejada, ainda não executada para esta melhoria:

- npm ci --ignore-scripts
- npm ls --depth=0
- npm run build
- npm audit --json
- npm run audit:licenses

Artefato esperado: Entrega revisável de SUP-01: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: apoio transversal; não satisfaz isoladamente receipt de promoção.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### SUP-02 — Gerar SBOM e escanear artefatos construídos

**P1 · M · M2 · R2**. Dependências: SUP-01, QUA-03.

Vincular dependências e scan aos bytes finais da API/web e não ao workspace divergente.

Entradas e superfície permitida: `.github/dependabot.yml`; `Dockerfile.api`; `Dockerfile.web`; `scripts/verify-release-provenance.ts`.

Reservas exclusivas: `containers`, `supply-chain`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- SBOM e digests correspondem às imagens executadas
- Scan inclui vulnerabilidades e política de licenças; achados altos/críticos tratados
- Runtime contém somente dependências necessárias; provenance não autodeclara CI não executado

Validação planejada, ainda não executada para esta melhoria:

- npm sbom --sbom-format cyclonedx
- npm run audit:licenses
- Build e scan das imagens pelos comandos fixados no CI

Artefato esperado: Entrega revisável de SUP-02: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F29.

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

### SUP-03 — Verificar proveniência e adulteração da promoção

**P1 · M · M5 · R3**. Dependências: SUP-02, DEV-01, DEV-03.

Rejeitar troca de SHA/imagem/SBOM/receipts entre CI, staging e promoção.

Entradas e superfície permitida: `scripts/verify-release-provenance.ts`; `scripts/verify-promotion-invariant.ts`; `tests/unit/release-provenance.test.ts`; `tests/unit/promotion-invariant.test.ts`.

Reservas exclusivas: `release-provenance`. Caminhos de diretório/glob são teto de escopo; o Lead deve reservar arquivos exatos antes de RUNNING. Demais arquivos exigem ajuste explícito de contrato pelo integrador.

Aceite:

- Mesmo SHA e digests em todos os sujeitos da promoção
- Bundle incompleto/adulterado/symlink/reviewer inválido falha
- Assinaturas e artefatos de execução são verificados, não só existência de campos

Validação planejada, ainda não executada para esta melhoria:

- npm run verify:release-provenance -- --manifest artifacts/release-provenance.json
- npm run verify:promotion-invariant -- --manifest promotion.json
- Testes negativos de troca de sujeito e digests

Artefato esperado: Entrega revisável de SUP-03: diff/decisão, reprodução e manifesto de evidências.

Fases vinculadas: F28, F29, F34.

Pré-requisitos externos/decisões:

- Artefatos reais do CI/staging e autoridade independente de atestação disponíveis

Revisão: crítico de contexto novo inspeciona diff e executa o cenário negativo; o integrador repete a regressão afetada. Não basta o relatório do builder.

Recuperação: registrar checkpoint e recursos criados; desfazer somente alterações próprias ainda não integradas. Migrations publicadas recebem correção forward; efeitos externos desconhecidos exigem reconciliação, não retry cego.

