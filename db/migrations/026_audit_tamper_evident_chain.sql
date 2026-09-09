-- Additive audit-chain metadata. Existing rows remain verifiable as version 1
-- anchors; new application writes must use the version 2 hash chain.
alter table cvg_audit_ledger add column if not exists previous_hash text;
alter table cvg_audit_ledger add column if not exists record_hash text;
alter table cvg_audit_ledger add column if not exists chain_version integer not null default 1 check (chain_version > 0);
update cvg_audit_ledger set record_hash = coalesce(record_hash, record_digest) where record_hash is null;
with ordered as (
  select sequence_id, lag(record_hash) over (partition by organization_id order by sequence_id) as previous_hash
  from cvg_audit_ledger
)
update cvg_audit_ledger ledger
set previous_hash = ordered.previous_hash
from ordered
where ledger.sequence_id = ordered.sequence_id and ledger.previous_hash is null;
alter table cvg_audit_ledger alter column record_hash set not null;
create index if not exists cvg_audit_ledger_chain_scope on cvg_audit_ledger(organization_id, sequence_id, previous_hash, record_hash);

alter table audit_records add column if not exists chain_version integer not null default 1 check (chain_version > 0);
alter table audit_records add column if not exists previous_hash text;
alter table audit_records add column if not exists record_hash text;
create index if not exists audit_records_chain_scope on audit_records(organization_id, created_at, id, previous_hash, record_hash);
