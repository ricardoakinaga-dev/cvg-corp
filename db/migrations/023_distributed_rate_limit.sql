-- Atomic shared rate-limit buckets. This table contains only bounded keys and
-- counters; it is operational state, not tenant domain data.
create table if not exists cvg_rate_limit_buckets (
  bucket_key text primary key check (length(bucket_key) between 1 and 512),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on cvg_rate_limit_buckets from public;
grant select, insert, update, delete on cvg_rate_limit_buckets to cvg_runtime;
alter table cvg_rate_limit_buckets enable row level security;
alter table cvg_rate_limit_buckets force row level security;
drop policy if exists cvg_rate_limit_runtime on cvg_rate_limit_buckets;
create policy cvg_rate_limit_runtime on cvg_rate_limit_buckets using (true) with check (true);
create index if not exists cvg_rate_limit_buckets_updated_at on cvg_rate_limit_buckets(updated_at);
