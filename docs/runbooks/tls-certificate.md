# Runbook — certificado TLS expirado ou inválido no proxy

**Estado:** configuração TLS e overlay de produção versionados; emissão, renovação e autoridade de CA `BLOCKED_EXTERNAL`. Exercício em staging `NOT_RUN` ([staging](../staging.md)).  
**Owner:** infraestrutura/edge. **Abortar se:** a única saída proposta for servir HTTP em claro, desligar HSTS ou colocar chave privada no repositório.

Objetivo: diagnosticar e corrigir certificado expirado, inválido, incompleto (cadeia) ou com nome errado no edge Nginx, validar por HTTPS antes de liberar tráfego e manter rollback para o par anterior.

## 1. Entender o edge

- O overlay de produção publica 80→8080 e 443→8443 e monta os certificados a partir de `CVG_TLS_DIR` (`docker-compose.production.yml:84` a `:90`). O cleartext responde **apenas** com redirect 308 para HTTPS (`docker/nginx/proxy.tls.conf:17`); o servidor TLS escuta em 8443 (`docker/nginx/proxy.tls.conf:21`) com `/etc/nginx/tls/fullchain.pem` e `/etc/nginx/tls/privkey.pem` (`docker/nginx/proxy.tls.conf:25`).
- TLS 1.2/1.3, HSTS e headers de segurança fazem parte do contrato (`docker/nginx/proxy.tls.conf:28` a `:41`). No ambiente local, `docker-compose.yml:273` usa `proxy.conf` **sem** TLS — não confunda os dois.
- Os certificados são montados *out-of-band*; o repositório não contém chave nem certificado, e `CVG_TLS_DIR` precisa ser caminho absoluto sem espaços (`scripts/verify-production.ts:666`). O verificador exige as diretivas e o diretório (`scripts/verify-production.ts:253,259`), mas **não** inicia o proxy nem prova o certificado ([verification-2026-09-10-local-closure](../verification-2026-09-10-local-closure.md)).

## 2. Diagnóstico

1. Sintoma do cliente: erro de certificado/`NET::ERR_CERT_*` no navegador, falha de TLS em integração ou redirect quebrado.
2. Confirme o estado dos containers: `docker compose --env-file "$CVG_ENV_FILE" ps` (padrão de [deploy](deploy.md)).
3. **Cuidado:** o healthcheck do proxy usa `wget --no-check-certificate` (`docker-compose.production.yml:92`). Um proxy `healthy` **não** prova certificado válido — ele só prova que o Nginx responde em 8443.
4. Logs redigidos do edge: `docker compose --env-file "$CVG_ENV_FILE" logs --no-color --timestamps proxy` (padrão de [backup-incidente](backup-incidente.md)); procure erros de leitura de `fullchain.pem`/`privkey.pem`.
5. Renderize a composição sem subir nada e confira portas, mounts e `CVG_TLS_DIR`:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml \
     --env-file "$CVG_ENV_FILE" config --format json
   npm run verify:production
   ```

   O padrão de overlay aparece nos artefatos de prova (ex.: `artifacts/operational-proof/mel23-evidence-matrix.json:762`). `npm run verify:production` é a forma declarada do gate (`package.json`); ele valida a configuração, não o certificado do host.
6. Inspeção do par no host (ferramentas padrão **não** versionadas no repositório — `PROPOSED`): conferir validade, SAN/CN e cadeia com `openssl x509 -in "$CVG_TLS_DIR/fullchain.pem" -noout -dates -subject -ext subjectAltName` e testar o handshake com `openssl s_client -connect <host>:443 -servername <host> -showcerts`.

## 3. Contenção

1. Se existir par anterior válido, restaurá-lo em `CVG_TLS_DIR` é a contenção preferida (ver rollback na seção 6).
2. Não existe fallback para HTTP em claro no overlay de produção (`docker/nginx/proxy.tls.conf:12`). Com certificado inválido, a borda está indisponível: alinhe janela de manutenção com operações e comunique no canal de incidente.
3. Nunca contorne o erro com `--no-check-certificate` em cliente, `curl -k`, HSTS desligado ou `ssl_verify_client off`; isso trata o sintoma e cria exposição.
4. Preserve o par antigo (mesmo expirado) e os logs antes de substituir, para diagnóstico de cadeia/renovação.

## 4. Renovação

1. Emitir/obter o novo par **fora do repositório**, pela CA/autoridade aprovada (`fullchain.pem` com cadeia completa + `privkey.pem`). Guardar a chave privada com permissão restrita, fora do Git e fora de `docker/.env.example`.
2. Publicar no diretório apontado por `CVG_TLS_DIR` (absoluto, sem espaços — `scripts/verify-production.ts:666`). O overlay monta os dois arquivos como somente leitura (`docker-compose.production.yml:89`).
3. Recriar somente o proxy com a composição de produção aprovada. A invocação com o overlay aparece nos artefatos de prova (ex.: `artifacts/operational-proof/mel23-evidence-matrix.json:762`), mas não há script versionado para o reload — passo `PROPOSED`:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.production.yml \
     --env-file "$CVG_ENV_FILE" up -d --force-recreate proxy
   docker compose -f docker-compose.yml -f docker-compose.production.yml \
     --env-file "$CVG_ENV_FILE" ps
   ```

   Como os arquivos são montados `:ro` a partir de `CVG_TLS_DIR`, a recriação garante a releitura do par; `nginx -s reload` dentro do container é alternativa padrão do Nginx, também `PROPOSED` por não estar exercitada no repositório.
