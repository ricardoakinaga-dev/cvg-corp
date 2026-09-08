-- Patient and guardian data is D3/D2 contextual data, not an organization
-- directory. A direct SQL consumer must provide at least a unit context;
-- application requestContext already requires unit + workspace for these routes.
-- Keep the relationship exception bounded to the same unit and optional
-- workspace, so missing context cannot become an organization-wide read.

drop policy if exists cvg_scope_read on patients;
create policy cvg_scope_read on patients for select using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and (
    (unit_id = cvg_request_unit() and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace()))
    or exists (
      select 1 from appointments a
      where a.organization_id = patients.organization_id
        and a.patient_id = patients.id
        and a.unit_id = cvg_request_unit()
        and (cvg_request_workspace() is null or a.workspace_id = cvg_request_workspace())
    )
    or exists (
      select 1 from encounters e
      where e.organization_id = patients.organization_id
        and e.patient_id = patients.id
        and e.unit_id = cvg_request_unit()
        and (cvg_request_workspace() is null or e.workspace_id = cvg_request_workspace())
    )
    or exists (
      select 1 from communication_messages m
      where m.organization_id = patients.organization_id
        and m.patient_id = patients.id
        and m.unit_id = cvg_request_unit()
        and (cvg_request_workspace() is null or m.workspace_id = cvg_request_workspace())
    )
  )
);

drop policy if exists cvg_scope_read on guardians;
create policy cvg_scope_read on guardians for select using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and (
    (unit_id = cvg_request_unit() and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace()))
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
