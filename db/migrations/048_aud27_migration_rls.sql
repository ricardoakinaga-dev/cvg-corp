-- CVG-AUD27-011: append-only repair for the durable migration protocol
-- boundary.  047 remains checksum-stable; this migration protects an already
-- created protocol table without widening runtime access.
create or replace function cvg_aud27_request_tenant() returns text
language sql stable
as $$ select nullif(current_setting('cvg.aud27.tenant_id', true), '') $$;

alter table cvg_aud27_migration_checkpoints enable row level security;
alter table cvg_aud27_migration_checkpoints force row level security;
drop policy if exists cvg_aud27_tenant_isolation on cvg_aud27_migration_checkpoints;
create policy cvg_aud27_tenant_isolation on cvg_aud27_migration_checkpoints
  using (tenant_id = cvg_aud27_request_tenant())
  with check (tenant_id = cvg_aud27_request_tenant());

alter table cvg_aud27_migration_records enable row level security;
alter table cvg_aud27_migration_records force row level security;
drop policy if exists cvg_aud27_tenant_isolation on cvg_aud27_migration_records;
create policy cvg_aud27_tenant_isolation on cvg_aud27_migration_records
  using (tenant_id = cvg_aud27_request_tenant())
  with check (tenant_id = cvg_aud27_request_tenant());

revoke all on table cvg_aud27_migration_checkpoints, cvg_aud27_migration_records from cvg_runtime;
