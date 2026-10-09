-- CVG-AUD26-003: remove the broad sequence grant inherited from migration 022.
-- Only the checkpoint identity is used by the runtime/session store; every
-- other sequence remains owned by the migration/schema authority.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    revoke usage, select on all sequences in schema public from cvg_runtime;
    grant usage, select on sequence agent_checkpoints_checkpoint_id_seq to cvg_runtime;
  end if;
end $$;
