-- The application boundary now emits an explicit provenance/usage pair for
-- every AI turn that is allowed to reach the canonical store. The usage row is
-- immutable by idempotency key and is linked to the turn in the same tenant.
alter table ai_turns add column if not exists usage_record_id uuid;
alter table ai_turns add column if not exists provenance_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_usage_ledger_organization_id_id_uq') then
    alter table ai_usage_ledger add constraint ai_usage_ledger_organization_id_id_uq unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_turns_usage_record_fk') then
    alter table ai_turns add constraint ai_turns_usage_record_fk
      foreign key (organization_id, usage_record_id)
      references ai_usage_ledger(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_turns_provenance_object_check') then
    alter table ai_turns add constraint ai_turns_provenance_object_check
      check (jsonb_typeof(provenance_json) = 'object');
  end if;
end $$;

create index if not exists ai_turns_usage_record_scope
  on ai_turns (organization_id, usage_record_id);
create index if not exists ai_turns_provenance_scope
  on ai_turns (organization_id, created_at, id);

-- cvg_request_scope_allows is intentionally permissive for reads. DML needs
-- an exact tenant context: a unit-scoped row cannot be changed with an empty
-- unit context, and an organization-scoped row cannot be changed while a unit
-- context is active. A workspace context may still change unit-wide rows.
create or replace function cvg_request_dml_scope_allows(target_unit uuid, target_workspace uuid) returns boolean
language sql stable
as $$
  select
    (
      (target_unit is null and cvg_request_unit() is null)
      or (target_unit is not null and cvg_request_unit() is not null and target_unit = cvg_request_unit())
    )
    and (
      target_workspace is null
      or (cvg_request_workspace() is not null and target_workspace = cvg_request_workspace())
    )
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'appointments', 'encounters', 'communication_messages', 'knowledge_documents',
    'ai_sessions', 'ai_approvals'
  ] loop
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id)) with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'providers', 'resources', 'queue_entries', 'beds', 'hospital_episodes',
    'stock_locations', 'charges'
  ] loop
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, null))',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, null)) with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, null))',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, null))',
      table_name
    );
  end loop;

  foreach table_name in array array['ai_turns', 'ai_drafts'] loop
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id)) with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))',
      table_name
    );
  end loop;
end $$;

drop policy if exists cvg_scope_insert on patients;
drop policy if exists cvg_scope_update on patients;
drop policy if exists cvg_scope_delete on patients;
create policy cvg_scope_insert on patients for insert
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_update on patients for update
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_delete on patients for delete
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));

drop policy if exists cvg_scope_insert on guardians;
drop policy if exists cvg_scope_update on guardians;
drop policy if exists cvg_scope_delete on guardians;
create policy cvg_scope_insert on guardians for insert
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_update on guardians for update
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id))
  with check (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
create policy cvg_scope_delete on guardians for delete
  using (organization_id = cvg_request_organization() and cvg_request_dml_scope_allows(unit_id, workspace_id));
