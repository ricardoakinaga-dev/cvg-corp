-- Diagnostic requests are scoped by the encounter that owns them.  Keep
-- legacy organization-only requests explicit, but make every encounter-bound
-- row independently enforceable by PostgreSQL RLS and composite FKs.
alter table diagnostic_requests add column if not exists unit_id uuid;
alter table diagnostic_requests add column if not exists workspace_id uuid;

do $$
begin
  if exists (
    select 1
    from diagnostic_requests request
    join encounters encounter
      on encounter.organization_id = request.organization_id
     and encounter.id = request.encounter_id
    where request.encounter_id is not null
      and ((request.unit_id is not null and request.unit_id <> encounter.unit_id)
        or (request.workspace_id is not null and request.workspace_id <> encounter.workspace_id))
  ) then
    raise exception 'diagnostic request scope disagrees with its encounter';
  end if;
  if exists (
    select 1
    from diagnostic_requests
    where encounter_id is null
      and (unit_id is not null or workspace_id is not null)
  ) then
    raise exception 'organization-only diagnostic request cannot carry partial scope';
  end if;
end $$;

update diagnostic_requests as request
set unit_id = encounter.unit_id,
    workspace_id = encounter.workspace_id
from encounters as encounter
where encounter.organization_id = request.organization_id
  and encounter.id = request.encounter_id
  and (request.unit_id is null or request.workspace_id is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_scope_shape_check') then
    alter table diagnostic_requests add constraint diagnostic_requests_scope_shape_check
      check (
        (encounter_id is null and unit_id is null and workspace_id is null)
        or (encounter_id is not null and unit_id is not null and workspace_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'encounters_organization_id_scope_uq') then
    alter table encounters add constraint encounters_organization_id_scope_uq
      unique (organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'encounters_organization_id_patient_uq') then
    alter table encounters add constraint encounters_organization_id_patient_uq
      unique (organization_id, id, patient_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_unit_fk') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_unit_fk
      foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_workspace_fk') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_workspace_fk
      foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_encounter_scope_fk') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_encounter_scope_fk
      foreign key (organization_id, encounter_id, unit_id, workspace_id)
      references encounters(organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_encounter_patient_fk') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_encounter_patient_fk
      foreign key (organization_id, encounter_id, patient_id)
      references encounters(organization_id, id, patient_id);
  end if;
end $$;

create index if not exists diagnostic_requests_context_scope
  on diagnostic_requests (organization_id, unit_id, workspace_id, created_at, id);

alter table diagnostic_requests enable row level security;
alter table diagnostic_requests force row level security;
drop policy if exists cvg_org_isolation on diagnostic_requests;
drop policy if exists cvg_scope_read on diagnostic_requests;
drop policy if exists cvg_scope_insert on diagnostic_requests;
drop policy if exists cvg_scope_update on diagnostic_requests;
drop policy if exists cvg_scope_delete on diagnostic_requests;
create policy cvg_scope_read on diagnostic_requests for select
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_insert on diagnostic_requests for insert
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_update on diagnostic_requests for update
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_delete on diagnostic_requests for delete
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

comment on column diagnostic_requests.unit_id is 'Derived from the bound encounter; null only for legacy organization-scoped requests without an encounter.';
comment on column diagnostic_requests.workspace_id is 'Derived from the bound encounter; null only for legacy organization-scoped requests without an encounter.';
