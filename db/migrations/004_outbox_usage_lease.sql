alter table outbox_records add column if not exists record_digest text;
alter table outbox_records add column if not exists available_at timestamptz;
alter table outbox_records add column if not exists claimed_by text;
alter table outbox_records add column if not exists lease_until timestamptz;
alter table outbox_records add column if not exists fence_token bigint;
alter table outbox_records add column if not exists last_error text;
alter table outbox_records add column if not exists processed_at timestamptz;

update outbox_records
set record_digest = encode(digest(jsonb_build_object('eventType', event_type, 'aggregateId', aggregate_id, 'payload', payload)::text, 'sha256'), 'hex')
where record_digest is null;
update outbox_records set available_at = created_at where available_at is null;
update outbox_records set fence_token = 0 where fence_token is null;
alter table outbox_records alter column record_digest set not null;
alter table outbox_records alter column available_at set default now();
alter table outbox_records alter column available_at set not null;
alter table outbox_records alter column fence_token set default 0;
alter table outbox_records alter column fence_token set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outbox_records_status_check') then
    alter table outbox_records add constraint outbox_records_status_check check (status in ('PENDING', 'CLAIMED', 'DELIVERED', 'FAILED', 'QUARANTINED'));
  end if;
end $$;

create index if not exists outbox_records_claimable on outbox_records (organization_id, status, available_at, created_at, id);
create index if not exists outbox_records_lease on outbox_records (organization_id, status, lease_until);

create table if not exists ai_usage_ledger (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  reservation_id uuid references budget_reservations(id),
  provider_request_id text,
  idempotency_key text not null,
  usage_kind text not null,
  reserved_units integer not null check (reserved_units >= 0),
  consumed_units integer not null check (consumed_units >= 0),
  status text not null check (status in ('RECEIVED', 'SETTLED', 'RECONCILIATION_REQUIRED', 'QUARANTINED')),
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  record_digest text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key, usage_kind)
);
create index if not exists ai_usage_ledger_scope on ai_usage_ledger (organization_id, created_at, id);

alter table ai_usage_ledger enable row level security;
alter table ai_usage_ledger force row level security;
drop policy if exists cvg_org_isolation on ai_usage_ledger;
create policy cvg_org_isolation on ai_usage_ledger
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());
