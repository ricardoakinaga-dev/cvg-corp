# Instalação e dependências — CVG-Corp

Este documento registra as dependências exigidas para construir, executar e
verificar o CVG-Corp, com os comandos de instalação e as correções conhecidas.
Valide o ambiente com `npm run doctor`; ele falha (exit 1) quando uma dependência
obrigatória está ausente e apenas avisa nas opcionais.

## Obrigatórias

| Dependência | Versão | Para que serve | Instalação (Ubuntu 24.04 / Mint 22.x) |
|---|---|---|---|
| Node.js | `>=24.20.0 <25` | runtime da API, worker, testes e scripts | via nvm: `nvm install 24.20.0 && nvm use 24.20.0` |
| npm | `>=11.19.0 <12` | workspaces, scripts e gates | `npm install -g npm@11.19.0` |
| Git | qualquer recente | fingerprint de sujeito, worktrees e evidência | `sudo apt-get install -y git` |
| Docker Engine | 24+ | PostgreSQL dos gates, imagens, Compose | `sudo apt-get install -y docker.io` |
| Docker Compose | v2 | stack de produção/observabilidade | `sudo apt-get install -y docker-compose-v2` |
| Docker Buildx | 0.12+ | artefatos OCI, SBOM e proveniência | `sudo apt-get install -y docker-buildx` |
| Browsers Playwright | conforme `playwright` do lockfile | E2E Chromium/Firefox/WebKit + axe | `npx playwright install chromium firefox webkit` |
| Bibliotecas de sistema do Playwright | conforme o host | WebKit e mídia nos testes E2E | `sudo env PATH="$PATH" npx playwright install-deps` |

O `postgres` em si é usado via Docker ou instância dedicada; não é preciso
servidor PostgreSQL no host. As migrations são aplicadas por `npm run db:migrate`
com `DATABASE_URL`/`MIGRATION_DATABASE_URL` fornecidos fora do repositório.

### Correção do PATH do nvm para dependências de sistema

O `sudo` usa um PATH restrito e não encontra `npx` quando o Node vem do nvm.
Use uma das formas:

```bash
sudo env PATH="$PATH" npx playwright install-deps
# ou o caminho absoluto
sudo /home/ricardo/.nvm/versions/node/v24.20.0/bin/npx playwright install-deps
# fallback por lista explícita de pacotes
npx playwright install-deps --dry-run   # lista as dependências ausentes
sudo apt-get update && sudo apt-get install -y <pacotes>
```

No Mint 22.3 o Playwright avisa que o SO não é oficialmente suportado e usa o
fallback `ubuntu24.04-x64`; os nomes de pacote são compatíveis.

## Opcionais

| Dependência | Para que serve | Instalação |
|---|---|---|
| k6 | `npm run verify:load` e carga local | https://grafana.com/docs/k6/latest/set-up/install-k6/ |
| psql | operações manuais e runbooks de banco/restore | `sudo apt-get install -y postgresql-client` |
| openssl | TLS local e inspeção de certificados | `sudo apt-get install -y openssl` |

## Passo a passo de instalação

```bash
git clone <repo> && cd cvg-corp
nvm install 24.20.0 && nvm use 24.20.0
npm ci
npx playwright install chromium firefox webkit
sudo env PATH="$PATH" npx playwright install-deps
npm run doctor
npm run bootstrap
npm run dev
```

## Execução e verificação

- Demonstração em memória (sem dependências externas): `npm run dev` e abra
  `http://127.0.0.1:5173`.
- Suíte e gates locais: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run verify:static`.
- PostgreSQL descartável (Docker): `npm run verify:ephemeral-postgres -- --rounds=1 --run-postgres`.
- E2E completo (12 projetos): `npm run test:e2e`.

## VPS dedicada (quando migrar)

A mesma lista vale para a VPS; adicionalmente provisione certificado TLS
válido, firewall/egress, PostgreSQL dedicado com roles de migração/runtime e a
autoridade de segredos. O procedimento de evidência externa está em
[`runbooks/external-evidence-package.md`](runbooks/external-evidence-package.md).
