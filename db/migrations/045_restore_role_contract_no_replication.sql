-- CVG-AUD26-002: close the restore/runtime role contract.
--
-- Migration 044 established the dedicated restore role but omitted
-- NOREPLICATION. This forward-only correction makes the restriction explicit
-- on clean installs and upgrades. Runtime role provisioning also applies the
-- same restriction when the role is created after migrations.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cvg_restore_authority') then
    raise exception 'cvg_restore_authority must be created by the preceding migration' using errcode = '55000';
  end if;
end $$;

alter role cvg_restore_authority
  noinherit
  nologin
  nosuperuser
  nobypassrls
  nocreatedb
  nocreaterole
  noreplication;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    execute 'alter role cvg_runtime noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication';
  end if;
end $$;
