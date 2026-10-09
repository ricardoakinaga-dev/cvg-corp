# ADR-042 — Contratos de egress e limites de runtime

Status: proposta implementada na Lane A; validação de release permanece externa

Data: 2026-09-21

## Contexto

Os itens CVG-AUD26-011..015 identificaram cinco fronteiras sem orçamento ou
enforcement suficiente: buckets distribuídos sem lifecycle, corpos de modelos e
mensageria lidos integralmente, resolução DNS vulnerável a rebinding, redirects
sem política uniforme e respostas da API cujo schema era apenas metadado.

## Decisão

### Estado e respostas

- Buckets PostgreSQL usam a janela máxima de uma hora, retenção de duas horas,
  lotes de 500 linhas e cleanup periódico de 30 segundos. A limpeza ordena por
  `updated_at`, usa `FOR UPDATE SKIP LOCKED`, é idempotente e não participa do
  upsert do hot path. O índice existente em `updated_at` sustenta a varredura.
  Linhas, idade do bucket mais antigo e falhas são expostos pelo lifecycle hook.
- O fallback em memória remove buckets expirados a cada `consume`/`peek` e
  mantém cardinalidade máxima configurável.
- Adapters de modelo validam a forma mínima da resposta antes do mapeamento,
  limitam `maxOutputTokens` a 4096 por padrão e limitam o corpo a 1 MiB por
  padrão, com teto configurável de 4 MiB. `Content-Length` e leitura chunked
  compartilham a mesma política; o reader é cancelado no excesso.
- A integração de mensageria limita corpos a 256 KiB por padrão, com teto de
  4 MiB, conta bytes antes do buffer final, cancela o reader no excesso e
  converte falhas ambíguas em `OUTCOME_UNKNOWN`. O adapter não faz retry cego.
- O catálogo de rotas recebe um registry executável. Respostas JSON passam pelo
  envelope e pelo payload concreto quando há schema revisado; demais operações
  usam envelope bounded. Texto, binário, streaming e `204` têm políticas
  explícitas. Saída não serializável ou com campos sensíveis proibidos é
  rejeitada antes do envio, e o error handler devolve mensagem genérica.

### Egress HTTP

- HTTPS e portas allowlisted são o padrão; hosts allowlisted são comparações
  exatas. HTTP só pode ser habilitado explicitamente para ambientes locais.
- Toda resolução é feita com `all: true`; cada endereço retornado é validado.
  Loopback, RFC1918, link-local, CGNAT, multicast, ULA, documentação,
  IPv4-mapped IPv6 e representações alternativas privadas são recusados.
- Prefixos conhecidos de tradução IPv4/IPv6 (`64:ff9b::/96` e
  `64:ff9b:1::/48`), Teredo (`2001::/32`), 6to4 (`2002::/16`) e descarte
  IPv6 (`100::/64`) também são recusados. Redes com prefixos de tradução
  específicos do operador devem declará-los em
  `CVG_MESSAGING_BLOCKED_IPV6_PREFIXES`, uma lista CSV de CIDRs IPv6 validada
  na configuração e aplicada antes do dispatch. Prefixos inválidos falham
  fechado.
- Redirects são desabilitados por padrão. Quando habilitados, há orçamento
  máximo de cinco hops, apenas `GET`/`HEAD` podem seguir, e cada `Location`
  repete protocolo, host, porta e política de endereço. Headers de autorização,
  cookie e proxy-autorização não atravessam o hop.
- O transporte nativo de produção usa `pinnedEgressFetch`: o endereço já
  validado é entregue ao callback `lookup` do socket, eliminando uma segunda
  resolução DNS não controlada entre a validação e a conexão. Transportes
  injetados são um seam determinístico de harness; se fizerem rede real,
  precisam honrar o terceiro argumento (`EgressTarget`) do contrato.

## Harness e regressão

Os testes focados cobrem known-good e known-bad para buckets ativos/expirados,
corpos chunked e `Content-Length`, limite de tokens, schemas inválidos, campos
sensíveis, IPs IPv4/IPv6 e mapeados, respostas DNS com múltiplos endereços,
rebinding entre redirects, remoção de headers e redirect de POST. O harness de
catálogo verifica que cada operação catalogada possui contrato executável.

O registro IANA de endereços IPv6 especiais e [RFC 6052](https://www.rfc-editor.org/rfc/rfc6052.html)/[RFC 8215](https://www.rfc-editor.org/rfc/rfc8215.html)
definem os prefixos de tradução conhecidos; prefixos específicos de rede não
podem ser inferidos de forma confiável sem configuração do operador.

## Consequências e limites

As mudanças são locais e reversíveis e não exigem migration nova. O contrato de
egress não transforma automaticamente qualquer transporte injetado em socket
pinned; essa responsabilidade fica explícita no seam de teste. A política de
modelo OpenAI-compatible continua separada da política de mensageria porque o
adapter de modelo não é um destino de integração configurado pelo catálogo de
egress desta lane; eventual exposição dessa configuração a entrada não
confiável deve reutilizar `validateEgressTarget`/`pinnedEgressFetch`.
