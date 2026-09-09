-- Ambiguous provider outcomes are reconciled explicitly; no blind resend is
-- permitted. RECONCILING is an auditable in-progress marker and FAILED_FINAL
-- is a terminal provider-confirmed failure.
alter table external_effects drop constraint if exists external_effects_status_check;
alter table external_effects add constraint external_effects_status_check check (status in (
  'ADMISSION_PENDING', 'DISPATCHED', 'FAILED_RETRYABLE', 'SUCCEEDED',
  'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED', 'RECONCILING', 'FAILED_FINAL',
  'QUARANTINED'
));
create index if not exists external_effects_reconciling on external_effects (organization_id, status, updated_at, id);
