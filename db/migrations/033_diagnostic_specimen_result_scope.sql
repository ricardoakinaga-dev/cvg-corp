-- Diagnostic children inherit the encounter scope instead of relying on a
-- join-time reconstruction. Legacy organization-only requests remain
-- representable, but encounter-bound specimens/results become independently
-- enforceable by RLS and composite foreign keys.
alter table specimens add column if not exists unit_id uuid;
alter table specimens add column if not exists workspace_id uuid;
alter table diagnostic_results add column if not exists unit_id uuid;
alter table diagnostic_results add column if not exists workspace_id uuid;

do $$
begin
  if exists (
    select 1
    from specimens specimen
    join diagnostic_requests request
      on request.organization_id = specimen.organization_id
     and request.id = specimen.request_id
    join encounters encounter
      on encounter.organization_id = request.organization_id
     and encounter.id = request.encounter_id
    where (specimen.unit_id is not null and specimen.unit_id <> encounter.unit_id)
       or (specimen.workspace_id is not null and specimen.workspace_id <> encounter.workspace_id)
  ) then
    raise exception 'specimen scope disagrees with its encounter';
  end if;
  if exists (
    select 1
    from specimens specimen
    join diagnostic_requests request
      on request.organization_id = specimen.organization_id
     and request.id = specimen.request_id
    where request.encounter_id is null
      and (specimen.unit_id is not null or specimen.workspace_id is not null)
  ) then
    raise exception 'organization-only specimen cannot carry a scope';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join diagnostic_requests request
      on request.organization_id = result_row.organization_id
     and request.id = result_row.request_id
    join encounters encounter
      on encounter.organization_id = request.organization_id
     and encounter.id = request.encounter_id
    where (result_row.unit_id is not null and result_row.unit_id <> encounter.unit_id)
       or (result_row.workspace_id is not null and result_row.workspace_id <> encounter.workspace_id)
  ) then
    raise exception 'diagnostic result scope disagrees with its encounter';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join diagnostic_requests request
      on request.organization_id = result_row.organization_id
     and request.id = result_row.request_id
    where request.encounter_id is null
      and (result_row.unit_id is not null or result_row.workspace_id is not null)
  ) then
    raise exception 'organization-only diagnostic result cannot carry a scope';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join specimens specimen
      on specimen.organization_id = result_row.organization_id
     and specimen.id = result_row.specimen_id
    where (result_row.unit_id is not null and specimen.unit_id is not null and result_row.unit_id <> specimen.unit_id)
       or (result_row.workspace_id is not null and specimen.workspace_id is not null and result_row.workspace_id <> specimen.workspace_id)
  ) then
    raise exception 'diagnostic result scope disagrees with its specimen';
  end if;
  if exists (select 1 from specimens where (unit_id is null) <> (workspace_id is null)) then
    raise exception 'specimens contains a partial unit/workspace scope';
  end if;
  if exists (select 1 from diagnostic_results where (unit_id is null) <> (workspace_id is null)) then
    raise exception 'diagnostic_results contains a partial unit/workspace scope';
  end if;
end $$;

update specimens as specimen
set unit_id = encounter.unit_id,
    workspace_id = encounter.workspace_id
from diagnostic_requests as request
join encounters as encounter
  on encounter.organization_id = request.organization_id
 and encounter.id = request.encounter_id
where request.organization_id = specimen.organization_id
  and request.id = specimen.request_id
  and (specimen.unit_id is null or specimen.workspace_id is null);

update diagnostic_results as result_row
set unit_id = encounter.unit_id,
    workspace_id = encounter.workspace_id
from diagnostic_requests as request
join encounters as encounter
  on encounter.organization_id = request.organization_id
 and encounter.id = request.encounter_id
where request.organization_id = result_row.organization_id
  and request.id = result_row.request_id
  and (result_row.unit_id is null or result_row.workspace_id is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'specimens_scope_shape_check') then
    alter table specimens add constraint specimens_scope_shape_check
      check ((unit_id is null and workspace_id is null) or (unit_id is not null and workspace_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_scope_shape_check') then
    alter table diagnostic_results add constraint diagnostic_results_scope_shape_check
      check ((unit_id is null and workspace_id is null) or (unit_id is not null and workspace_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_id_scope_uq') then
    alter table specimens add constraint specimens_organization_id_scope_uq
      unique (organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_id_scope_uq') then
    alter table diagnostic_results add constraint diagnostic_results_organization_id_scope_uq
      unique (organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_id_scope_uq') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_id_scope_uq
      unique (organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_unit_fk') then
    alter table specimens add constraint specimens_organization_unit_fk
      foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_workspace_fk') then
    alter table specimens add constraint specimens_organization_workspace_fk
      foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_request_scope_fk') then
    alter table specimens add constraint specimens_organization_request_scope_fk
      foreign key (organization_id, request_id, unit_id, workspace_id)
      references diagnostic_requests(organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_unit_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_unit_fk
      foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_workspace_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_workspace_fk
      foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_request_scope_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_request_scope_fk
      foreign key (organization_id, request_id, unit_id, workspace_id)
      references diagnostic_requests(organization_id, id, unit_id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_specimen_scope_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_specimen_scope_fk
      foreign key (organization_id, specimen_id, unit_id, workspace_id)
      references specimens(organization_id, id, unit_id, workspace_id);
  end if;
end $$;

create index if not exists specimens_context_scope
  on specimens (organization_id, unit_id, workspace_id, collected_at, id);
create index if not exists diagnostic_results_context_scope
  on diagnostic_results (organization_id, unit_id, workspace_id, created_at, id);

alter table specimens enable row level security;
alter table specimens force row level security;
drop policy if exists cvg_org_isolation on specimens;
drop policy if exists cvg_scope_read on specimens;
drop policy if exists cvg_scope_insert on specimens;
drop policy if exists cvg_scope_update on specimens;
drop policy if exists cvg_scope_delete on specimens;
create policy cvg_scope_read on specimens for select
  using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id));
create policy cvg_scope_insert on specimens for insert
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_update on specimens for update
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_delete on specimens for delete
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

alter table diagnostic_results enable row level security;
alter table diagnostic_results force row level security;
drop policy if exists cvg_org_isolation on diagnostic_results;
drop policy if exists cvg_scope_read on diagnostic_results;
drop policy if exists cvg_scope_insert on diagnostic_results;
drop policy if exists cvg_scope_update on diagnostic_results;
drop policy if exists cvg_scope_delete on diagnostic_results;
create policy cvg_scope_read on diagnostic_results for select
  using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id));
create policy cvg_scope_insert on diagnostic_results for insert
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_update on diagnostic_results for update
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_delete on diagnostic_results for delete
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

comment on column specimens.unit_id is 'Inherited from the bound diagnostic request encounter; null only for legacy organization-scoped requests.';
comment on column specimens.workspace_id is 'Inherited from the bound diagnostic request encounter; null only for legacy organization-scoped requests.';
comment on column diagnostic_results.unit_id is 'Inherited from the bound diagnostic request encounter; null only for legacy organization-scoped requests.';
comment on column diagnostic_results.workspace_id is 'Inherited from the bound diagnostic request encounter; null only for legacy organization-scoped requests.';
