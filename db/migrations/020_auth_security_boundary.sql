-- Authentication security metadata is additive and keeps secrets outside the
-- domain snapshot. Only approved references/digests are stored here.
alter table users add column if not exists password_changed_at timestamptz;
alter table users add column if not exists password_expires_at timestamptz;
alter table users add column if not exists credential_version integer not null default 1;
alter table users add column if not exists failed_login_attempts integer not null default 0;
alter table users add column if not exists locked_until timestamptz;
alter table users add column if not exists mfa_required boolean not null default false;
alter table users add column if not exists mfa_secret_ref text;
alter table users add column if not exists recovery_code_digests jsonb not null default '[]'::jsonb;
alter table users add column if not exists recovery_codes_issued_at timestamptz;
update users set password_changed_at = coalesce(password_changed_at, created_at);
alter table users alter column password_changed_at set not null;
alter table users add constraint users_credential_version_positive check (credential_version > 0);
alter table users add constraint users_failed_login_attempts_nonnegative check (failed_login_attempts >= 0);
alter table users add constraint users_recovery_code_digests_array check (jsonb_typeof(recovery_code_digests) = 'array');

alter table sessions add column if not exists device_id_digest text;
alter table sessions add column if not exists user_agent_digest text;
alter table sessions add column if not exists ip_digest text;
alter table sessions add column if not exists last_seen_at timestamptz;
alter table sessions add column if not exists mfa_verified_at timestamptz;
alter table sessions add column if not exists credential_version integer not null default 1;
update sessions set last_seen_at = coalesce(last_seen_at, created_at);
alter table sessions alter column last_seen_at set not null;
alter table sessions add constraint sessions_credential_version_positive check (credential_version > 0);

create table if not exists auth_challenges (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  user_id uuid not null,
  type text not null check (type in ('MFA', 'RECOVERY')),
  token_digest text not null unique,
  credential_version integer not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  max_attempts integer not null,
  status text not null check (status in ('PENDING', 'CONSUMED', 'LOCKED', 'EXPIRED')),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references users(organization_id, id),
  check (credential_version > 0),
  check (attempts >= 0),
  check (max_attempts >= 1)
);
create index if not exists auth_challenges_lookup on auth_challenges (organization_id, user_id, type, status, expires_at);

alter table auth_challenges enable row level security;
alter table auth_challenges force row level security;
drop policy if exists cvg_org_isolation on auth_challenges;
create policy cvg_org_isolation on auth_challenges
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());
