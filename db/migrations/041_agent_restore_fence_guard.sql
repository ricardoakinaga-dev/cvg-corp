-- CVG-AUD19-011: the 039 fence guard enforces exact equality for live writers.
-- A restore replays historical turns/checkpoints whose fence is lower than the
-- session's latest fence, so the guard now also accepts a historical fence when
-- the target session is already terminal-restored (QUARANTINED with
-- QUARANTINED_RESTORE run state).  Live sessions keep the exact-equality rule.
create or replace function cvg_agent_runtime_fence_guard() returns trigger
language plpgsql
as $$
declare
  authoritative bigint;
  session_status text;
  session_run_state text;
begin
  select fence, status, run_state into authoritative, session_status, session_run_state
    from agent_sessions where session_id = new.session_id;
  if authoritative is null then
    raise exception 'agent session fence is unknown' using errcode = '55000';
  end if;
  if new.fence is distinct from authoritative then
    if not (session_status = 'QUARANTINED' and session_run_state = 'QUARANTINED_RESTORE' and new.fence <= authoritative) then
      raise exception 'agent runtime write rejected: stale or future fence' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