4. Se após a recriação o proxy continuar servindo o par antigo, confirmar que não há outro mount/arquivo concorrente antes de repetir a operação.

## 5. Validação

1. `docker compose --env-file "$CVG_ENV_FILE" ps` com proxy e serviços dependentes `healthy`.
2. `npm run verify:production` (structural) verde para configuração/overlay.
3. Smoke de transporte e headers por HTTPS, contra URL autorizada:

   ```bash
   npm run verify:container-smoke -- \
     --url https://<host> \
     --release-sha "$CVG_RELEASE_SHA" \
     --artifact-digest "$CVG_RELEASE_ARTIFACT_DIGEST"
   ```

   O probe mede HTTPS, redirect, health/readiness e headers de segurança (HSTS/CSP/frame/cookies) ([release-provenance](../release-provenance.md)). Sem identidade/cenário aprovados ele encerra `CONTAINER_SMOKE_INCOMPLETE` e não promove o Compose — o que continua sendo `BLOCKED_EXTERNAL`, não PASS.
4. Confirmar manualmente, por ferramenta padrão (`PROPOSED`): validade/SAN, cadeia completa, redirect 80→443 e ausência de HSTS no redirect HTTP.
5. Registrar horário, host, emissor, `notBefore`/`notAfter`, digest do par e responsável pela emissão.

## 6. Rollback

1. Se a validação falhar, restaurar o par anterior (válido) no `CVG_TLS_DIR` e recriar o proxy pela mesma composição de produção (`up -d --force-recreate proxy`), preservando o par novo para diagnóstico.
2. Se o par anterior também estiver expirado, manter a borda indisponível em janela declarada — não habilitar HTTP em claro.
3. Se o rollback reverter a cadeia emissora, revalidar com o smoke e registrar a divergência para a autoridade de CA.
4. Nunca deixar dois pares concorrentes ativos (arquivos com nomes alternativos montados por engano).

## Evidência

- `docker compose ... ps` antes/depois e logs redigidos do proxy;
- saída de `npm run verify:production` e, quando aplicável, do smoke `verify:container-smoke` (ou `CONTAINER_SMOKE_INCOMPLETE` + motivo);
- `openssl x509`/`s_client` do par (datas, SAN, emissor) — ferramenta `PROPOSED`, saída anexada;
- digest `sha256` de `fullchain.pem`/`privkey.pem` (o digest da chave privada não é exposto em canal aberto), caminho de origem e autoridade emissora;
- janela de indisponibilidade, decisão de contenção e quem aprovou;
- registro do rollback, se executado.

## Critérios de encerramento

- [ ] novo par válido (datas, SAN, cadeia) montado em `CVG_TLS_DIR` e aceito pelos serviços;
- [ ] redirect 80→443 e HSTS ativos; nenhum cliente contornando verificação;
- [ ] `verify:production` verde e smoke de transporte executado ou bloqueio externo explícito;
- [ ] monitoramento de expiração definido com antecedência e owner (`PROPOSED`);
- [ ] par antigo arquivado segundo a política de custódia; nenhuma chave no repositório;
- [ ] causa raiz registrada (processo de renovação, automação, cadeia, relógio ou configuração).

## Aprovações pendentes (PROPOSED/UNKNOWN)

- autoridade de CA/ACME e automação de renovação — `BLOCKED_EXTERNAL`;
- alerta de expiração (limiar em dias e canal) — `PROPOSED`;
- comando formal de reload do overlay de produção — `PROPOSED`;
- janela de manutenção e autoridade de indisponibilidade planejada — `BLOCKED_HUMAN`.

## O que NÃO fazer

- Nunca colocar chave privada, `fullchain.pem` ou senha de keystore no repositório, no env file ou em log.
- Nunca montar certificado de diretório não aprovado; o overlay exige `CVG_TLS_DIR` explícito (`docker-compose.production.yml:89`).
- Nunca desligar HSTS, TLS ou verificação para “destravar” — o redirect em claro existe apenas para 308.
- Nunca usar certificado autoassinado ou expirado como definitivo em produção.
- Nunca usar `docker compose down -v` como correção: o problema é certificado, não volume.
- Nunca declarar TLS validado apenas porque o healthcheck do proxy (que usa `--no-check-certificate`) ficou verde.
