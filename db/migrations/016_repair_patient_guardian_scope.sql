-- Repair the contextual patient/guardian projection after 015.
--
-- Earlier installations already have FORCE RLS on these tables. A migration
-- session without an organization setting therefore sees no rows during a
-- backfill. Run the repair with row_security disabled by the migration role;
-- an unprivileged role fails the migration instead of silently leaving data
-- unscoped. The relationship-derived scope remains deterministic and rows
-- without a defensible relationship remain NULL and hidden from scoped reads.

do $$
declare
  target_organization_id uuid;
begin
  perform set_config('row_security', 'off', true);

  for target_organization_id in select organization.id from organizations as organization loop
    perform set_config('cvg.organization_id', target_organization_id::text, true);
    perform set_config('cvg.unit_id', '', true);
    perform set_config('cvg.workspace_id', '', true);

    update patients as patient
    set unit_id = source.unit_id,
        workspace_id = source.workspace_id
    from (
      select distinct on (patient_id) patient_id, unit_id, workspace_id
      from (
        select patient_id, unit_id, workspace_id, 1 as priority, starts_at as observed_at, id
        from appointments
        where appointments.organization_id = target_organization_id
          and unit_id is not null
          and workspace_id is not null
        union all
        select patient_id, unit_id, workspace_id, 2 as priority, opened_at as observed_at, id
        from encounters
        where encounters.organization_id = target_organization_id
          and unit_id is not null
          and workspace_id is not null
      ) candidates
      order by patient_id, priority, observed_at, id
    ) source
    where patient.organization_id = target_organization_id
      and patient.id = source.patient_id
      and (patient.unit_id is null or patient.workspace_id is null);

    update guardians as guardian
    set unit_id = source.unit_id,
        workspace_id = source.workspace_id
    from (
      select distinct on (guardian_id) guardian_id, unit_id, workspace_id
      from patients
      where patients.organization_id = target_organization_id
        and unit_id is not null
        and workspace_id is not null
      order by guardian_id, created_at, id
    ) source
    where guardian.organization_id = target_organization_id
      and guardian.id = source.guardian_id
      and (guardian.unit_id is null or guardian.workspace_id is null);
  end loop;

  perform set_config('row_security', 'on', true);
end $$;
