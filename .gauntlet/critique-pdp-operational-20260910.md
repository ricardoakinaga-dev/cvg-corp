# PDP operational repair — críticas independentes

Escopo: verificadores estruturais HTTP/application, não aprovação universal ou AAA.
Barra: PDP-R1/R2/R3 em docs/final-operational-proof-audit.md. Host: quatro slots, forks none, filesystem compartilhado, reviewers read-only e sem descendentes; Lead único writer de estado.

## Critic HTTP inicial

Identidade: /root/critic_http_inventory; I1; contexto none. Veredito FAIL.
HIGH: chamada encadeada app.get(...).get('/private', ...) não inventariada; bind de app['get'] e app['register'] ignorados; prefix de plugin causava falso match.
Sentinel antes/depois, inalterado: d666bb363258f7e4e61547f4347fc742f3091ee324e3853f9d2b068bc2442101 (inventory), e21dd6d80f7a1db002ed3d82a32090857b8cdf159886e5c48ae74ee99f9a5ed3 (test), 25d5065735040615e50a209c7d32ebc38ee789c61f8cac5aa4cfbd1af27ba88b (CLI). 6/6 testes focados passavam apesar das fixtures adversariais falharem.
Reparo: receiver encadeado, rejeição de métodos extraídos/bind, plugin por colchetes e rejeição explícita de prefix/options não suportados. Fixtures incorporadas, 7/7 testes focados.

## Critic application inicial

Identidade: /root/critic_application_guard; I1; contexto none. Veredito FAIL.
HIGH: propriedade pública callable de constructor e defaults destructurados executáveis antes de PDP não eram verificados.
Sentinel antes/depois, inalterado: 20cd5d22f0e1e6a7e753e940f31db925be8183004e5d16c5ded6c6d77bf14342 (inspector), 6c6172c119cbce6ae4e556d9c9e9a58eb44a791b40d1859eb0cdf520a8aba313 (tests). 10/10 testes focados passavam antes das fixtures adversariais.
Reparo: parameter properties públicas rejeitadas conservadoramente; declaração completa dos parâmetros inspecionada para defaults e computed keys. Novas fixtures negativas e foco 10/10 aprovado pelo runner, sem autoaprovação do builder.

## Critic final do primeiro artifact reparado

Identidade /root/critic_final_pdp_slice, I1, fork none, read-only; veredito FAIL, três MEDIUM. Reproduziu computed keys de url/prefix, plugin encadeado não inventariado e shadowing lexical externo da função de PDP. Fastify real confirmou endpoints inesperados com HTTP 200 nos casos de URL/prefix/plugin. 17/17 testes focados e verify:pdp passavam. Hashes antes/depois inalterados: 517a8491489fc5a96668a028d1ab9472fb999a428ff03b1a4e5651e190435e08 (application), 7b759f4c7d22ec276478529fab1f065c04ce6fcd2e35abdf8571d872ebf53a6e (inventory), 023329c752058a6bdbda71a54a8f8ff3df84e42dd78b71cabb7d0297ffdfce23 (application tests), 5fc87b76d4c97066f056a0cb6df5fc330bb5ed2102bafd3ca267dd797a751508 (route tests).

Reparo adicional: computed keys rejeitadas, receiver de plugin encadeado reconhecido e escopo lexical de policy inspecionado. O FAIL histórico não vira aprovação automática após reparo; nova evidência precisa do artifact atualizado.


## Aceite independente dos reparos finais

/root/critic_pdp_repair_acceptance, I1, fork none, identidade fresh distinta, emitiu PASS somente para computed option overrides, plugin encadeado e shadowing lexical. Executou foco 19/19, verify:pdp e 24 fixtures independentes de shadowing (imports diretos, aliases e namespaces × oito formas de binding); controles limpos também passaram. Computed url/prefix retornaram DYNAMIC_REGISTRATION; plugins encadeados/nested retornaram UNREGISTERED_ROUTE. Sentinel antes/depois inalterado e conferido pelo Lead: 46566e15f0a9a0b026c3fc87e56624a3bfcb3c08a0ba3b803480fee776180475 (application), 80b118c0907c8d9cba1726ec7231cb391393bc1ca4c2fa27bd4ebec70d018345 (inventory), 58c5e29b58bfa38e18312ff358a9eaeeb54a3261f1af344c3a38858137023b49 (application tests), ab442245f89acd37466d748ccb93f23de14cf5f275b2469a01e0ef414fd5bf75 (route tests).

Sem findings pendentes desses reparos delimitados. Fase universal permanece PARTIAL e veredito global FAIL/AAA_NOT_PROVEN; revisão restrita não satisfaz critics de todas as dimensões nem aprovação humana.
