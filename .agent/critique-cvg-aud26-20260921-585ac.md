# Crítica independente CVG-AUD26 — sujeito 585ac

**Revisor:** agente independente Parfit / contexto fresco  
**Data:** 2026-09-21 16:23 -03:00  
**Escopo:** somente leitura; não criou receipts e não concedeu aprovação.

## Veredito

`AAA_NOT_PROVEN` — `PROMOTION_BLOCKED`.

Fingerprint recalculado: `sha256:585ac671407f924c272bf25d77b96faf29bd8d39f060ef84a558b14368695906`.

## Bloqueadores P0

- DATA-017–020 continuam `PARTIAL`: 24 coleções permanecem `SNAPSHOT_PRIMARY`; cutover, backfill, reconciliação e retirada do legado não foram concluídos.
- CVG-AUD26-008 é parcial: WebKit está indisponível neste host e a segunda qualificação same-fingerprint não foi comprovada.
- CVG-AUD26-035/036 permanecem `BLOCKED_EXTERNAL`/`BLOCKED_HUMAN`: staging, providers, secrets, collector, DR/RTO/RPO, assinatura/proveniência OCI e aprovação humana não estão disponíveis.

## Bloqueadores P1

- Schemas específicos de resposta continuam incompletos em CVG-AUD26-015.
- Scanner/mutantes, observabilidade durável, alertas, licença e supply chain permanecem parciais ou externos.
- A rastreabilidade QUAL-023/024/025 exigiu correção: bundle pertence a 023; tokens/contraste a 024; seams/TypeScript a 025.
- O bloco `aud26_reconciliation` precisava acompanhar o ponteiro current, em vez de manter o fingerprint histórico M0.
- Diagnostics de `production-gates` foram executados em fotografias diferentes; são históricos quando o fingerprint não coincide e não substituem o pacote principal.

## Pontos fortes

- O veredito permanece honestamente bloqueado, sem inferência de promoção externa ou humana.
- `artifacts/aud26/evidence-snapshot.json` e os quatro artefatos principais estão vinculados ao fingerprint current e passam o verificador.
- Control plane, static verification, known-bads e a suíte corrente passaram; `npm test`: 599 testes, 598 pass, 0 falhas, 1 skip.
- O histórico append-only preserva reaberturas/correções, e limites externos, WebKit e resultados `UNKNOWN` são explícitos.

Este documento é review-only; não é aprovação de release, nem substitui autoridade humana ou receipts externos assinados.
