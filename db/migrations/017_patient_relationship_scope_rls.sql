-- Keep PostgreSQL patient visibility aligned with the domain PDP: a patient
-- may be reached in the exact context of an appointment, encounter or
-- communication even when its registration scope belongs to another
-- workspace. The relationship is still tenant-bound and RLS-filtered.

drop policy if exists cvg_scope_read on patients;
create policy cvg_scope_read on patients for select using (
  organization_id = cvg_request_organization()
  and (
    cvg_request_unit() is null
    or (unit_id = cvg_request_unit() and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace()))
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
