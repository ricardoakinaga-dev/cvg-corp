alter table external_effects add column if not exists reconciliation_source text;
alter table external_effects add column if not exists reconciled_at timestamptz;

update external_effects
set status = 'QUARANTINED',
    last_error = 'LEGACY_SUCCESS_WITHOUT_PROVIDER_RECEIPT',
    outcome_digest = encode(digest(jsonb_build_object('status', 'QUARANTINED', 'reason', 'legacy success had no provider receipt')::text, 'sha256'), 'hex'),
    updated_at = now()
where status = 'SUCCEEDED'
  and (provider_request_id is null or response is null);

update outbox_records as outbox
set status = 'QUARANTINED',
    last_error = coalesce(outbox.last_error, 'EXTERNAL_EFFECT_SUCCESS_INVALIDATED_WITHOUT_PROVIDER_RECEIPT'),
    processed_at = coalesce(outbox.processed_at, now())
where outbox.status = 'DELIVERED'
  and exists (
    select 1
    from external_effects as effect
    where effect.organization_id = outbox.organization_id
      and effect.outbox_id = outbox.id
      and effect.status = 'QUARANTINED'
      and effect.last_error = 'LEGACY_SUCCESS_WITHOUT_PROVIDER_RECEIPT'
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_effects_success_receipt_check') then
    alter table external_effects add constraint external_effects_success_receipt_check check (status <> 'SUCCEEDED' or (provider_request_id is not null and response is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_effects_reconciliation_source_check') then
    alter table external_effects add constraint external_effects_reconciliation_source_check check (reconciliation_source is null or reconciliation_source in ('SYNTHETIC_PROVIDER_QUERY', 'PROVIDER_QUERY', 'MANUAL_REVIEW'));
  end if;
end $$;
