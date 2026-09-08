-- A tenant id on the child row is not enough: every cross-table reference must
-- carry the same organization provenance. Existing inconsistent legacy rows
-- make this migration fail closed instead of being silently reassigned.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'units', 'workspaces', 'audit_records', 'guardians', 'patients',
    'service_catalog_items', 'providers', 'resources', 'appointments', 'encounters',
    'clinical_documents', 'clinical_addenda', 'diagnostic_requests', 'specimens',
    'beds', 'hospital_episodes', 'medication_orders', 'products', 'stock_locations',
    'lots', 'charges', 'ai_sessions', 'ai_turns', 'lifecycle_decisions'
  ] loop
    execute format('create unique index if not exists %I on %I (organization_id, id)', table_name || '_organization_id_id_uq', table_name);
  end loop;
end $$;

do $$
declare
  link record;
begin
  for link in
    select * from (values
      ('audit_records', 'audit_records_organization_actor_fk', 'organization_id, actor_id', 'users', 'organization_id, id'),
      ('command_receipts', 'command_receipts_organization_actor_fk', 'organization_id, actor_id', 'users', 'organization_id, id'),
      ('command_receipts', 'command_receipts_organization_audit_fk', 'organization_id, audit_record_id', 'audit_records', 'organization_id, id'),
      ('patients', 'patients_organization_guardian_fk', 'organization_id, guardian_id', 'guardians', 'organization_id, id'),
      ('patients', 'patients_organization_merged_into_fk', 'organization_id, merged_into_id', 'patients', 'organization_id, id'),
      ('appointments', 'appointments_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('appointments', 'appointments_organization_provider_fk', 'organization_id, provider_id', 'providers', 'organization_id, id'),
      ('appointments', 'appointments_organization_resource_fk', 'organization_id, resource_id', 'resources', 'organization_id, id'),
      ('appointments', 'appointments_organization_service_fk', 'organization_id, service_id', 'service_catalog_items', 'organization_id, id'),
      ('queue_entries', 'queue_entries_organization_appointment_fk', 'organization_id, appointment_id', 'appointments', 'organization_id, id'),
      ('queue_entries', 'queue_entries_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('encounters', 'encounters_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('encounters', 'encounters_organization_appointment_fk', 'organization_id, appointment_id', 'appointments', 'organization_id, id'),
      ('clinical_documents', 'clinical_documents_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('clinical_documents', 'clinical_documents_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('clinical_documents', 'clinical_documents_organization_author_fk', 'organization_id, author_id', 'users', 'organization_id, id'),
      ('clinical_documents', 'clinical_documents_organization_signed_by_fk', 'organization_id, signed_by', 'users', 'organization_id, id'),
      ('clinical_addenda', 'clinical_addenda_organization_author_fk', 'organization_id, author_id', 'users', 'organization_id, id'),
      ('diagnostic_requests', 'diagnostic_requests_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('diagnostic_requests', 'diagnostic_requests_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('diagnostic_requests', 'diagnostic_requests_organization_requested_by_fk', 'organization_id, requested_by', 'users', 'organization_id, id'),
      ('specimens', 'specimens_organization_request_fk', 'organization_id, request_id', 'diagnostic_requests', 'organization_id, id'),
      ('specimens', 'specimens_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('diagnostic_results', 'diagnostic_results_organization_request_fk', 'organization_id, request_id', 'diagnostic_requests', 'organization_id, id'),
      ('diagnostic_results', 'diagnostic_results_organization_specimen_fk', 'organization_id, specimen_id', 'specimens', 'organization_id, id'),
      ('diagnostic_results', 'diagnostic_results_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('hospital_episodes', 'hospital_episodes_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('hospital_episodes', 'hospital_episodes_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('hospital_episodes', 'hospital_episodes_organization_bed_fk', 'organization_id, bed_id', 'beds', 'organization_id, id'),
      ('medication_orders', 'medication_orders_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('medication_orders', 'medication_orders_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('medication_orders', 'medication_orders_organization_product_fk', 'organization_id, product_id', 'products', 'organization_id, id'),
      ('medication_orders', 'medication_orders_organization_prescribed_by_fk', 'organization_id, prescribed_by', 'users', 'organization_id, id'),
      ('dispensations', 'dispensations_organization_medication_order_fk', 'organization_id, medication_order_id', 'medication_orders', 'organization_id, id'),
      ('dispensations', 'dispensations_organization_lot_fk', 'organization_id, lot_id', 'lots', 'organization_id, id'),
      ('dispensations', 'dispensations_organization_dispensed_by_fk', 'organization_id, dispensed_by', 'users', 'organization_id, id'),
      ('administration_occurrences', 'administration_occurrences_organization_medication_order_fk', 'organization_id, medication_order_id', 'medication_orders', 'organization_id, id'),
      ('administration_occurrences', 'administration_occurrences_organization_administered_by_fk', 'organization_id, administered_by', 'users', 'organization_id, id'),
      ('lots', 'lots_organization_product_fk', 'organization_id, product_id', 'products', 'organization_id, id'),
      ('lots', 'lots_organization_location_fk', 'organization_id, location_id', 'stock_locations', 'organization_id, id'),
      ('stock_movements', 'stock_movements_organization_product_fk', 'organization_id, product_id', 'products', 'organization_id, id'),
      ('stock_movements', 'stock_movements_organization_lot_fk', 'organization_id, lot_id', 'lots', 'organization_id, id'),
      ('stock_movements', 'stock_movements_organization_location_fk', 'organization_id, location_id', 'stock_locations', 'organization_id, id'),
      ('stock_movements', 'stock_movements_organization_created_by_fk', 'organization_id, created_by', 'users', 'organization_id, id'),
      ('stock_locations', 'stock_locations_organization_unit_fk', 'organization_id, unit_id', 'units', 'organization_id, id'),
      ('charges', 'charges_organization_unit_fk', 'organization_id, unit_id', 'units', 'organization_id, id'),
      ('charges', 'charges_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('payments', 'payments_organization_charge_fk', 'organization_id, charge_id', 'charges', 'organization_id, id'),
      ('communication_messages', 'communication_messages_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('ai_sessions', 'ai_sessions_organization_actor_fk', 'organization_id, actor_id', 'users', 'organization_id, id'),
      ('ai_sessions', 'ai_sessions_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('ai_sessions', 'ai_sessions_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('ai_drafts', 'ai_drafts_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('ai_drafts', 'ai_drafts_organization_source_turn_fk', 'organization_id, source_turn_id', 'ai_turns', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_actor_fk', 'organization_id, actor_id', 'users', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_session_fk', 'organization_id, session_id', 'ai_sessions', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_turn_fk', 'organization_id, turn_id', 'ai_turns', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_patient_fk', 'organization_id, patient_id', 'patients', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_encounter_fk', 'organization_id, encounter_id', 'encounters', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_unit_fk', 'organization_id, unit_id', 'units', 'organization_id, id'),
      ('ai_approvals', 'ai_approvals_organization_workspace_fk', 'organization_id, workspace_id', 'workspaces', 'organization_id, id'),
      ('budget_reservations', 'budget_reservations_organization_session_fk', 'organization_id, session_id', 'ai_sessions', 'organization_id, id')
    ) as links(child_table, constraint_name, child_columns, parent_table, parent_columns)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = link.constraint_name
        and conrelid = link.child_table::regclass
    ) then
      execute format(
        'alter table %I add constraint %I foreign key (%s) references %I (%s)',
        link.child_table, link.constraint_name, link.child_columns, link.parent_table, link.parent_columns
      );
    end if;
  end loop;
end $$;
