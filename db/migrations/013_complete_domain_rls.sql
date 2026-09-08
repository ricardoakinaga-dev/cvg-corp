-- Close the remaining tenant-isolation gaps in legacy/dependent tables.
-- Rows whose organization cannot be derived are intentionally rejected instead
-- of being silently assigned to an arbitrary tenant.

create unique index if not exists ai_sessions_organization_id_id_uq
  on ai_sessions (organization_id, id);
create unique index if not exists encounters_organization_id_id_uq
  on encounters (organization_id, id);

alter table ai_turns add column if not exists organization_id uuid;
alter table ai_turns add column if not exists unit_id uuid;
alter table ai_turns add column if not exists workspace_id uuid;
update ai_turns as turn
set organization_id = session.organization_id,
    unit_id = session.unit_id,
    workspace_id = session.workspace_id
from ai_sessions as session
where session.id = turn.session_id
  and (turn.organization_id is null or turn.unit_id is null or turn.workspace_id is null);

do $$
begin
  if exists (select 1 from ai_turns where organization_id is null or unit_id is null or workspace_id is null) then
    raise exception 'ai_turns contains rows without a resolvable session scope';
  end if;
end $$;

alter table ai_turns alter column organization_id set not null;
alter table ai_turns alter column unit_id set not null;
alter table ai_turns alter column workspace_id set not null;
alter table ai_turns add constraint ai_turns_organization_fk
  foreign key (organization_id) references organizations(id);
alter table ai_turns add constraint ai_turns_organization_session_fk
  foreign key (organization_id, session_id) references ai_sessions(organization_id, id);
alter table ai_turns add constraint ai_turns_organization_unit_fk
  foreign key (organization_id, unit_id) references units(organization_id, id);
alter table ai_turns add constraint ai_turns_organization_workspace_fk
  foreign key (organization_id, workspace_id) references workspaces(organization_id, id);

alter table ai_drafts add column if not exists organization_id uuid;
alter table ai_drafts add column if not exists unit_id uuid;
alter table ai_drafts add column if not exists workspace_id uuid;
update ai_drafts as draft
set organization_id = session.organization_id,
    unit_id = session.unit_id,
    workspace_id = session.workspace_id
from ai_sessions as session
where session.id = draft.session_id
  and (draft.organization_id is null or draft.unit_id is null or draft.workspace_id is null);

do $$
begin
  if exists (select 1 from ai_drafts where organization_id is null or unit_id is null or workspace_id is null) then
    raise exception 'ai_drafts contains rows without a resolvable session scope';
  end if;
end $$;

alter table ai_drafts alter column organization_id set not null;
alter table ai_drafts alter column unit_id set not null;
alter table ai_drafts alter column workspace_id set not null;
alter table ai_drafts add constraint ai_drafts_organization_fk
  foreign key (organization_id) references organizations(id);
alter table ai_drafts add constraint ai_drafts_organization_session_fk
  foreign key (organization_id, session_id) references ai_sessions(organization_id, id);
alter table ai_drafts add constraint ai_drafts_organization_encounter_fk
  foreign key (organization_id, encounter_id) references encounters(organization_id, id);
alter table ai_drafts add constraint ai_drafts_organization_unit_fk
  foreign key (organization_id, unit_id) references units(organization_id, id);
alter table ai_drafts add constraint ai_drafts_organization_workspace_fk
  foreign key (organization_id, workspace_id) references workspaces(organization_id, id);

alter table lifecycle_decisions add column if not exists organization_id uuid;
do $$
begin
  if exists (select 1 from lifecycle_decisions where organization_id is null) then
    raise exception 'lifecycle_decisions contains legacy rows without organization scope';
  end if;
end $$;
alter table lifecycle_decisions alter column organization_id set not null;
alter table lifecycle_decisions add constraint lifecycle_decisions_organization_fk
  foreign key (organization_id) references organizations(id);
create unique index if not exists lifecycle_decisions_organization_id_id_uq
  on lifecycle_decisions (organization_id, id);
create index if not exists lifecycle_decisions_scope
  on lifecycle_decisions (organization_id, created_at, id);

alter table lifecycle_transition_events add column if not exists organization_id uuid;
update lifecycle_transition_events as event
set organization_id = decision.organization_id
from lifecycle_decisions as decision
where decision.id = event.decision_id
  and event.organization_id is null;
do $$
begin
  if exists (select 1 from lifecycle_transition_events where organization_id is null) then
    raise exception 'lifecycle_transition_events contains rows without a resolvable decision scope';
  end if;
end $$;
alter table lifecycle_transition_events alter column organization_id set not null;
alter table lifecycle_transition_events add constraint lifecycle_transition_events_organization_fk
  foreign key (organization_id) references organizations(id);
alter table lifecycle_transition_events add constraint lifecycle_transition_events_organization_decision_fk
  foreign key (organization_id, decision_id) references lifecycle_decisions(organization_id, id);
create index if not exists lifecycle_transition_events_scope
  on lifecycle_transition_events (organization_id, decision_id, event_sequence);

alter table inbox_records add column if not exists organization_id uuid;
do $$
begin
  if exists (select 1 from inbox_records where organization_id is null) then
    raise exception 'inbox_records contains legacy rows without organization scope';
  end if;
end $$;
alter table inbox_records alter column organization_id set not null;
alter table inbox_records add constraint inbox_records_organization_fk
  foreign key (organization_id) references organizations(id);
create index if not exists inbox_records_scope
  on inbox_records (organization_id, consumer, event_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['ai_turns', 'ai_drafts', 'lifecycle_decisions', 'lifecycle_transition_events', 'inbox_records'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('drop policy if exists cvg_org_isolation on %I', table_name);
    execute format('drop policy if exists cvg_scope_read on %I', table_name);
    execute format('drop policy if exists cvg_scope_insert on %I', table_name);
    execute format('drop policy if exists cvg_scope_update on %I', table_name);
    execute format('drop policy if exists cvg_scope_delete on %I', table_name);
  end loop;

  foreach table_name in array array['lifecycle_decisions', 'lifecycle_transition_events', 'inbox_records'] loop
    execute format(
      'create policy cvg_org_isolation on %I using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization())',
      table_name
    );
  end loop;

  foreach table_name in array array['ai_turns', 'ai_drafts'] loop
    execute format(
      'create policy cvg_scope_read on %I for select using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_insert on %I for insert with check (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_update on %I for update using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id)) with check (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id))',
      table_name
    );
    execute format(
      'create policy cvg_scope_delete on %I for delete using (organization_id = cvg_request_organization() and cvg_request_scope_allows(unit_id, workspace_id))',
      table_name
    );
  end loop;
end $$;
