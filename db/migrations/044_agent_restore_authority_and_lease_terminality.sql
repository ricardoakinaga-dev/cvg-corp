-- CVG-AUD21-002: terminal lease authority and an explicit restore role.
--
-- The migration/schema owner is not a runtime or restore authority.  A
-- maintenance connection may assume the dedicated NOLOGIN role only for the
-- restore projection; direct writes by the owner and by cvg_runtime remain
-- rejected by the session/history guards.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cvg_restore_authority') then
    create role cvg_restore_authority noinherit nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

alter role cvg_restore_authority noinherit nologin nosuperuser nobypassrls nocreatedb nocreaterole;
revoke all on schema public from cvg_restore_authority;
grant usage on schema public to cvg_restore_authority;
revoke all on table agent_sessions, agent_turns, agent_checkpoints, agent_leases from cvg_restore_authority;
grant select, insert on table agent_sessions, agent_turns, agent_checkpoints to cvg_restore_authority;
grant usage, select on sequence agent_checkpoints_checkpoint_id_seq to cvg_restore_authority;

-- The migration operator may assume the role from the explicit restore path,
-- but the application runtime never receives that membership.
do $$
begin
  if current_user = 'cvg_runtime' then
    raise exception 'runtime role cannot install restore authority' using errcode = '42501';
  end if;
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    execute 'revoke cvg_restore_authority from cvg_runtime';
  end if;
  if current_user <> 'cvg_restore_authority' then
    execute format('grant cvg_restore_authority to %I', current_user);
  end if;
end $$;

create or replace function cvg_agent_restore_authority() returns boolean
language sql stable
set search_path = pg_catalog, public
as $$
  select current_user = 'cvg_restore_authority'
$$;

-- Runtime/session writes are limited to the runtime role.  Restore inserts a
-- quarantined terminal session and never updates an existing terminal one.
create or replace function cvg_agent_restore_state_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if cvg_agent_restore_authority() then
      if new.status <> 'QUARANTINED' or new.run_state <> 'QUARANTINED_RESTORE' then
        raise exception 'restore authority may only insert QUARANTINED_RESTORE sessions' using errcode = '55000';
      end if;
    elsif current_user <> 'cvg_runtime' or new.status <> 'ACTIVE' or new.run_state <> 'CREATED' then
      raise exception 'agent session insert requires the runtime or restore authority' using errcode = '55000';
    end if;
  elsif tg_op = 'UPDATE' then
    if cvg_agent_restore_authority() then
      raise exception 'restore authority cannot update an existing agent session' using errcode = '55000';
    end if;
    if current_user <> 'cvg_runtime' or old.status <> 'ACTIVE' then
      raise exception 'agent session terminal state is immutable' using errcode = '55000';
    end if;
    if new.run_state = 'QUARANTINED_RESTORE' then
      raise exception 'QUARANTINED_RESTORE is reserved for the restore authority' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_sessions_restore_state_guard on agent_sessions;
create trigger agent_sessions_restore_state_guard
before insert or update on agent_sessions
for each row execute function cvg_agent_restore_state_guard();

create or replace function cvg_agent_runtime_fence_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
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
  if new.fence is distinct from authoritative
     and not (cvg_agent_restore_authority()
       and session_status = 'QUARANTINED'
       and session_run_state = 'QUARANTINED_RESTORE'
       and new.fence <= authoritative) then
    raise exception 'agent runtime write rejected: stale or future fence' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function cvg_agent_terminal_write_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  session_status text;
  session_run_state text;
begin
  select status, run_state into session_status, session_run_state
    from agent_sessions where session_id = new.session_id;
  if session_status is null then
    raise exception 'agent session is unknown' using errcode = '55000';
  end if;
  if (cvg_agent_restore_authority()
      and (session_status <> 'QUARANTINED' or session_run_state <> 'QUARANTINED_RESTORE'))
     or (not cvg_agent_restore_authority() and session_status <> 'ACTIVE') then
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
