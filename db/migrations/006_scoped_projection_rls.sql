create or replace function cvg_request_scope_allows(target_unit uuid, target_workspace uuid) returns boolean
language sql stable
as $$
  select (target_unit is null or cvg_request_unit() is null or target_unit = cvg_request_unit())
    and (target_workspace is null or cvg_request_workspace() is null or target_workspace = cvg_request_workspace())
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'appointments', 'encounters', 'communication_messages', 'knowledge_documents',
    'ai_sessions', 'ai_approvals', 'audit_records', 'command_receipts', 'role_assignments'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format('drop policy if exists cvg_appointments_read on %I', table_name);
    execute format('drop policy if exists cvg_appointments_insert on %I', table_name);
    execute format('drop policy if exists cvg_appointments_update on %I', table_name);
    execute format('drop policy if exists cvg_appointments_delete on %I', table_name);
    execute format('drop policy if exists cvg_scope_read on %I', table_name);
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
    execute format(
      'create policy cvg_scope_read on %I for select using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization())',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'providers', 'resources', 'queue_entries', 'beds', 'hospital_episodes',
    'stock_locations', 'charges'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format('drop policy if exists cvg_scope_read on %I', table_name);
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
    execute format(
      'create policy cvg_scope_read on %I for select using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, null))',
      table_name
    );
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization())',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;
end $$;

create index if not exists appointments_scope_rls on appointments (organization_id, unit_id, workspace_id, id);
create index if not exists encounters_scope_rls on encounters (organization_id, unit_id, workspace_id, id);
create index if not exists communication_messages_scope_rls on communication_messages (organization_id, unit_id, workspace_id, id);
create index if not exists knowledge_documents_scope_rls on knowledge_documents (organization_id, unit_id, workspace_id, id);
create index if not exists ai_sessions_scope_rls on ai_sessions (organization_id, unit_id, workspace_id, id);
create index if not exists ai_approvals_scope_rls on ai_approvals (organization_id, unit_id, workspace_id, id);
create index if not exists audit_records_scope_rls on audit_records (organization_id, unit_id, workspace_id, id);
create index if not exists command_receipts_scope_rls on command_receipts (organization_id, unit_id, workspace_id, id);
create index if not exists role_assignments_scope_rls on role_assignments (organization_id, unit_id, workspace_id, id);
