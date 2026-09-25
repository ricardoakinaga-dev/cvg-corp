-- Close the remaining unit/workspace DML gap in rows that already use scoped
-- reads. The helper is defined in 029 and requires exact DML scope matching.
-- Existing organization-wide rows are writable only with organization scope;
-- unit/workspace rows must carry the matching request context.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['audit_records', 'command_receipts', 'role_assignments'] loop
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
