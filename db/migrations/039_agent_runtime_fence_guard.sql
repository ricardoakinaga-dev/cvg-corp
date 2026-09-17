-- Fence enforcement at the database boundary.  The runtime store already
-- validates the authoritative fence inside its tenant-scoped insert, but a
-- future code path (or a manual statement) must not be able to append history
-- with a stale or future fence: after a takeover the old writer's fence no
-- longer matches the session row and the insert is rejected.
create or replace function cvg_agent_runtime_fence_guard() returns trigger
language plpgsql
as $$
declare
  authoritative bigint;
begin
  select fence into authoritative from agent_sessions where session_id = new.session_id;
  if authoritative is null then
    raise exception 'agent session fence is unknown' using errcode = '55000';
  end if;
  if new.fence is distinct from authoritative then
    raise exception 'agent runtime write rejected: stale or future fence' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_checkpoints_fence_guard on agent_checkpoints;
create trigger agent_checkpoints_fence_guard
before insert on agent_checkpoints
for each row execute function cvg_agent_runtime_fence_guard();

drop trigger if exists agent_turns_fence_guard on agent_turns;
create trigger agent_turns_fence_guard
before insert on agent_turns
for each row execute function cvg_agent_runtime_fence_guard();
