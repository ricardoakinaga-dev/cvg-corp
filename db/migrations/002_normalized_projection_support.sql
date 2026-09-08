create table if not exists communication_messages (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  unit_id uuid,
  workspace_id uuid,
  patient_id uuid references patients(id),
  channel text not null,
  recipient text not null,
  template text not null,
  body text not null,
  status text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, unit_id) references units(organization_id, id),
  foreign key (organization_id, workspace_id) references workspaces(organization_id, id)
);
create index if not exists communication_messages_scope on communication_messages(organization_id, unit_id, workspace_id, id);
alter table guardians add column if not exists data_class text not null default 'D2';
