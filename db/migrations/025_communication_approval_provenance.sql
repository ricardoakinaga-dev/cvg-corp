alter table communication_messages add column if not exists created_by uuid;
alter table communication_messages add column if not exists decided_by uuid;
alter table communication_messages add column if not exists decided_at timestamptz;
alter table communication_messages add column if not exists approved_by uuid;
alter table communication_messages add column if not exists approved_at timestamptz;
alter table communication_messages add column if not exists decision_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communication_messages_organization_created_by_fk') then
    alter table communication_messages add constraint communication_messages_organization_created_by_fk foreign key (organization_id, created_by) references users(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'communication_messages_organization_decided_by_fk') then
    alter table communication_messages add constraint communication_messages_organization_decided_by_fk foreign key (organization_id, decided_by) references users(organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'communication_messages_organization_approved_by_fk') then
    alter table communication_messages add constraint communication_messages_organization_approved_by_fk foreign key (organization_id, approved_by) references users(organization_id, id);
  end if;
end $$;
create index if not exists communication_messages_approval on communication_messages (organization_id, status, decided_at, id);
