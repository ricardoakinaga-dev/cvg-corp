# API v1 examples

These examples describe the current `/api/v1` contract. Values ending in
`example` and tokens in angle brackets are placeholders; do not send them to a
real environment. Login and session values must come from the caller's
approved secret/session flow.

The route catalog declares `POST /auth/login` as public with request schema
`LoginInput` and response schema `LoginResponse`. A login request is JSON:

```http
POST /api/v1/auth/login HTTP/1.1
Content-Type: application/json
Accept: application/json

{"login":"admin@example.test","password":"example-only-password"}
```

A completed session is returned with HTTP 200. The session cookie is set by the
server; the CSRF token is returned in the payload and a readable CSRF cookie.
The following response illustrates the schema shape, not a reusable session:

<!-- api-response-example: POST /api/v1/auth/login 200 LoginResponse -->
```json
{
  "schemaVersion": 1,
  "data": {
    "user": {
      "id": "11111111-1111-4111-8111-111111111111",
      "displayName": "Example Operator",
      "email": "operator@example.test",
      "status": "ACTIVE"
    },
    "contexts": [
      {
        "organization": {
          "id": "22222222-2222-4222-8222-222222222222",
          "name": "Example Clinic",
          "slug": "example-clinic"
        },
        "unit": {
          "id": "33333333-3333-4333-8333-333333333333",
          "name": "Main Unit",
          "code": "MAIN"
        },
        "workspace": {
          "id": "44444444-4444-4444-8444-444444444444",
          "name": "Reception",
          "purpose": "appointments"
        },
        "roles": ["recepcao"]
      }
    ],
    "csrfToken": "example-only-csrf-token"
  },
  "correlationId": "m23-doc-example-login"
}
```

Creating a guardian requires a session, the selected unit/workspace context,
CSRF cookie/header agreement, and an `Idempotency-Key`. Retrying the same
command with the same key is safe; use a new stable key for a distinct command.
The body follows `GuardianInput`:

```http
POST /api/v1/guardians HTTP/1.1
Content-Type: application/json
Accept: application/json
Cookie: cvg_session=<session-cookie>; cvg_csrf=<csrf-token>
X-CSRF-Token: <csrf-token>
X-CVG-Unit-ID: 33333333-3333-4333-8333-333333333333
X-CVG-Workspace-ID: 44444444-4444-4444-8444-444444444444
Idempotency-Key: guardian-create-example-001

{"displayName":"Example Guardian","phone":"+5511999990000","email":"guardian@example.test"}
```

The successful command returns HTTP 201 with a `GuardianResponse` payload:

<!-- api-response-example: POST /api/v1/guardians 201 GuardianResponse -->
```json
{
  "schemaVersion": 1,
  "data": {
    "guardian": {
      "id": "55555555-5555-4555-8555-555555555555",
      "displayName": "Example Guardian",
      "phone": "+5511999990000",
      "email": "guardian@example.test",
      "status": "ACTIVE"
    },
    "receiptId": "66666666-6666-4666-8666-666666666666"
  },
  "correlationId": "m23-doc-example-create"
}
```

A scoped `GET /api/v1/guardians` uses the same session and context headers. It
returns HTTP 200 with a `GuardianListResponse` payload in the same success
envelope:

<!-- api-response-example: GET /api/v1/guardians 200 GuardianListResponse -->
```json
{
  "schemaVersion": 1,
  "data": {
    "items": [
      {
        "id": "55555555-5555-4555-8555-555555555555",
        "displayName": "Example Guardian",
        "phone": "+5511999990000",
        "email": "guardian@example.test",
        "status": "ACTIVE"
      }
    ]
  },
  "correlationId": "m23-doc-example-list"
}
```

Errors use the same versioned envelope. For example, an invalid or missing
`Idempotency-Key` on an otherwise authorized create request returns HTTP 400:

<!-- api-response-example: POST /api/v1/guardians 400 ERROR -->
```json
{
  "schemaVersion": 1,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Idempotency-Key é obrigatório e deve ser estável."
  },
  "correlationId": "m23-doc-example-invalid-key"
}
```

Every example envelope uses `schemaVersion: 1`, matching the current contract.
`/api/v2` is not enabled. Older, future, or otherwise unregistered contract
versions fail closed until an adjacent-version upcaster and its independent
review are registered. See [API compatibility](api-compatibility-proof.md).
