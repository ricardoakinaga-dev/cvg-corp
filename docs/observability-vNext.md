# Observabilidade e SLOs vNext

## Contrato

Toda requisição, job, provider effect e reconciliação deve carregar
`correlationId`, actor/organization redigidos quando aplicável, status,
latência, attempt/fence e resultado. Logs não carregam prompt, conteúdo
clínico, token, segredo ou credential. Cardinalidade de labels deve ser
limitada a operação, status e dependência.

`CURRENT`: `@cvg/ops` fornece spans, logs redigidos, métricas de requests,
dependências, filas e estado de efeitos, além de avaliação pura de SLO e
alertas ligados a runbooks. O exporter é injetável; não há collector implícito.

`PROPOSED`: exportar OTLP para collector aprovado, que encaminha métricas para
Prometheus e traces/logs para o backend operacional escolhido. A queda do
exporter não deve alterar a decisão transacional nem liberar uma operação.

## SLOs

As metas de API, latência, outbox, mensagens e restore permanecem
`PROPOSED` até owner, janela, amostra, ambiente e error budget serem aprovados.
`NOT_RUN` não pode virar `PASS`. A avaliação deve registrar valor, contagem,
timestamp, ambiente, fonte e runbook.

## Gate

O gate production-like precisa demonstrar collector ativo, trace de uma
requisição até persistência/worker, métrica de erro e alerta acionável,
redaction, dashboard e um SLO medido em janela aprovada. A execução local da
telemetria é evidência de contrato, não evidência de operação de produção.
