-- CVG-AUD19-012 / AUD-2026-006: explicit least privilege for the runtime role.
-- Migration 022 granted SELECT/INSERT/UPDATE/DELETE on every current and future
-- table; migration 038 narrowed the agent tables but never revoked the
-- inherited privileges.  This migration REVOKEs first and then grants only the
-- operations the runtime actually performs, so an upgrade from 022+038 and a
-- clean install converge to the same matrix.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    -- Agent runtime state.  Sessions may update (fence/run_state/checkpoint
    -- digest) but never delete; turns and checkpoints are append-only; leases
    -- are the only table the runtime releases with DELETE.
    revoke all on table agent_sessions, agent_turns, agent_checkpoints, agent_leases from cvg_runtime;
    grant select, insert, update on agent_sessions to cvg_runtime;
    grant select, insert on agent_turns to cvg_runtime;
    grant select, insert on agent_checkpoints to cvg_runtime;
    grant select, insert, update, delete on agent_leases to cvg_runtime;
    grant usage, select on sequence agent_checkpoints_checkpoint_id_seq to cvg_runtime;

    -- Durable ledgers: no DELETE anywhere.  UPDATE is revoked where the ledger
    -- is insert-only; cvg_audit_ledger keeps UPDATE for SELECT ... FOR UPDATE
    -- serialization (granted by 028, guarded by cvg_append_only_guard) and
    -- ai_usage_ledger keeps UPDATE because settlement is an idempotent upsert.
    revoke delete on table cvg_audit_ledger, cvg_event_journal, cvg_command_receipt_ledger, ai_usage_ledger from cvg_runtime;
    revoke update on table cvg_event_journal, cvg_command_receipt_ledger from cvg_runtime;
    -- Receipts and break-glass grants transition state but are never deleted.
    revoke delete on table command_receipts, break_glass_grants from cvg_runtime;
  end if;
end $$;
