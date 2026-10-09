# Inspeção do scanner de segredos

`npm run verify:secrets` executa `node scripts/verify-secrets.mjs`; não foram
encontrados hooks `preverify:secrets` ou `postverify:secrets` no manifesto raiz.
O script foi lido integralmente nesta tarefa e permanece inalterado.

O scanner invoca Gitleaks v8.28.0 por uma imagem Docker fixada em digest. A
configuração usa `--network=none`, sistema de arquivos do contêiner somente
leitura e montagem do repositório como `/repo:ro`. Somente o diretório temporário
de relatórios é gravável. A saída recebe `--redact`. O script verifica todo o
histórico Git e a árvore atual, e remove seu diretório temporário no `finally`.

`scanner-preflight.json` registra a inspeção executada: contexto Docker
`default`, endpoint `unix:///var/run/docker.sock`, ausência de overrides
`DOCKER_HOST`/`DOCKER_CONTEXT` e imagem fixada já presente localmente.
Não é necessário baixar a imagem para esta execução. O script não contém
chamada a OpenAI nem envio de trechos do repositório a serviço remoto.
O bloqueio de ferramenta informado na entrega anterior não foi um resultado
produzido pelo Gitleaks. Esta inspeção não reconstrói decisões daquela plataforma.

## Limites preservados

A configuração exclui `dist/`. Quando a primeira passagem encontra somente
achados `generic-api-key` nos caminhos permitidos pelo repositório (`tests/`,
`artifacts/` e outros diretórios explicitados em `syntheticPath`), o script
gera uma lista temporária de fingerprints e repete a verificação. A exceção
implementada é por regra/caminho, não uma comprovação de que cada valor seja
realmente fictício; o comentário do script não deve ser interpretado como uma
garantia maior. Outros tipos/caminhos continuam causando falha. Nenhuma regra,
exceção, opção de rede ou dependência foi alterada para obter aprovação.

Esta é a configuração e o ambiente observados. O resultado de execução final,
seus horários, código de saída, hash do log e identidade das fontes ficam em
`secret-scan.json`. Inspeção estática não substitui esse resultado.
