-- Runtime connections must never inherit PostgreSQL superuser or BYPASSRLS
-- privileges. The migration connection owns this setup; the application and
-- worker connect with a separately provisioned LOGIN role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cvg_runtime') then
    create role cvg_runtime noinherit nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

alter role cvg_runtime noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
revoke create on schema public from public;
grant usage on schema public to cvg_runtime;
grant select, insert, update, delete on all tables in schema public to cvg_runtime;
grant usage, select on all sequences in schema public to cvg_runtime;
alter default privileges in schema public grant select, insert, update, delete on tables to cvg_runtime;
alter default privileges in schema public grant usage, select on sequences to cvg_runtime;

comment on role cvg_runtime is 'CVG application/worker runtime role: NOSUPERUSER, NOBYPASSRLS, NOINHERIT';
