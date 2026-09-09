# ADR 005 — Worker separado e efeitos externos

**Status:** accepted for implementation; providers reais estão bloqueados até existir autoridade.

`apps/worker` executará outbox, jobs, notificações e reconciliação com identidade de serviço mínima. A API apenas registra intenção e retorna receipt/estado pendente.

Timeout, perda de lease, callback duplicado e resposta desconhecida resultam em retry bounded ou quarentena; nunca em reenvio cego.
