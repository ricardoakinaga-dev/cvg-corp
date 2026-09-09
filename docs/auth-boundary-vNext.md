# Boundary de autenticação vNext

**Estado:** `LOCAL_EVIDENCED` / produção `NOT_READY`.

Esta boundary separa credencial, desafio, sessão, dispositivo e recuperação do restante do domínio. O recorte local é provider-neutral: nenhum segredo real, SMS, e-mail, secret manager ou sessão distribuída foi acionado.

## Fluxos protegidos

- A senha é validada por política explícita (12–256 caracteres no padrão local, classes mista e rejeição do identificador) e o digest nunca atravessa a resposta pública.
- Login com MFA obrigatório valida a senha e cria somente um desafio expirável, de uso único e sem sessão autenticada; o TOTP é resolvido por referência (`mfaSecretRef`) e verificado com janela limitada.
- Tentativas inválidas têm limite por conta e por origem local; o estado de lockout é durável no usuário e a resposta de conta bloqueada permanece genérica para evitar enumeração.
- Rotação de senha incrementa `credentialVersion` e revoga todas as sessões anteriores. Sessões carregam somente digests de dispositivo, user-agent e IP, timestamp de atividade, confirmação MFA e versão da credencial.
- Recuperação devolve a mesma forma de resposta para usuário conhecido ou desconhecido, consome o desafio e o código de recuperação uma única vez, gira a credencial e abre uma sessão marcada como recuperada/MFA.
- Listagem e revogação de sessões são escopadas ao próprio usuário, com CSRF nas mutações e auditoria em cada decisão.

## Durabilidade e configuração

A migration aditiva `db/migrations/020_auth_security_boundary.sql` adiciona o estado de segurança aos usuários/sessões e cria `auth_challenges` com FK organizacional, RLS forçado, expiração, tentativas e versão de credencial. O parser de configuração exige MFA, rotação e host não-loopback em `production`; se MFA for `required` sem resolver aprovado, o runtime falha fechado na inicialização.

Variáveis relevantes: `CVG_AUTH_MFA_MODE`, `CVG_PASSWORD_MIN_LENGTH`, `CVG_PASSWORD_MAX_AGE_DAYS`, `CVG_AUTH_MAX_FAILED_ATTEMPTS`, `CVG_AUTH_LOCKOUT_MINUTES`, `CVG_AUTH_CHALLENGE_TTL_SECONDS` e `CVG_AUTH_MAX_CHALLENGE_ATTEMPTS`.

## Evidência local atual

`npm run typecheck`, `npm test` (60/60), `npm run test:e2e` (24 casos Playwright; 22 executados e 22 aprovados, dois skips intencionais de busca móvel), `npm run verify:static` (26 artefatos/100 fontes) e o fluxo de MFA/rotação/recuperação da integração passam em memória sintética.

Essa evidência não autoriza produção: ainda faltam banco limpo production-like, secret manager/KMS, TLS/HTTPS no ambiente-alvo, rate limit distribuído, sessões compartilhadas, recuperação por canal aprovado, testes de browsers adicionais, revisão independente sem limitações e aprovação humana de risco.
