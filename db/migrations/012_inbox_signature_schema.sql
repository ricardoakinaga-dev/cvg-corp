alter table integration_inbox_records add column if not exists schema_version integer;
alter table integration_inbox_records add column if not exists signature_algorithm text;
alter table integration_inbox_records add column if not exists signature_key_ref text;
alter table integration_inbox_records add column if not exists signature text;

update integration_inbox_records
set schema_version = coalesce(schema_version, 1),
    signature_algorithm = coalesce(signature_algorithm, 'UNVERIFIED'),
    signature_key_ref = coalesce(signature_key_ref, 'legacy-unverified'),
    signature = coalesce(signature, 'LEGACY_UNVERIFIED'),
    status = 'QUARANTINED',
    last_error = coalesce(last_error, 'LEGACY_INBOX_EVENT_WITHOUT_SIGNATURE')
where schema_version is null
   or signature_algorithm is null
   or signature_key_ref is null
   or signature is null;

alter table integration_inbox_records alter column schema_version set not null;
alter table integration_inbox_records alter column signature_algorithm set not null;
alter table integration_inbox_records alter column signature_key_ref set not null;
alter table integration_inbox_records alter column signature set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'integration_inbox_records_schema_version_check') then
    alter table integration_inbox_records add constraint integration_inbox_records_schema_version_check check (schema_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integration_inbox_records_signature_algorithm_check') then
    alter table integration_inbox_records add constraint integration_inbox_records_signature_algorithm_check check (signature_algorithm in ('HMAC-SHA256', 'UNVERIFIED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'integration_inbox_records_signature_length_check') then
    alter table integration_inbox_records add constraint integration_inbox_records_signature_length_check check (length(signature) between 1 and 512);
  end if;
end $$;

create index if not exists integration_inbox_records_signature_status on integration_inbox_records (organization_id, status, received_at);
