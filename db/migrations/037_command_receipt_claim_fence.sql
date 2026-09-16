-- AUD13-22: fenced claim metadata for durable command receipts.
-- The stable identity excludes the session (docs04 §7); this migration only
-- adds the takeover fence columns and never rewrites existing lookup hashes.
alter table command_receipts add column if not exists claim_epoch integer not null default 1;
alter table command_receipts add column if not exists claim_expires_at timestamptz;
alter table command_receipts add column if not exists dispatch_state text not null default 'NOT_STARTED';
alter table command_receipts add column if not exists failure_phase text;

-- Claims written before this migration have no trustworthy lease deadline. Make
-- them immediately eligible for reconciliation instead of leaving an old
-- IN_FLIGHT row live forever. The dispatch marker still decides whether the
-- terminal state is FAILED/PRE_DISPATCH or OUTCOME_UNKNOWN/POST_DISPATCH.
update command_receipts
set claim_expires_at = now()
where status = 'IN_FLIGHT' and claim_expires_at is null;

-- Rows already marked OUTCOME_UNKNOWN crossed the dispatch boundary by definition.
update command_receipts set dispatch_state = 'DISPATCHED' where status = 'OUTCOME_UNKNOWN' and dispatch_state = 'NOT_STARTED';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'command_receipts_claim_epoch_positive' and conrelid = 'command_receipts'::regclass) then
    alter table command_receipts add constraint command_receipts_claim_epoch_positive check (claim_epoch > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'command_receipts_dispatch_state_check' and conrelid = 'command_receipts'::regclass) then
    alter table command_receipts add constraint command_receipts_dispatch_state_check check (dispatch_state in ('NOT_STARTED', 'DISPATCHED'));
  end if;
end $$;

create index if not exists command_receipts_claim_reconciliation
  on command_receipts (status, claim_expires_at)
  where status = 'IN_FLIGHT';
