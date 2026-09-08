-- Patient and guardian reads are contextual resources, not organization-wide
-- directories. Legacy rows that cannot be assigned a scope remain hidden from
-- scoped reads until an explicit reconciliation supplies one.

alter table guardians add column if not exists unit_id uuid;
alter table guardians add column if not exists workspace_id uuid;
alter table patients add column if not exists unit_id uuid;
alter table patients add column if not exists workspace_id uuid;

-- Prefer the first appointment, then the first encounter, as the deterministic
-- migration source for synthetic/legacy rows. No guessed organization or
-- workspace is introduced when no relationship exists.
update patients as patient
set unit_id = source.unit_id,
    workspace_id = source.workspace_id
from (
  select distinct on (patient_id) patient_id, unit_id, workspace_id
  from (
    select patient_id, unit_id, workspace_id, 1 as priority, starts_at as observed_at, id
    from appointments
    where unit_id is not null and workspace_id is not null
    union all
    select patient_id, unit_id, workspace_id, 2 as priority, opened_at as observed_at, id
    from encounters
    where unit_id is not null and workspace_id is not null
  ) candidates
  order by patient_id, priority, observed_at, id
) source
where patient.id = source.patient_id
  and (patient.unit_id is null or patient.workspace_id is null);

update guardians as guardian
set unit_id = source.unit_id,
    workspace_id = source.workspace_id
from (
  select distinct on (guardian_id) guardian_id, unit_id, workspace_id
  from patients
  where unit_id is not null and workspace_id is not null
  order by guardian_id, created_at, id
) source
where guardian.id = source.guardian_id
  and (guardian.unit_id is null or guardian.workspace_id is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patients_scope_shape_check') then
    alter table patients add constraint patients_scope_shape_check
      check (workspace_id is null or unit_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guardians_scope_shape_check') then
    alter table guardians add constraint guardians_scope_shape_check
      check (workspace_id is null or unit_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patients_organization_unit_fk') then
    alter table patients add constraint patients_organization_unit_fk
      foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patients_organization_workspace_fk') then
    alter table patients add constraint patients_organization_workspace_fk
      foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guardians_organization_unit_fk') then
    alter table guardians add constraint guardians_organization_unit_fk
      foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guardians_organization_workspace_fk') then
    alter table guardians add constraint guardians_organization_workspace_fk
      foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
end $$;

create index if not exists patients_context_scope on patients (organization_id, unit_id, workspace_id, status, id);
create index if not exists guardians_context_scope on guardians (organization_id, unit_id, workspace_id, status, id);

alter table patients enable row level security;
alter table patients force row level security;
drop policy if exists cvg_org_isolation on patients;
drop policy if exists cvg_scope_read on patients;
drop policy if exists cvg_scope_insert on patients;
drop policy if exists cvg_scope_update on patients;
drop policy if exists cvg_scope_delete on patients;
create policy cvg_scope_read on patients for select using (
  organization_id = cvg_request_organization()
  and (cvg_request_unit() is null or (unit_id = cvg_request_unit() and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())))
);
create policy cvg_scope_insert on patients for insert with check (organization_id = cvg_request_organization());
create policy cvg_scope_update on patients for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization());
create policy cvg_scope_delete on patients for delete using (organization_id = cvg_request_organization());

alter table guardians enable row level security;
alter table guardians force row level security;
drop policy if exists cvg_org_isolation on guardians;
drop policy if exists cvg_scope_read on guardians;
drop policy if exists cvg_scope_insert on guardians;
drop policy if exists cvg_scope_update on guardians;
drop policy if exists cvg_scope_delete on guardians;
create policy cvg_scope_read on guardians for select using (
  organization_id = cvg_request_organization()
  and (
    cvg_request_unit() is null
    or (unit_id = cvg_request_unit() and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace()))
    or exists (
      select 1 from patients p
      where p.organization_id = guardians.organization_id
        and p.guardian_id = guardians.id
        and p.status = 'ACTIVE'
        and p.unit_id = cvg_request_unit()
        and (cvg_request_workspace() is null or p.workspace_id = cvg_request_workspace())
    )
  )
);
create policy cvg_scope_insert on guardians for insert with check (organization_id = cvg_request_organization());
create policy cvg_scope_update on guardians for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization());
create policy cvg_scope_delete on guardians for delete using (organization_id = cvg_request_organization());
