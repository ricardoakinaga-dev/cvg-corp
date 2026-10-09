# Runbook — crítica independente selada (AUD27-023)

**Objetivo:** entregar a um revisor independente um pacote selado, legível e
imutável, ligado ao candidato congelado, e registrar o parecer vinculado ao
digest do pacote. O protocolo não fabrica independência: ele registra o nível
declarado pelo revisor (`I0`–`I3`) e rejeita qualquer adulteração.

**Pré-requisitos**

- Candidato congelado e limpo (`git status --short` vazio).
- Diretório de saída fora do repositório.
- Lista de evidências a selar (docs, recibos, logs de artefatos).

**Passos**

1. A autoridade emite o pacote:
   ```bash
   npx tsx scripts/sealed-critic-packet.ts --emit /caminho/fora/do/repo \
     --evidence docs/relatorio-parcial-2026-09-25.md,artifacts/operational-proof/aud27-candidate5-20260925/webkit-matrix.log
   ```
   Saída esperada: `SEALED_PACKET_EMITTED` com `packetDigest` e `sourceSha`.
2. Valide o pacote antes de entregar:
   ```bash
   npx tsx scripts/sealed-critic-packet.ts --verify /caminho/fora/do/repo
   ```
   Esperado: `SEALED_PACKET_VERIFIED`.
3. Ensaios de adulteração (obrigatório antes da entrega):
   ```bash
   npx tsx scripts/sealed-critic-packet.ts --rehearsal /caminho/fora/do/repo
   ```
   Esperado: `SEALED_PACKET_REHEARSAL_DETECTED`.
4. O revisor escreve `verdict.json` no diretório do pacote:
   ```json
   { "reviewer": "<nome>", "independenceLevel": "I2", "verdict": "PASS", "packetDigest": "<do passo 1>", "findings": [] }
   ```
5. A autoridade vincula o parecer:
   ```bash
   npx tsx scripts/sealed-critic-packet.ts --bind /caminho/fora/do/repo verdict.json
   ```
   Esperado: `CRITIC_VERDICT_BOUND`; digest divergente → `CRITIC_VERDICT_REJECTED`.

**O que NÃO fazer**

- Não editar `packet.json`, `packet.digest` ou `evidence/`; qualquer byte muda o digest e falha na verificação.
- Não declarar `I2`/`I3` sem revisor realmente distinto; `I1` é pré-checagem, não aceite.
- Não gravar o pacote dentro do repositório.

**Critérios de saída**

- `SEALED_PACKET_VERIFIED` e `SEALED_PACKET_REHEARSAL_DETECTED`.
- `CRITIC_VERDICT_BOUND` com `packetDigest` do candidato congelado.
- Parecer bruto preservado com o pacote; promoção continua dependendo dos demais gates e da decisão humana.
