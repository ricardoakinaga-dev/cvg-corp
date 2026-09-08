alter table cvg_state_snapshots add column if not exists organization_id uuid;
update cvg_state_snapshots
set organization_id = nullif(snapshot #>> '{organizations,0,id}', '')::uuid
where organization_id is null;

do $$
begin
  if exists (select 1 from cvg_state_snapshots where organization_id is null) then
    raise exception 'cvg_state_snapshots contains rows without a resolvable organization scope';
  end if;
end $$;

alter table cvg_state_snapshots alter column organization_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cvg_state_snapshots_organization_fk') then
    alter table cvg_state_snapshots add constraint cvg_state_snapshots_organization_fk foreign key (organization_id) references organizations(id);
  end if;
end $$;

update cvg_event_journal as journal
set organization_id = snapshot.organization_id
from cvg_state_snapshots as snapshot
where snapshot.event_id = journal.event_id
  and journal.organization_id is null;

do $$
begin
  if exists (select 1 from cvg_event_journal where organization_id is null) then
    raise exception 'cvg_event_journal contains rows without a resolvable organization scope';
  end if;
end $$;

alter table cvg_event_journal alter column organization_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cvg_event_journal_organization_fk') then
    alter table cvg_event_journal add constraint cvg_event_journal_organization_fk foreign key (organization_id) references organizations(id);
  end if;
end $$;

create index if not exists cvg_state_snapshots_scope_revision on cvg_state_snapshots (organization_id, revision desc);
create index if not exists cvg_event_journal_scope_sequence on cvg_event_journal (organization_id, sequence_id);

alter table cvg_state_snapshots enable row level security;
alter table cvg_state_snapshots force row level security;
drop policy if exists cvg_org_isolation on cvg_state_snapshots;
create policy cvg_org_isolation on cvg_state_snapshots
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());

alter table cvg_event_journal enable row level security;
alter table cvg_event_journal force row level security;
drop policy if exists cvg_org_isolation on cvg_event_journal;
create policy cvg_org_isolation on cvg_event_journal
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());
