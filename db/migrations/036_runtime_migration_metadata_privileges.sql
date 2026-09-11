-- Migration metadata is owned by the migration connection. The application
-- and worker runtime may inspect it for readiness, but must not forge or
-- delete migration history.
revoke insert, update, delete on table public.schema_migrations from cvg_runtime;
grant select on table public.schema_migrations to cvg_runtime;
