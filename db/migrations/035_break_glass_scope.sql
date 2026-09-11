-- Persist the scope separately from the target so a grant cannot be replayed
-- against a different scope after activation.  Existing rows are conservatively
-- organization-scoped; new application callers must provide the explicit scope.
alter table break_glass_grants
  add column if not exists scope text not null default 'ORGANIZATION';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'break_glass_grants_scope_check'
      and conrelid = 'break_glass_grants'::regclass
  ) then
    alter table break_glass_grants
      add constraint break_glass_grants_scope_check
      check (scope in ('ORGANIZATION', 'UNIT', 'WORKSPACE'));
  end if;
end;
$$;

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
     or old.scope is distinct from new.scope
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
