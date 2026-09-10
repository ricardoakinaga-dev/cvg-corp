-- Close the remaining diagnostic child integrity gaps at the database boundary.
-- Migration 033 keeps null/null scope for legacy organization-only requests;
-- these guards make that compatibility explicit instead of letting NULL-valued
-- composite foreign keys bypass an encounter-bound parent.

do $$
begin
  if exists (
    select 1
    from specimens specimen
    join diagnostic_requests request
      on request.organization_id = specimen.organization_id
     and request.id = specimen.request_id
    where specimen.patient_id is distinct from request.patient_id
  ) then
    raise exception 'specimen patient disagrees with its diagnostic request';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join diagnostic_requests request
      on request.organization_id = result_row.organization_id
     and request.id = result_row.request_id
    where result_row.patient_id is distinct from request.patient_id
  ) then
    raise exception 'diagnostic result patient disagrees with its diagnostic request';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join specimens specimen
      on specimen.organization_id = result_row.organization_id
     and specimen.id = result_row.specimen_id
    where result_row.request_id is distinct from specimen.request_id
       or result_row.patient_id is distinct from specimen.patient_id
  ) then
    raise exception 'diagnostic result chain disagrees with its specimen';
  end if;
  if exists (
    select 1
    from specimens specimen
    join diagnostic_requests request
      on request.organization_id = specimen.organization_id
     and request.id = specimen.request_id
    where request.encounter_id is not null
      and (specimen.unit_id is distinct from request.unit_id
        or specimen.workspace_id is distinct from request.workspace_id)
  ) then
    raise exception 'encounter-bound specimen must carry the request scope';
  end if;
  if exists (
    select 1
    from diagnostic_results result_row
    join diagnostic_requests request
      on request.organization_id = result_row.organization_id
     and request.id = result_row.request_id
    where request.encounter_id is not null
      and (result_row.unit_id is distinct from request.unit_id
        or result_row.workspace_id is distinct from request.workspace_id)
  ) then
    raise exception 'encounter-bound diagnostic result must carry the request scope';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_requests_organization_id_patient_uq') then
    alter table diagnostic_requests add constraint diagnostic_requests_organization_id_patient_uq
      unique (organization_id, id, patient_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_request_id_patient_uq') then
    alter table specimens add constraint specimens_organization_request_id_patient_uq
      unique (organization_id, request_id, id, patient_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specimens_organization_request_patient_fk') then
    alter table specimens add constraint specimens_organization_request_patient_fk
      foreign key (organization_id, request_id, patient_id)
      references diagnostic_requests(organization_id, id, patient_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_request_patient_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_request_patient_fk
      foreign key (organization_id, request_id, patient_id)
      references diagnostic_requests(organization_id, id, patient_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diagnostic_results_organization_request_specimen_patient_fk') then
    alter table diagnostic_results add constraint diagnostic_results_organization_request_specimen_patient_fk
      foreign key (organization_id, request_id, specimen_id, patient_id)
      references specimens(organization_id, request_id, id, patient_id);
  end if;
end $$;

create or replace function cvg_diagnostic_specimen_integrity_guard() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  request_row record;
begin
  select request.encounter_id, request.patient_id, request.unit_id, request.workspace_id
    into request_row
    from diagnostic_requests request
   where request.organization_id = new.organization_id
     and request.id = new.request_id;
  if not found then
    raise exception 'diagnostic specimen request is not visible in the same organization' using errcode = '23503';
  end if;
  if new.patient_id is distinct from request_row.patient_id then
    raise exception 'diagnostic specimen patient must match its request' using errcode = '23514';
  end if;
  if request_row.encounter_id is null then
    if new.unit_id is not null or new.workspace_id is not null then
      raise exception 'organization-only diagnostic specimen must remain unscoped' using errcode = '23514';
    end if;
  elsif new.unit_id is distinct from request_row.unit_id
     or new.workspace_id is distinct from request_row.workspace_id then
    raise exception 'diagnostic specimen scope must match its request encounter' using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function cvg_diagnostic_result_integrity_guard() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  request_row record;
  specimen_row record;
begin
  select request.encounter_id, request.patient_id, request.unit_id, request.workspace_id
    into request_row
    from diagnostic_requests request
   where request.organization_id = new.organization_id
     and request.id = new.request_id;
  if not found then
    raise exception 'diagnostic result request is not visible in the same organization' using errcode = '23503';
  end if;
  if new.patient_id is distinct from request_row.patient_id then
    raise exception 'diagnostic result patient must match its request' using errcode = '23514';
  end if;
  if request_row.encounter_id is null then
    if new.unit_id is not null or new.workspace_id is not null then
      raise exception 'organization-only diagnostic result must remain unscoped' using errcode = '23514';
    end if;
  elsif new.unit_id is distinct from request_row.unit_id
     or new.workspace_id is distinct from request_row.workspace_id then
    raise exception 'diagnostic result scope must match its request encounter' using errcode = '23514';
  end if;

  select specimen.request_id, specimen.patient_id, specimen.unit_id, specimen.workspace_id
    into specimen_row
    from specimens specimen
   where specimen.organization_id = new.organization_id
     and specimen.id = new.specimen_id;
  if not found then
    raise exception 'diagnostic result specimen is not visible in the same organization' using errcode = '23503';
  end if;
  if new.request_id is distinct from specimen_row.request_id
     or new.patient_id is distinct from specimen_row.patient_id then
    raise exception 'diagnostic result must retain the specimen request and patient chain' using errcode = '23514';
  end if;
  if new.unit_id is distinct from specimen_row.unit_id
     or new.workspace_id is distinct from specimen_row.workspace_id then
    raise exception 'diagnostic result scope must match its specimen' using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function cvg_diagnostic_request_children_guard() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1
      from specimens specimen
     where specimen.organization_id = new.organization_id
       and specimen.request_id = new.id
       and (
         specimen.patient_id is distinct from new.patient_id
         or (new.encounter_id is null and (specimen.unit_id is not null or specimen.workspace_id is not null))
         or (new.encounter_id is not null and (
           specimen.unit_id is distinct from new.unit_id
           or specimen.workspace_id is distinct from new.workspace_id
         ))
       )
  ) then
    raise exception 'diagnostic request update would orphan specimen integrity' using errcode = '23514';
  end if;
  if exists (
    select 1
      from diagnostic_results result_row
     where result_row.organization_id = new.organization_id
       and result_row.request_id = new.id
       and (
         result_row.patient_id is distinct from new.patient_id
         or (new.encounter_id is null and (result_row.unit_id is not null or result_row.workspace_id is not null))
         or (new.encounter_id is not null and (
           result_row.unit_id is distinct from new.unit_id
           or result_row.workspace_id is distinct from new.workspace_id
         ))
       )
  ) then
    raise exception 'diagnostic request update would orphan result integrity' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists cvg_diagnostic_specimen_integrity_guard on specimens;
create trigger cvg_diagnostic_specimen_integrity_guard
before insert or update of organization_id, request_id, patient_id, unit_id, workspace_id on specimens
for each row execute function cvg_diagnostic_specimen_integrity_guard();

drop trigger if exists cvg_diagnostic_result_integrity_guard on diagnostic_results;
create trigger cvg_diagnostic_result_integrity_guard
before insert or update of organization_id, request_id, specimen_id, patient_id, unit_id, workspace_id on diagnostic_results
for each row execute function cvg_diagnostic_result_integrity_guard();

drop trigger if exists cvg_diagnostic_request_children_guard on diagnostic_requests;
create trigger cvg_diagnostic_request_children_guard
before update of organization_id, patient_id, encounter_id, unit_id, workspace_id on diagnostic_requests
for each row execute function cvg_diagnostic_request_children_guard();

-- Reads of diagnostic children must use the same exact scope contract as
-- request DML. Organization-only context must not enumerate encounter-bound
-- children merely because the generic read helper is intentionally permissive.
drop policy if exists cvg_scope_read on specimens;
create policy cvg_scope_read on specimens for select
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

drop policy if exists cvg_scope_read on diagnostic_results;
create policy cvg_scope_read on diagnostic_results for select
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

comment on function cvg_diagnostic_specimen_integrity_guard() is 'Rejects null-scope bypasses and patient/scope drift for diagnostic specimens.';
comment on function cvg_diagnostic_result_integrity_guard() is 'Rejects null-scope bypasses and request/specimen/patient drift for diagnostic results.';
