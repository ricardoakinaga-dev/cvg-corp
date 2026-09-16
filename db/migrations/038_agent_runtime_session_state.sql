-- Durable, fenced agent-runtime session state.  This is CVG-owned state in the
-- canonical PostgreSQL authority (no second "harness" database): sessions,
-- append-only turns, versioned checkpoints and per-session leases with
-- monotonic fencing tokens.  Organization scope is enforced by RLS.

create table if not exists agent_sessions (
  session_id uuid primary key,
  organization_id uuid not null references organizations(id),
  actor_id uuid not null references users(id),
  unit_id uuid,
  workspace_id uuid,
  purpose text not null check (char_length(trim(purpose)) between 1 and 80),
  task_objective text not null default '' check (char_length(task_objective) <= 8_000),
  status text not null check (status in ('ACTIVE', 'COMPLETED', 'QUARANTINED')),
  run_state text not null check (run_state in ('CREATED', 'RUNNING', 'WAITING_APPROVAL', 'OUTCOME_UNKNOWN', 'COMPLETED', 'FAILED', 'CANCELLED', 'QUARANTINED', 'QUARANTINED_RESTORE')),
  fence bigint not null default 0 check (fence >= 0),
  checkpoint_digest text check (checkpoint_digest is null or checkpoint_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (organization_id, session_id)
);
create index if not exists agent_sessions_org_actor_idx
  on agent_sessions (organization_id, actor_id, status, updated_at desc);
create index if not exists agent_sessions_expiry_idx
  on agent_sessions (expires_at);

create table if not exists agent_turns (
  turn_id uuid primary key,
  session_id uuid not null,
  organization_id uuid not null references organizations(id),
  sequence integer not null check (sequence >= 1),
  status text not null check (status in ('COMPLETED', 'FAILED', 'WAITING_APPROVAL', 'DENIED', 'CANCELLED', 'UNKNOWN')),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  context_digest text check (context_digest is null or context_digest ~ '^[a-f0-9]{64}$'),
  model_request_digest text check (model_request_digest is null or model_request_digest ~ '^[a-f0-9]{64}$'),
  model_response_digest text check (model_response_digest is null or model_response_digest ~ '^[a-f0-9]{64}$'),
  tool_request_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_request_ids) = 'array'),
  usage_record_id uuid,
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  started_at timestamptz not null,
  completed_at timestamptz,
  fence bigint not null check (fence >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  foreign key (organization_id, session_id) references agent_sessions (organization_id, session_id)
);
create index if not exists agent_turns_session_idx
  on agent_turns (session_id, sequence);

create table if not exists agent_checkpoints (
  checkpoint_id bigserial primary key,
  session_id uuid not null,
  organization_id uuid not null references organizations(id),
  sequence integer not null check (sequence >= 1),
  schema_version integer not null check (schema_version >= 1),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  fence bigint not null check (fence >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  foreign key (organization_id, session_id) references agent_sessions (organization_id, session_id)
);
create index if not exists agent_checkpoints_session_idx
  on agent_checkpoints (session_id, sequence desc);

create table if not exists agent_leases (
  session_id uuid primary key,
  organization_id uuid not null references organizations(id),
  owner_id text not null check (char_length(trim(owner_id)) between 1 and 160),
  fence bigint not null check (fence >= 1),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at >= acquired_at),
  foreign key (organization_id, session_id) references agent_sessions (organization_id, session_id)
);
create index if not exists agent_leases_expiry_idx
  on agent_leases (expires_at);

-- Turns and checkpoints are append-only: corrections create new rows.
create or replace function cvg_agent_runtime_append_only_guard() returns trigger
language plpgsql
as $$
begin
  raise exception 'agent runtime history is append-only' using errcode = '55000';
end;
$$;

drop trigger if exists agent_turns_append_only on agent_turns;
create trigger agent_turns_append_only
before update or delete on agent_turns
for each row execute function cvg_agent_runtime_append_only_guard();

drop trigger if exists agent_checkpoints_append_only on agent_checkpoints;
create trigger agent_checkpoints_append_only
before update or delete on agent_checkpoints
for each row execute function cvg_agent_runtime_append_only_guard();

-- Organization isolation for every new table (RLS + forced RLS).
do $$
declare
  table_name text;
begin
  foreach table_name in array array['agent_sessions', 'agent_turns', 'agent_checkpoints', 'agent_leases'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format(
      'create policy cvg_org_isolation on %I using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;
end $$;

-- Least privilege: the runtime role manages agent state but cannot touch
-- other tenants' rows (RLS also applies) and cannot delete sessions directly.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    grant select, insert, update on agent_sessions to cvg_runtime;
    grant select, insert on agent_turns to cvg_runtime;
    grant select, insert on agent_checkpoints to cvg_runtime;
    grant select, insert, update, delete on agent_leases to cvg_runtime;
    grant usage, select on sequence agent_checkpoints_checkpoint_id_seq to cvg_runtime;
  end if;
end $$;
