-- Runtime scope guards are additive. Applied migrations are immutable; this
-- migration makes the AI projection indexes and D2/D3 row policies explicit.

create index if not exists ai_turns_scope on ai_turns (organization_id, unit_id, workspace_id, session_id, id);
create index if not exists ai_drafts_scope on ai_drafts (organization_id, unit_id, workspace_id, session_id, id);

drop policy if exists cvg_scope_read on ai_turns;
create policy cvg_scope_read on ai_turns for select using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_insert on ai_turns;
create policy cvg_scope_insert on ai_turns for insert with check (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_update on ai_turns;
create policy cvg_scope_update on ai_turns for update using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
) with check (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_delete on ai_turns;
create policy cvg_scope_delete on ai_turns for delete using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);

drop policy if exists cvg_scope_read on ai_drafts;
create policy cvg_scope_read on ai_drafts for select using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_insert on ai_drafts;
create policy cvg_scope_insert on ai_drafts for insert with check (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_update on ai_drafts;
create policy cvg_scope_update on ai_drafts for update using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
) with check (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
drop policy if exists cvg_scope_delete on ai_drafts;
create policy cvg_scope_delete on ai_drafts for delete using (
  organization_id = cvg_request_organization()
  and cvg_request_unit() is not null
  and unit_id = cvg_request_unit()
  and (cvg_request_workspace() is null or workspace_id = cvg_request_workspace())
);
