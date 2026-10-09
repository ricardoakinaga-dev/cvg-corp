# Runbook — carga, caos e DR local da Lane D

**Estado:** harness sintético local; carga representativa, caos live e DR
gerenciado `BLOCKED_EXTERNAL`. **Owner:** SRE/DR. **Blast radius:** somente
processo e diretórios temporários criados pelo harness.

## Execução segura

```bash
node --import tsx scripts/load/run-local-load.ts
node --import tsx scripts/chaos/run-local-chaos.ts
node --import tsx scripts/dr/run-local-dr.ts
node --import tsx scripts/ops/verify-observability-local.ts
```

Os comandos não abrem sockets, não acessam PostgreSQL, não chamam provider,
não param containers e não carregam dados de tenant. O harness de carga cria
10.000 variações de URL sintética e prova que a cardinalidade fica no budget;
os harnesses de caos modelam processo, rede, banco, fila, provider e pressão de
collector através de abort/timeout/disconnect e sink controlado.

## Matriz de evidência

| Cenário | O que a execução local prova | O que permanece fora |
|---|---|---|
| carga | bounded labels, janela de latência e redaction | throughput/latência de staging |
| processo/rede/banco/fila/provider/collector | fechamento de span e contenção local | falha real entre serviços |
| cópia/retomada de artifact NDJSON | sobrevivência de arquivo sintético após “restart” | PostgreSQL, object storage, KMS e backup gerenciado |
| RTO | `UNKNOWN` | cronômetro de restore equivalente ao alvo |
| RPO | `UNKNOWN` | watermark/retention e perda observada em infraestrutura aprovada |

O resultado `LOCAL_SYNTHETIC_PASS` é apenas evidência do harness bounded. Não é
um gate externo, não qualifica staging e não autoriza promoção. O resultado
correto para os campos RTO/RPO sem infraestrutura equivalente é `UNKNOWN`, e o
gate de DR permanece `BLOCKED_EXTERNAL`.

## Exercício externo posterior

Somente com autoridade explícita, ambiente descartável equivalente e dados
sintéticos aprovados: registrar topology/digests, executar o perfil de carga,
isolar cada falha, validar backup/restore e reconciliar o watermark. Medir RTO
desde o início do restore até readiness independente; medir RPO pelo último
watermark durável versus o evento de corte. Um exercício incompleto deve ser
`NOT_RUN`/`BLOCKED_EXTERNAL`, nunca PASS.
