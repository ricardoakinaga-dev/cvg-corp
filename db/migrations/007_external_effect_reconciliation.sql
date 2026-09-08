create unique index if not exists outbox_records_organization_id_id_uq on outbox_records (organization_id, id);

create table if not exists integration_inbox_records (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  consumer text not null,
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  record_digest text not null,
  status text not null check (status in ('RECEIVED', 'PROCESSED', 'QUARANTINED', 'RECONCILIATION_REQUIRED')),
  conflict_digest text,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_seen_at timestamptz not null default now(),
  unique (organization_id, consumer, provider, external_event_id)
);
create unique index if not exists integration_inbox_records_id_digest on integration_inbox_records (id, record_digest);
create index if not exists integration_inbox_records_reconciliation on integration_inbox_records (organization_id, status, last_seen_at, id);

create table if not exists external_effects (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  outbox_id uuid not null,
  integration_id text not null,
  idempotency_key text not null,
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  request_digest text not null,
  status text not null check (status in ('ADMISSION_PENDING', 'DISPATCHED', 'FAILED_RETRYABLE', 'SUCCEEDED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'QUARANTINED')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_by text,
  lease_until timestamptz,
  fence_token bigint not null default 0 check (fence_token >= 0),
  provider_request_id text,
  response jsonb check (response is null or jsonb_typeof(response) = 'object'),
  last_error text,
  outcome_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, integration_id, idempotency_key),
  unique (organization_id, outbox_id, integration_id),
  foreign key (organization_id, outbox_id) references outbox_records(organization_id, id)
);
create index if not exists external_effects_reconciliation on external_effects (organization_id, status, updated_at, id);
create index if not exists external_effects_outbox on external_effects (organization_id, outbox_id, integration_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['integration_inbox_records', 'external_effects'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format(
      'create policy cvg_org_isolation on %I using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;
end $$;
