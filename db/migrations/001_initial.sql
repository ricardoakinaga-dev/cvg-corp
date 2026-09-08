create extension if not exists pgcrypto;

create table if not exists cvg_event_journal (
  sequence_id bigint generated always as identity primary key,
  event_id uuid not null unique,
  event_type text not null check (event_type in ('BOOTSTRAP', 'HTTP_REQUEST', 'RESTORE_QUARANTINED', 'SYSTEM')),
  organization_id uuid,
  actor_id uuid,
  correlation_id text not null,
  operation text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  snapshot_digest text not null,
  created_at timestamptz not null default now()
);
create table if not exists cvg_state_snapshots (
  revision bigint primary key check (revision >= 1),
  event_id uuid not null references cvg_event_journal(event_id),
  schema_version integer not null check (schema_version > 0),
  snapshot jsonb not null,
  snapshot_digest text not null,
  source text not null check (source in ('BOOTSTRAP', 'HTTP_REQUEST', 'RESTORE_QUARANTINED', 'SYSTEM')),
  created_at timestamptz not null default now()
);
create index if not exists cvg_event_journal_created_at on cvg_event_journal(created_at, sequence_id);
create table if not exists cvg_audit_ledger (
  sequence_id bigint generated always as identity primary key,
  audit_id uuid not null,
  organization_id uuid not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  record_digest text not null,
  created_at timestamptz not null default now(),
  unique (audit_id, record_digest)
);
create index if not exists cvg_audit_ledger_scope on cvg_audit_ledger(organization_id, sequence_id);
create unique index if not exists cvg_audit_ledger_audit_id on cvg_audit_ledger(audit_id);
create table if not exists cvg_command_receipt_ledger (
  sequence_id bigint generated always as identity primary key,
  receipt_id uuid not null,
  organization_id uuid not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  record_digest text not null,
  created_at timestamptz not null default now(),
  unique (receipt_id, record_digest)
);
create index if not exists cvg_command_receipt_ledger_scope on cvg_command_receipt_ledger(organization_id, sequence_id);
drop index if exists cvg_command_receipt_ledger_receipt_id;

