-- Break-glass grants are durable evidence, not an in-memory authorization
-- cache. Activation remains an application concern and must be preceded by
-- independently verified WebAuthn; this table records only an approved grant.
create table if not exists break_glass_grants (
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  actor_id uuid not null,
  approver_id uuid not null,
  reason text not null check (char_length(trim(reason)) between 10 and 2_000),
  target text not null check (char_length(trim(target)) between 1 and 512),
  mfa_method text not null check (mfa_method = 'WEBAUTHN'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('ACTIVE', 'EXPIRED', 'REVOKED', 'REVIEWED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, actor_id) references users(organization_id, id),
  foreign key (organization_id, approver_id) references users(organization_id, id),
  foreign key (organization_id, reviewed_by) references users(organization_id, id),
  check (approver_id <> actor_id),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '15 minutes'),
  check (reviewed_by is null or reviewed_at is not null),
  check (reviewed_at is null or review_note is not null),
  check (review_note is null or char_length(trim(review_note)) between 10 and 2_000)
);
create index if not exists break_glass_grants_scope_status
  on break_glass_grants (organization_id, status, expires_at, id);
create index if not exists break_glass_grants_scope_actor
  on break_glass_grants (organization_id, actor_id, issued_at desc);

-- The application may only advance the lifecycle. Immutable request evidence
-- cannot be rewritten through a runtime connection, even though the runtime
-- role needs UPDATE for the lazy expiry/revocation/review transitions.
create or replace function cvg_break_glass_transition_guard() returns trigger
language plpgsql
as $$
begin
  if old.id is distinct from new.id
     or old.organization_id is distinct from new.organization_id
     or old.actor_id is distinct from new.actor_id
     or old.approver_id is distinct from new.approver_id
     or old.reason is distinct from new.reason
     or old.target is distinct from new.target
     or old.mfa_method is distinct from new.mfa_method
     or old.issued_at is distinct from new.issued_at
     or old.expires_at is distinct from new.expires_at
     or old.created_at is distinct from new.created_at then
    raise exception 'break-glass grant evidence is immutable' using errcode = '55000';
  end if;

  if old.status = new.status
     and old.reviewed_by is not distinct from new.reviewed_by
     and old.reviewed_at is not distinct from new.reviewed_at
     and old.review_note is not distinct from new.review_note
     and old.revoked_at is not distinct from new.revoked_at then
    return new;
  end if;

  if old.status = 'ACTIVE' and new.status in ('EXPIRED', 'REVOKED') then
    if new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null then
      raise exception 'active break-glass grant cannot be reviewed' using errcode = '55000';
    end if;
    if new.status = 'EXPIRED' and new.revoked_at is not null then
      raise exception 'expired break-glass grant cannot be revoked' using errcode = '55000';
    end if;
    if new.status = 'REVOKED' and new.revoked_at is null then
      raise exception 'revoked break-glass grant requires revoked_at' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status in ('EXPIRED', 'REVOKED') and new.status = 'REVIEWED' then
    if new.reviewed_by is null or new.reviewed_by = new.actor_id or new.reviewed_at is null or new.review_note is null or char_length(trim(new.review_note)) < 10 then
      raise exception 'break-glass review requires an independent reviewer and bounded note' using errcode = '55000';
    end if;
    return new;
  end if;

  raise exception 'invalid break-glass lifecycle transition % -> %', old.status, new.status using errcode = '55000';
end;
$$;

drop trigger if exists break_glass_grants_transition_guard on break_glass_grants;
create trigger break_glass_grants_transition_guard
before update on break_glass_grants
for each row execute function cvg_break_glass_transition_guard();

alter table break_glass_grants enable row level security;
alter table break_glass_grants force row level security;
drop policy if exists cvg_org_isolation on break_glass_grants;
create policy cvg_org_isolation on break_glass_grants
  using (organization_id = cvg_request_organization())
  with check (organization_id = cvg_request_organization());
