# ADR 007 — Artifact reprodutível e observável

**Status:** accepted for implementation; produção ainda não está autorizada.

O mesmo artifact identificado deve atravessar CI, homologação e produção com configuração externa validada. Containers serão non-root, read-only quando possível, limitados e health-checkable.

Logs redigidos, métricas, traces, correlation, alertas e SLOs pertencem à operação; uma métrica local não prova disponibilidade de produção.
