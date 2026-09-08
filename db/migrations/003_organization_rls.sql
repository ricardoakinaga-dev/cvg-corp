create or replace function cvg_request_organization() returns uuid
language sql stable
as $$ select nullif(current_setting('cvg.organization_id', true), '')::uuid $$;

alter table organizations enable row level security;
alter table organizations force row level security;
drop policy if exists cvg_org_isolation on organizations;
create policy cvg_org_isolation on organizations
  using (id = cvg_request_organization())
  with check (id = cvg_request_organization());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'units', 'workspaces', 'users', 'credentials', 'sessions', 'role_assignments',
    'authorization_state', 'audit_records', 'command_receipts', 'guardians', 'patients',
    'service_catalog_items', 'providers', 'resources', 'appointments', 'queue_entries',
    'encounters', 'clinical_documents', 'diagnostic_requests', 'specimens',
    'diagnostic_results', 'beds', 'hospital_episodes', 'medication_orders',
    'dispensations', 'administration_occurrences', 'products', 'stock_locations', 'lots',
    'stock_movements', 'charges', 'payments', 'ledger_entries', 'communication_messages',
    'knowledge_documents', 'ai_sessions', 'ai_approvals', 'budget_reservations',
    'integration_contracts', 'outbox_records', 'cvg_audit_ledger',
    'cvg_command_receipt_ledger'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format(
      'create policy cvg_org_isolation on %I using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;
end $$;
