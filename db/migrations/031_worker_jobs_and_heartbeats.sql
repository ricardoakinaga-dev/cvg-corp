-- Durable non-outbox worker lanes. A job is an immutable work admission; only
-- its lifecycle/lease fields may change. Idempotency is tenant-scoped so a
-- replay cannot silently bind work to another organization.
create table if not exists cvg_worker_jobs (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  lane text not null check (lane in ('jobs', 'schedule', 'reconciliation', 'notifications', 'maintenance')),
  job_type text not null check (char_length(trim(job_type)) between 1 and 160),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 1 and 512),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null check (status in ('PENDING', 'CLAIMED', 'COMPLETED', 'QUARANTINED')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  claimed_by text check (claimed_by is null or char_length(trim(claimed_by)) between 1 and 160),
  lease_until timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 2_000),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  record_digest text not null check (record_digest ~ '^[a-f0-9]{64}$'),
  unique (organization_id, lane, idempotency_key),
  unique (organization_id, id)
);
create index if not exists cvg_worker_jobs_claimable
  on cvg_worker_jobs (organization_id, lane, status, available_at, created_at, id);
create index if not exists cvg_worker_jobs_leases
  on cvg_worker_jobs (organization_id, lane, status, lease_until, id);

create or replace function cvg_worker_job_immutable_guard() returns trigger
language plpgsql
as $$
begin
  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.lane is distinct from new.lane
     or old.job_type is distinct from new.job_type
     or old.idempotency_key is distinct from new.idempotency_key
     or old.payload is distinct from new.payload
     or old.max_attempts is distinct from new.max_attempts
     or old.created_at is distinct from new.created_at
     or old.record_digest is distinct from new.record_digest then
    raise exception 'worker job admission is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists cvg_worker_jobs_immutable_guard on cvg_worker_jobs;
create trigger cvg_worker_jobs_immutable_guard
before update on cvg_worker_jobs
for each row execute function cvg_worker_job_immutable_guard();

-- Heartbeats are tenant-scoped liveness evidence. The expiry is intentionally
-- persisted rather than inferred from process-local state.
create table if not exists cvg_worker_heartbeats (
  organization_id uuid not null references organizations(id),
  worker_id text not null check (char_length(trim(worker_id)) between 1 and 160),
  status text not null check (status in ('RUNNING', 'DEGRADED', 'STOPPING', 'STOPPED')),
  lane text check (lane is null or lane in ('outbox', 'jobs', 'schedule', 'reconciliation', 'notifications', 'maintenance')),
  cycle_id uuid,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  detail text check (detail is null or char_length(detail) <= 2_000),
  updated_at timestamptz not null default now(),
  primary key (organization_id, worker_id),
  check (expires_at >= last_seen_at),
  check (last_seen_at >= started_at)
);
create index if not exists cvg_worker_heartbeats_liveness
  on cvg_worker_heartbeats (organization_id, status, expires_at, worker_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['cvg_worker_jobs', 'cvg_worker_heartbeats'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format(
      'create policy cvg_org_isolation on %I using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
    execute format('revoke all on %I from public', table_name);
    execute format('grant select, insert, update on %I to cvg_runtime', table_name);
  end loop;
end $$;

comment on table cvg_worker_jobs is 'Tenant-scoped durable worker jobs with idempotent admission, leases, fencing and quarantine.';
comment on table cvg_worker_heartbeats is 'Tenant-scoped worker liveness and shutdown evidence.';
