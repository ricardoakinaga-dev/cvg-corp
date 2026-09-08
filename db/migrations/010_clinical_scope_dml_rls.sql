drop policy if exists cvg_clinical_insert on clinical_documents;
drop policy if exists cvg_clinical_update on clinical_documents;
drop policy if exists cvg_clinical_delete on clinical_documents;
create policy cvg_clinical_insert on clinical_documents
  for insert with check (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_update on clinical_documents
  for update using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id)) with check (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_delete on clinical_documents
  for delete using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));

drop policy if exists cvg_clinical_addenda_insert on clinical_addenda;
drop policy if exists cvg_clinical_addenda_update on clinical_addenda;
drop policy if exists cvg_clinical_addenda_delete on clinical_addenda;
create policy cvg_clinical_addenda_insert on clinical_addenda
  for insert with check (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_addenda_update on clinical_addenda
  for update using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id)) with check (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_addenda_delete on clinical_addenda
  for delete using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
