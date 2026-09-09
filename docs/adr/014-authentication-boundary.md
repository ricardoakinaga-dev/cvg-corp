# ADR 014 — Boundary de autenticação e autoridade de sessão

**Status:** accepted para desenvolvimento local; promoção operacional `NOT_READY`.

## Decisão

Credenciais, MFA, recuperação, lockout e sessões pertencem a uma boundary própria, com contratos públicos redigidos, desafios de uso único e estado de segurança vinculado à versão da credencial. O HTTP somente compõe o fluxo; políticas e transições ficam em helpers de autenticação e no domínio durável.

## Invariantes

1. senha, segredo TOTP, código de recuperação e digests internos nunca são públicos;
2. falha de MFA, recuperação, lockout, expiração ou versão de credencial nunca abre sessão;
3. desafio tem TTL, contador limitado, status terminal e consumo atômico;
4. rotação revoga sessões antigas por `credentialVersion`, sem apagar auditoria;
5. produção exige resolver de segredo aprovado, configuração de MFA e transporte seguro;
6. resposta de recuperação não revela se o login existe;
7. restore/revogações continuam impedindo reativação automática de autoridade.

## Consequências

A migration 020 é somente aditiva e compatível com snapshots legados por normalização explícita. O modo local pode usar um resolver sintético injetado nos testes; o ambiente real precisa fornecer segredo por referência, relógio confiável, storage transacional e mecanismo distribuído de throttling. Até essa prova existir, a capability permanece bloqueada para dados reais.
