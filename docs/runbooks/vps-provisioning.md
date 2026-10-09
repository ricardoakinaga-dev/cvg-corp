# Runbook — provisionar a VPS de produção

**Objetivo:** replicar o staging local validado numa VPS dedicada, com TLS real,
segredos externos e os mesmos gates de aceite. O script `vps-bootstrap.ts`
valida os insumos e executa o Compose de produção; ele nunca gera segredos.

## Requisitos da VPS

| Item | Mínimo | Recomendado |
|---|---|---|
| SO | Ubuntu 24.04 | Ubuntu 24.04 LTS atualizado |
| vCPU | 4 | 8 |
| RAM | 16 GB | 32 GB |
| Disco | 200 GB NVMe | 400 GB NVMe + backup externo |
| Rede | 1 IPv4, portas 22/80/443 | firewall restrito por origem, egress controlado |
| Docker | Engine 24+, Compose v2, Buildx | versões pinadas da CI |
| DNS/TLS | domínio apontado para a VPS | Let's Encrypt com renovação automática |

## Passos

1. Instale Docker Engine, Compose v2 e Buildx; crie o usuário de deploy não-root
   no grupo `docker` e restrinja SSH a chave.
2. Clone o repositório e faça checkout do commit auditado (`CVG_RELEASE_SHA`).
   `npm ci` e `npx playwright install --with-deps` se a VPS também for rodar E2E.
3. Provisione os insumos **fora do repositório**:
   - arquivo de ambiente com as chaves exigidas (ver `docker/.env.example` e a
     lista do script);
   - diretório TLS com `fullchain.pem` e `privkey.pem` (Let's Encrypt);
   - segredos Docker externos (`cvg-deepseek-bearer`, `cvg-deepseek-context`,
     `cvg-recovery-key`, `cvg-messaging-credential`) ou a autoridade de segredo
     aprovada;
   - destino de backup com retenção e criptografia.
4. Valide e aplique:
   ```bash
   npx tsx scripts/vps-bootstrap.ts --env-file /caminho/absoluto/fora/do/repo/prod.env
   npx tsx scripts/vps-bootstrap.ts --env-file /caminho/absoluto/fora/do/repo/prod.env --apply
   ```
   Esperado: `VPS_CHECK_PASS` seguido de `VPS_DEPLOY_APPLIED`.
5. Aceite na VPS (mesmo candidato):
   ```bash
   CVG_STAGING_URL=https://<dominio> npm run verify:staging
   npm run verify:container-smoke -- --url https://<dominio> --http-url http://<dominio> \
     --release-sha "$CVG_RELEASE_SHA" --artifact-digest "$CVG_RELEASE_ARTIFACT_DIGEST"
   ```
6. Reemita o pacote de evidência externo **na VPS** (âncora fisicamente separada):
   ```bash
   npx tsx scripts/external-evidence-package.ts --output /srv/cvg/evidence \
     --authority-id "<autoridade>" --run-anchor --recovery-evidence <drill>
   ```
7. Registre os recibos no fluxo append-only e atualize o relatório parcial.

## O que NÃO fazer

- Não usar senhas sintéticas do staging local na VPS.
- Não expor PostgreSQL ou o registry à internet; publique apenas 80/443.
- Não pular o teste de adulteração do pacote externo nem o drill de restore.
- Não promover sem os gates externos, a qualificação independente e a decisão humana.

## Critérios de saída

- `VPS_CHECK_PASS` + `VPS_DEPLOY_APPLIED`.
- `verify:staging` e `verify:container-smoke` verdes contra o domínio real.
- Pacote externo reemitido com `AUD27_EVIDENCE_ROOT_PASS` e adulteração rejeitada.
- Recibos ligados ao mesmo fingerprint do candidato implantado.
