# Fresh independent review — MEL23-023 RLS slice

- Reviewer: `critic_mel23_rls_final`
- Verdict: **APPROVE**, no blocking findings.
- Review mode: fresh context, read-only; no files changed and no tests run by the reviewer.
- Subject SHA: `c990914148a8f375082cd12bbdb2ad20cfe1900f`
- Observed subject fingerprint: `sha256:6c1733199b781972bb3621d3c7a59912064582fed02fd7f612e98c60cc1e7c7d`

The reviewer confirmed that migration 049 applies the exact scoped DML helper to
`audit_records`, `command_receipts`, and `role_assignments`; the existing read
policies remain intact. It also confirmed scope propagation across role
projection, audit/receipt commits, receipt lifecycle transitions, worker audit
append, and break-glass activation. Break-glass now validates grant/audit scope
shape and writes the grant, scoped audit row, and audit ledger entry atomically.

The disposable PostgreSQL verifier proves same-scope reads/inserts/updates,
cross-tenant, cross-unit, and cross-workspace read and UPDATE/DELETE isolation,
and SQLSTATE `42501` for mismatched inserts. UPDATE/DELETE checks use a
temporary role without `BYPASSRLS`, with explicit table privileges, so SQL
privileges do not mask the RLS policies. `audit_records` remains append-only:
same-value UPDATE is permitted while a real update and DELETE must raise
SQLSTATE `55000`.

## Non-blocking limitation

Committed synthetic role-assignment, receipt, and audit fixtures remain in the
verifier database while the RLS probes run; the audit fixture is not paired
with an audit-ledger row. The verifier must therefore run only through the
guarded disposable PostgreSQL wrapper. The recorded run used PostgreSQL 16,
confirmed unchanged inventory, and removed the database.

## Scope

This approves only the three-table local RLS slice. It does not qualify every
affected table across each of the 24 migration waves, relational cutover,
post-cutover restore, staging, production, or human acceptance. MEL23-023 stays
`PARTIAL`; promotion stays `BLOCKED` / `AAA_NOT_PROVEN`.
