# API compatibility proof

Status: `VERIFIED_LOCAL_FAIL_CLOSED`

O catálogo público permanece em `/api/v1`. `/api/v2` está apenas preparado e não possui rota habilitada. A compatibilidade agora tem um registro executável em `packages/contracts/src/api-catalog.ts`: cada upcaster precisa declarar uma transição de versão adjacente, provar que consegue tratar o payload e devolver o `schemaVersion` seguinte.

O registro corrente está vazio por decisão de segurança. Não existe schema legado aprovado para aceitar; portanto `upcastApiValue` devolve uma cópia imutável de um payload na versão corrente e falha com `API_COMPATIBILITY_UNAVAILABLE` para versão antiga, futura, inválida ou sem migração registrada. Isso evita aceitar uma versão mista por coerção silenciosa.

Evidência local: `tests/unit/contracts.test.ts` cobre cópia imutável, payload corrente, versões antiga/futura e alvo sem upcaster; `npm run verify:static` exige o módulo e a marca `FAIL_CLOSED_REGISTRY`; typecheck e lint passam. O registro ainda não contém uma migração de contrato v1→v2, e nenhuma rota v2 é promovida sem schema, depreciação, upcaster e revisão independentes.
