# Runbook — publicar o pacote de evidência externo AUD27

**Objetivo:** produzir, como autoridade de release em ambiente separado, o pacote
externo que `verify:aud27-evidence-root` valida contra o candidato congelado.
O pacote registra reprodução independente (âncora), atestação de autoridade e
evidência de recuperação, com cadeia de digests verificável.

**Pré-requisitos**

- Checkout do candidato congelado, limpo (`git status --short` vazio) no commit
  exato que será qualificado.
- Node e dependências instalados (`npm ci`), Docker e PostgreSQL descartável
  disponíveis para o drill de recuperação.
- Diretório de saída **fora** do repositório; o script recusa gravar dentro do
  candidato.
- Um arquivo de evidência de recuperação (JSON ou texto) produzido por um drill
  real de restore em destino isolado.

**Passos**

1. Confirme o candidato:
   `git rev-parse HEAD` e `git status --short` (deve ser vazio).
2. Execute o kit como autoridade, com a reprodução focal automática:
   `npx tsx scripts/external-evidence-package.ts --output /caminho/fora/do/repo --authority-id "<autoridade>" --run-anchor --recovery-evidence /caminho/drill.json`
   Alternativa sem execução automática: `--anchor-evidence /caminho/ancora.json`.
3. Valide o pacote:
   `CVG_EVIDENCE_ROOT=/caminho/fora/do/repo npm run verify:aud27-evidence-root`
   Resultado esperado: `AUD27_EVIDENCE_ROOT_PASS`.
4. Teste de adulteração (obrigatório antes de promover):
   copie o diretório, altere um byte de `package-payload.json` e repita o passo 3.
   Resultado esperado: `AUD27_EVIDENCE_ROOT_FAIL` com divergência de digest.
5. Registre o caminho, o digest do manifesto e o `sourceSha` no recibo da tarefa
   AUD27-005 no fluxo append-only.

**O que NÃO fazer**

- Não grave o pacote dentro do repositório nem em caminho com `aud24` no nome.
- Não reutilize âncora/recuperação de outro candidato: `sourceSha` e fingerprint
  precisam ser os mesmos do checkout qualificado.
- Não edite `package-manifest.json`, `package-payload.json` ou
  `package-integrity.json` à mão; qualquer alteração quebra a cadeia.

**Critérios de saída**

- `AUD27_EVIDENCE_ROOT_PASS` no candidato congelado.
- Teste de adulteração rejeitado.
- Registro append-only com caminho, digest e fingerprint.

**Nota de infraestrutura:** enquanto a operação é local, a autoridade pode rodar
o kit nesta máquina em diretório separado; quando a VPS dedicada entrar, repita o
mesmo procedimento no ambiente da VPS e registre o novo `sourceSha`/fingerprint.