create table if not exists organizations (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  status text not null check (status in ('ACTIVE', 'QUARANTINED')),
  authorization_revision bigint not null default 1 check (authorization_revision > 0),
  created_at timestamptz not null default now()
);
create table if not exists units (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  name text not null,
  code text not null,
  status text not null check (status in ('ACTIVE', 'INACTIVE')),
  unique (organization_id, code),
  unique (organization_id, id)
);
create table if not exists workspaces (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  unit_id uuid not null,
  name text not null,
  purpose text not null,
  status text not null check (status in ('ACTIVE', 'INACTIVE')),
  foreign key (organization_id, unit_id) references units(organization_id, id),
  unique (organization_id, id)
);
create table if not exists users (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  login text not null,
  display_name text not null,
  email text not null,
  status text not null check (status in ('ACTIVE', 'DISABLED')),
  password_digest text not null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, login),
  unique (organization_id, id)
);
create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  provider text not null,
  credential_ref text not null,
  status text not null check (status in ('ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  user_id uuid not null,
  token_digest text not null unique,
  csrf_token text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references users(organization_id, id)
);
create table if not exists role_assignments (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  user_id uuid not null,
  role text not null check (role in ('admin', 'veterinario', 'recepcao', 'operador', 'financeiro', 'estoque', 'workspace_manager')),
  scope_type text not null check (scope_type in ('ORGANIZATION', 'UNIT', 'WORKSPACE')),
  unit_id uuid,
  workspace_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (organization_id, user_id) references users(organization_id, id),
  foreign key (organization_id, unit_id) references units(organization_id, id),
  foreign key (organization_id, workspace_id) references workspaces(organization_id, id),
  check ((scope_type = 'ORGANIZATION' and unit_id is null and workspace_id is null) or (scope_type = 'UNIT' and unit_id is not null and workspace_id is null) or (scope_type = 'WORKSPACE' and unit_id is not null and workspace_id is not null))
);
create unique index if not exists role_assignments_active_unique on role_assignments (organization_id, user_id, role, scope_type, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create table if not exists authorization_state (
  organization_id uuid primary key references organizations(id),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);
create table if not exists audit_records (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  actor_id uuid,
  unit_id uuid,
  workspace_id uuid,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  result text not null check (result in ('ALLOWED', 'DENIED', 'ERROR', 'UNKNOWN')),
  reason text,
  correlation_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table audit_records add column if not exists unit_id uuid;
alter table audit_records add column if not exists workspace_id uuid;
create table if not exists command_receipts (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  actor_id uuid not null,
  unit_id uuid,
  workspace_id uuid,
  audit_record_id uuid references audit_records(id),
  operation text not null,
  idempotency_lookup text not null unique,
  body_digest text not null,
  status text not null check (status in ('IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table command_receipts add column if not exists audit_record_id uuid references audit_records(id);
alter table command_receipts add column if not exists unit_id uuid;
alter table command_receipts add column if not exists workspace_id uuid;

create table if not exists guardians (
  id uuid primary key, organization_id uuid not null references organizations(id), display_name text not null, phone text not null, email text, status text not null check (status in ('ACTIVE', 'INACTIVE')), created_at timestamptz not null default now()
);
create table if not exists patients (
  id uuid primary key, organization_id uuid not null references organizations(id), guardian_id uuid not null references guardians(id), name text not null, species text not null, breed text, sex text not null, reproductive_status text not null, birth_date date, identifiers jsonb not null default '[]', data_class text not null default 'D3' check (data_class = 'D3'), status text not null check (status in ('ACTIVE', 'INACTIVE', 'MERGED')), merged_into_id uuid references patients(id), status_changed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists service_catalog_items (
  id uuid primary key, organization_id uuid not null references organizations(id), name text not null, duration_minutes integer not null, price_cents integer not null, status text not null
);
create table if not exists providers (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null, display_name text not null, specialty text not null, role text not null, status text not null, foreign key (organization_id, unit_id) references units(organization_id, id)
);
create table if not exists resources (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null, name text not null, kind text not null, status text not null, foreign key (organization_id, unit_id) references units(organization_id, id)
);
create table if not exists appointments (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null, workspace_id uuid not null, patient_id uuid not null references patients(id), provider_id uuid not null references providers(id), resource_id uuid references resources(id), service_id uuid not null references service_catalog_items(id), starts_at timestamptz not null, ends_at timestamptz not null, purpose text not null, status text not null, version integer not null default 1, created_at timestamptz not null default now(), check (ends_at > starts_at), foreign key (organization_id, unit_id) references units(organization_id, id), foreign key (organization_id, workspace_id) references workspaces(organization_id, id)
);
create index if not exists appointments_provider_window on appointments (organization_id, provider_id, starts_at, ends_at) where status <> 'CANCELLED';
create table if not exists queue_entries (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null references units(id), appointment_id uuid references appointments(id), patient_id uuid not null references patients(id), status text not null, priority text not null, checked_in_at timestamptz not null default now()
);
create table if not exists encounters (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null references units(id), workspace_id uuid not null references workspaces(id), patient_id uuid not null references patients(id), appointment_id uuid references appointments(id), chief_complaint text not null, urgency text not null, status text not null, opened_at timestamptz not null default now(), closed_at timestamptz
);
create table if not exists clinical_documents (
  id uuid primary key, organization_id uuid not null references organizations(id), encounter_id uuid not null references encounters(id), patient_id uuid not null references patients(id), author_id uuid not null references users(id), document_type text not null, title text not null, content text not null, data_class text not null, status text not null, version integer not null default 1, signed_at timestamptz, signed_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists clinical_addenda (
  id uuid primary key, document_id uuid not null references clinical_documents(id), author_id uuid not null references users(id), reason text not null, content text not null, created_at timestamptz not null default now()
);

create table if not exists diagnostic_requests (
  id uuid primary key, organization_id uuid not null references organizations(id), patient_id uuid not null references patients(id), encounter_id uuid references encounters(id), test_name text not null, priority text not null, status text not null, requested_by uuid not null references users(id), created_at timestamptz not null default now()
);
create table if not exists specimens (
  id uuid primary key, organization_id uuid not null references organizations(id), request_id uuid not null references diagnostic_requests(id), patient_id uuid not null references patients(id), label text not null, collected_at timestamptz not null, status text not null
);
create table if not exists diagnostic_results (
  id uuid primary key, organization_id uuid not null references organizations(id), request_id uuid not null references diagnostic_requests(id), specimen_id uuid not null references specimens(id), patient_id uuid not null references patients(id), value text not null, source text not null, source_version text not null, status text not null, created_at timestamptz not null default now()
);
create table if not exists beds (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null references units(id), name text not null, status text not null
);
create table if not exists hospital_episodes (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null references units(id), patient_id uuid not null references patients(id), encounter_id uuid references encounters(id), bed_id uuid references beds(id), status text not null, admitted_at timestamptz, discharged_at timestamptz
);
create table if not exists medication_orders (
  id uuid primary key, organization_id uuid not null references organizations(id), patient_id uuid not null references patients(id), encounter_id uuid references encounters(id), product_id uuid, dose text not null, route text not null, frequency text not null, status text not null, prescribed_by uuid not null references users(id)
);
create table if not exists dispensations (
  id uuid primary key, organization_id uuid not null references organizations(id), medication_order_id uuid not null references medication_orders(id), lot_id uuid not null, quantity integer not null check (quantity > 0), dispensed_by uuid not null references users(id), created_at timestamptz not null default now()
);
create table if not exists administration_occurrences (
  id uuid primary key, organization_id uuid not null references organizations(id), medication_order_id uuid not null references medication_orders(id), administered_by uuid not null references users(id), administered_at timestamptz not null default now(), status text not null check (status in ('ADMINISTERED', 'OMITTED', 'REFUSED')), note text
);

create table if not exists products (
  id uuid primary key, organization_id uuid not null references organizations(id), sku text not null, name text not null, category text not null, unit text not null, reorder_point integer not null check (reorder_point >= 0), status text not null, unique (organization_id, sku)
);
create table if not exists stock_locations (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid not null references units(id), name text not null
);
create table if not exists lots (
  id uuid primary key, organization_id uuid not null references organizations(id), product_id uuid not null references products(id), lot_number text not null, expires_on date not null, quantity integer not null check (quantity >= 0), location_id uuid not null references stock_locations(id), status text not null
);
create table if not exists stock_movements (
  id uuid primary key, organization_id uuid not null references organizations(id), product_id uuid not null references products(id), lot_id uuid not null references lots(id), location_id uuid not null references stock_locations(id), quantity integer not null check (quantity > 0), movement_type text not null, reason text not null, reference_id uuid, created_by uuid not null references users(id), created_at timestamptz not null default now()
);
create table if not exists charges (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid references units(id), patient_id uuid references patients(id), description text not null, amount_cents integer not null check (amount_cents > 0), currency char(3) not null, status text not null, created_at timestamptz not null default now()
);
create table if not exists payments (
  id uuid primary key, organization_id uuid not null references organizations(id), charge_id uuid not null references charges(id), amount_cents integer not null check (amount_cents > 0), method text not null, external_reference text, status text not null, created_at timestamptz not null default now()
);
create table if not exists ledger_entries (
  id uuid primary key, organization_id uuid not null references organizations(id), kind text not null, reference_id uuid not null, amount_cents integer not null, currency char(3) not null, description text not null, created_at timestamptz not null default now()
);

create table if not exists knowledge_documents (
  id uuid primary key, organization_id uuid not null references organizations(id), unit_id uuid, workspace_id uuid, title text not null, source text not null, data_class text not null, version integer not null, status text not null, content text not null, created_at timestamptz not null default now(), foreign key (organization_id, unit_id) references units(organization_id, id), foreign key (organization_id, workspace_id) references workspaces(organization_id, id)
);
alter table knowledge_documents add column if not exists unit_id uuid;
alter table knowledge_documents add column if not exists workspace_id uuid;
create table if not exists ai_sessions (
  id uuid primary key, organization_id uuid not null references organizations(id), actor_id uuid not null references users(id), unit_id uuid, workspace_id uuid, patient_id uuid references patients(id), encounter_id uuid references encounters(id), purpose text not null, engine_commit text not null, profile_digest text not null, status text not null, created_at timestamptz not null default now(), foreign key (organization_id, unit_id) references units(organization_id, id), foreign key (organization_id, workspace_id) references workspaces(organization_id, id)
);
alter table ai_sessions add column if not exists unit_id uuid;
alter table ai_sessions add column if not exists workspace_id uuid;
create index if not exists knowledge_documents_scope on knowledge_documents(organization_id, unit_id, workspace_id, id);
create index if not exists ai_sessions_scope on ai_sessions(organization_id, actor_id, unit_id, workspace_id, id);
create table if not exists ai_turns (
  id uuid primary key, session_id uuid not null references ai_sessions(id), prompt text not null, response text, status text not null, model text not null, input_tokens integer not null, output_tokens integer not null, references_json jsonb not null default '[]', created_at timestamptz not null default now()
);
create table if not exists ai_drafts (
  id uuid primary key, session_id uuid not null references ai_sessions(id), encounter_id uuid references encounters(id), draft_type text not null, content text not null, source_turn_id uuid not null references ai_turns(id), status text not null, created_at timestamptz not null default now()
);
create table if not exists ai_approvals (
  id uuid primary key, organization_id uuid not null references organizations(id), actor_id uuid not null references users(id), session_id uuid not null references ai_sessions(id), turn_id uuid not null references ai_turns(id), tool_name text not null, resource_id uuid, patient_id uuid references patients(id), encounter_id uuid references encounters(id), unit_id uuid references units(id), workspace_id uuid references workspaces(id), purpose text not null, request_digest text not null, policy_revision text not null, expires_at timestamptz not null, decision text not null check (decision in ('allowed-once', 'rejected', 'unavailable', 'consumed')), decided_by uuid references users(id), reason text, created_at timestamptz not null default now()
);
create table if not exists budget_reservations (
  id uuid primary key, organization_id uuid not null references organizations(id), session_id uuid not null references ai_sessions(id), category text not null, reserved_units integer not null, consumed_units integer not null default 0, status text not null, created_at timestamptz not null default now()
);
create table if not exists integration_contracts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id), integration_id text not null, contract jsonb not null, status text not null, created_at timestamptz not null default now()
);
create table if not exists outbox_records (
  id uuid primary key, organization_id uuid not null references organizations(id), event_type text not null, aggregate_id uuid not null, payload jsonb not null, status text not null, attempts integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists inbox_records (
  consumer text not null, event_id uuid not null, received_at timestamptz not null default now(), primary key (consumer, event_id)
);
create table if not exists lifecycle_decisions (
  id uuid primary key, operation_id uuid not null, decision_digest text not null, decision_record_digest text not null, status text not null, payload jsonb not null, created_at timestamptz not null default now(), unique (operation_id, decision_digest)
);
create table if not exists lifecycle_transition_events (
  id uuid primary key, decision_id uuid not null references lifecycle_decisions(id), event_sequence bigint not null, phase text not null, event_digest text not null, created_at timestamptz not null default now(), unique (decision_id, event_sequence), unique (id, event_digest)
);
