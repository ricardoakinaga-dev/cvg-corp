create or replace function cvg_request_unit() returns uuid
language sql stable
as $$ select nullif(current_setting('cvg.unit_id', true), '')::uuid $$;

create or replace function cvg_request_workspace() returns uuid
language sql stable
as $$ select nullif(current_setting('cvg.workspace_id', true), '')::uuid $$;

alter table appointments enable row level security;
alter table appointments force row level security;
drop policy if exists cvg_org_isolation on appointments;
drop policy if exists cvg_appointments_read on appointments;
drop policy if exists cvg_appointments_insert on appointments;
drop policy if exists cvg_appointments_update on appointments;
drop policy if exists cvg_appointments_delete on appointments;

create policy cvg_appointments_read on appointments
  for select
  using (
    organization_id = cvg_request_organization()
    and (cvg_request_unit() is null or unit_id = cvg_request_unit())
    and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
  );
create policy cvg_appointments_insert on appointments
  for insert
  with check (organization_id = cvg_request_organization());
create policy cvg_appointments_update on appointments
  for update
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());
create policy cvg_appointments_delete on appointments
  for delete
  using (organization_id = cvg_request_organization());
