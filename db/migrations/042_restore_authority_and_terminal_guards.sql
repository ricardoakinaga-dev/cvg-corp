-- CVG-AUD20-002/003: restore authority separation and terminal immutability.
--
-- The runtime role must never:
--   * write turns/checkpoints into a session that is not ACTIVE;
--   * move a session into QUARANTINED_RESTORE;
--   * import history with a non-authoritative fence.
-- Those operations belong to the schema owner (restore authority), which is the
-- role that owns the agent tables.  The 041 historical-fence exception is now
-- gated on that authority instead of on a session state any runtime write could
-- reach.

create or replace function cvg_agent_restore_authority() returns boolean
language sql stable
as $$
  select current_user = (
    select tableowner from pg_tables where schemaname = 'public' and tablename = 'agent_sessions'
  );
$$;

-- Historical fences are only accepted for the restore authority replaying into
-- a session already marked QUARANTINED_RESTORE.
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
    if not (cvg_agent_restore_authority() and session_status = 'QUARANTINED' and session_run_state = 'QUARANTINED_RESTORE' and new.fence <= authoritative) then
      raise exception 'agent runtime write rejected: stale or future fence' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

-- Turns and checkpoints require an ACTIVE session unless the restore authority
-- is replaying history into a quarantined session.
create or replace function cvg_agent_terminal_write_guard() returns trigger
language plpgsql
as $$
declare
  session_status text;
begin
  select status into session_status from agent_sessions where session_id = new.session_id;
  if session_status is null then
    raise exception 'agent session is unknown' using errcode = '55000';
  end if;
  if session_status <> 'ACTIVE' and not cvg_agent_restore_authority() then
    raise exception 'agent session is %; terminal state is immutable', session_status using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_turns_terminal_guard on agent_turns;
create trigger agent_turns_terminal_guard
before insert on agent_turns
for each row execute function cvg_agent_terminal_write_guard();

drop trigger if exists agent_checkpoints_terminal_guard on agent_checkpoints;
create trigger agent_checkpoints_terminal_guard
before insert on agent_checkpoints
for each row execute function cvg_agent_terminal_write_guard();

-- The runtime may complete a session but may not create the restore state.
create or replace function cvg_agent_restore_state_guard() returns trigger
language plpgsql
as $$
begin
  if new.run_state = 'QUARANTINED_RESTORE' and not cvg_agent_restore_authority() then
    raise exception 'QUARANTINED_RESTORE is reserved for the restore authority' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_sessions_restore_state_guard on agent_sessions;
create trigger agent_sessions_restore_state_guard
before insert or update on agent_sessions
for each row execute function cvg_agent_restore_state_guard();
