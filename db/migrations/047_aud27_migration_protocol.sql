-- CVG-AUD27-011: durable, tenant-scoped migration protocol state.
-- The migration/schema owner owns these tables. Runtime connections do not
-- receive access: this protocol is for an explicitly authorized migration
-- operator, never an application fallback.
create table if not exists cvg_aud27_migration_checkpoints (
  run_id text not null check (length(run_id) between 1 and 160),
  slice text not null check (slice ~ '^[a-z][a-z0-9-]{1,63}$'),
  tenant_id text not null check (length(tenant_id) between 1 and 256),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  processed_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(processed_keys) = 'array'),
  cursor text,
  status text not null check (status in ('RUNNING', 'CHECKPOINTED', 'DRY_RUN', 'RECONCILED', 'ROLLED_BACK', 'QUARANTINED')),
  updated_at timestamptz not null,
  primary key (run_id, slice, tenant_id)
);

create table if not exists cvg_aud27_migration_records (
  run_id text not null check (length(run_id) between 1 and 160),
  slice text not null check (slice ~ '^[a-z][a-z0-9-]{1,63}$'),
  tenant_id text not null check (length(tenant_id) between 1 and 256),
  record_key text not null check (length(record_key) between 1 and 256),
  version bigint not null check (version >= 1),
  value jsonb not null,
  value_digest text not null check (value_digest ~ '^[a-f0-9]{64}$'),
  command_id text not null check (length(command_id) between 1 and 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, slice, tenant_id, record_key),
  unique (run_id, slice, tenant_id, command_id)
);

create index if not exists cvg_aud27_migration_records_tenant
  on cvg_aud27_migration_records (slice, tenant_id, record_key);

revoke all on table cvg_aud27_migration_checkpoints, cvg_aud27_migration_records from cvg_runtime;
