# Security review vNext

**Resultado:** controles locais relevantes implementados; revisão de produção ainda `NOT_READY`.

## Controles implementados

- Configuração typed com rejeição de variáveis `CVG_` desconhecidas e fail-closed em produção.
- `SecretProvider` por referência, com adapters de ambiente/arquivo limitados; segredos não são devolvidos ao cliente.
- Headers de segurança, cookies HttpOnly, CSRF, escopo explícito, rate limit local e erros correlacionáveis.
- PDP separado com organização/unidade/workspace, finalidade, classe de dados, revisão de policy, aprovação TTL/digest/one-shot e dupla autorização para alto impacto.
- Tool Gateway com catálogo, schema de entrada, timeout, idempotência, audit action, secret refs e egress deny-by-default.
- PostgreSQL com migration aditiva de escopo nas projeções de IA; RLS é defesa adicional, não substituto do PDP.
- Restore em quarentena e invalidação de autoridade são princípios mantidos no caminho sintético.

## Lacunas e testes não executados

- Sessões ainda não constituem uma autoridade distribuída com MFA, recuperação e rotação operacional.
- Os providers `vault/aws/gcp/azure/kubernetes` possuem ponto de integração, não implementação conectada.
- A execução do gateway ainda não é provada como caminho universal de todas as rotas e repositories.
- Adversarial AI security, prompt exfiltration, tenant fuzzing, secret scanning completo e browser security tests não foram executados. O audit de dependências, SBOM e política de licenças locais passaram; o scan de imagem existe como gate Trivy no CI, mas não foi executado neste host.
- Dados reais, break-glass, exportação, pagamentos e comunicação permanecem proibidos.

## Veredito

O sistema está adequado para fixtures sintéticas e testes locais limitados. Não está aprovado para dados clínicos reais, credenciais reais, produção ou claim de Triplo AAA.
