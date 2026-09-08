alter table clinical_documents add column if not exists unit_id uuid;
alter table clinical_documents add column if not exists workspace_id uuid;

update clinical_documents as document
set unit_id = encounter.unit_id,
    workspace_id = encounter.workspace_id
from encounters as encounter
where encounter.id = document.encounter_id
  and encounter.organization_id = document.organization_id
  and (document.unit_id is null or document.workspace_id is null);

do $$
begin
  if exists (select 1 from clinical_documents where unit_id is null or workspace_id is null) then
    raise exception 'clinical_documents contains rows without a resolvable encounter scope';
  end if;
end $$;

alter table clinical_documents alter column unit_id set not null;
alter table clinical_documents alter column workspace_id set not null;
create unique index if not exists clinical_documents_organization_id_id_uq on clinical_documents (organization_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinical_documents_organization_unit_fk') then
    alter table clinical_documents add constraint clinical_documents_organization_unit_fk foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinical_documents_organization_workspace_fk') then
    alter table clinical_documents add constraint clinical_documents_organization_workspace_fk foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
end $$;

alter table clinical_addenda add column if not exists organization_id uuid;
alter table clinical_addenda add column if not exists unit_id uuid;
alter table clinical_addenda add column if not exists workspace_id uuid;

update clinical_addenda as addendum
set organization_id = document.organization_id,
    unit_id = document.unit_id,
    workspace_id = document.workspace_id
from clinical_documents as document
where document.id = addendum.document_id
  and (addendum.organization_id is null or addendum.unit_id is null or addendum.workspace_id is null);

do $$
begin
  if exists (select 1 from clinical_addenda where organization_id is null or unit_id is null or workspace_id is null) then
    raise exception 'clinical_addenda contains rows without a resolvable document scope';
  end if;
end $$;

alter table clinical_addenda alter column organization_id set not null;
alter table clinical_addenda alter column unit_id set not null;
alter table clinical_addenda alter column workspace_id set not null;
create unique index if not exists clinical_addenda_organization_id_id_uq on clinical_addenda (organization_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clinical_addenda_organization_fk') then
    alter table clinical_addenda add constraint clinical_addenda_organization_fk foreign key (organization_id) references organizations(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinical_addenda_organization_unit_fk') then
    alter table clinical_addenda add constraint clinical_addenda_organization_unit_fk foreign key (organization_id, unit_id) references units(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinical_addenda_organization_workspace_fk') then
    alter table clinical_addenda add constraint clinical_addenda_organization_workspace_fk foreign key (organization_id, workspace_id) references workspaces(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinical_addenda_organization_document_fk') then
    alter table clinical_addenda add constraint clinical_addenda_organization_document_fk foreign key (organization_id, document_id) references clinical_documents(organization_id, id);
  end if;
end $$;

create or replace function cvg_request_exact_scope_allows(target_unit uuid, target_workspace uuid) returns boolean
language sql stable
as $$
  select target_unit is not null
    and target_workspace is not null
    and cvg_request_unit() is not null
    and cvg_request_workspace() is not null
    and target_unit = cvg_request_unit()
    and target_workspace = cvg_request_workspace()
$$;

alter table clinical_documents enable row level security;
alter table clinical_documents force row level security;
drop policy if exists cvg_org_isolation on clinical_documents;
drop policy if exists cvg_clinical_read on clinical_documents;
drop policy if exists cvg_clinical_insert on clinical_documents;
drop policy if exists cvg_clinical_update on clinical_documents;
drop policy if exists cvg_clinical_delete on clinical_documents;
create policy cvg_clinical_read on clinical_documents
  for select using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_insert on clinical_documents
  for insert with check (organization_id = cvg_request_organization());
create policy cvg_clinical_update on clinical_documents
  for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization());
create policy cvg_clinical_delete on clinical_documents
  for delete using (organization_id = cvg_request_organization());

alter table clinical_addenda enable row level security;
alter table clinical_addenda force row level security;
drop policy if exists cvg_clinical_addenda_read on clinical_addenda;
drop policy if exists cvg_clinical_addenda_insert on clinical_addenda;
drop policy if exists cvg_clinical_addenda_update on clinical_addenda;
drop policy if exists cvg_clinical_addenda_delete on clinical_addenda;
create policy cvg_clinical_addenda_read on clinical_addenda
  for select using (organization_id = cvg_request_organization() and cvg_request_exact_scope_allows(unit_id, workspace_id));
create policy cvg_clinical_addenda_insert on clinical_addenda
  for insert with check (organization_id = cvg_request_organization());
create policy cvg_clinical_addenda_update on clinical_addenda
  for update using (organization_id = cvg_request_organization()) with check (organization_id = cvg_request_organization());
create policy cvg_clinical_addenda_delete on clinical_addenda
  for delete using (organization_id = cvg_request_organization());

create index if not exists clinical_documents_scope_rls on clinical_documents (organization_id, unit_id, workspace_id, id);
create index if not exists clinical_addenda_scope_rls on clinical_addenda (organization_id, unit_id, workspace_id, id);
