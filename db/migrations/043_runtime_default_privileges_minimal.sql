-- CVG-AUD20-003: remove the broad default privileges inherited from 022.
--
-- Migration 022 granted SELECT/INSERT/UPDATE/DELETE on every future table (and
-- usage/select on every future sequence) to cvg_runtime.  Migration 040 revoked
-- the excess on existing tables, but a table created afterwards still inherited
-- the four operations.  The runtime's default is now NONE: any new table or
-- sequence must be granted explicitly by the migration that creates it, which
-- keeps clean installs and upgrades converged on the same least-privilege
-- matrix.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    alter default privileges in schema public revoke select, insert, update, delete on tables from cvg_runtime;
    alter default privileges in schema public revoke usage, select on sequences from cvg_runtime;
  end if;
end $$;
