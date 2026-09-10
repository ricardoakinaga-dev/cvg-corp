-- Audit, journal and receipt ledgers are append-only at the database boundary.
-- The migration role remains the owner; the runtime role may only read/insert.
create or replace function cvg_append_only_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cvg_event_journal', 'cvg_state_snapshots', 'cvg_audit_ledger',
    'cvg_command_receipt_ledger', 'audit_records'
  ] loop
    execute format('drop trigger if exists %I on %I', table_name || '_append_only', table_name);
    execute format(
      'create trigger %I before update or delete on %I for each row execute function cvg_append_only_guard()',
      table_name || '_append_only', table_name
    );
  end loop;
end $$;

revoke update, delete on cvg_event_journal, cvg_state_snapshots, cvg_audit_ledger,
  cvg_command_receipt_ledger, audit_records from cvg_runtime;
grant select, insert on cvg_event_journal, cvg_state_snapshots, cvg_audit_ledger,
  cvg_command_receipt_ledger, audit_records to cvg_runtime;
