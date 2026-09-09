-- Revisions are monotonic per organization, not globally across tenants.
-- This migration is forward-only: the old global primary key is replaced by
-- the composite key required by the scoped persistence queries.

do $$
declare
  primary_key_name text;
begin
  select constraint_name
    into primary_key_name
    from information_schema.table_constraints
   where table_schema = 'public'
     and table_name = 'cvg_state_snapshots'
     and constraint_type = 'PRIMARY KEY';

  if primary_key_name is not null
     and not exists (
       select 1
         from pg_constraint constraint_row
         join pg_class table_row on table_row.oid = constraint_row.conrelid
         join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
        where namespace_row.nspname = 'public'
          and table_row.relname = 'cvg_state_snapshots'
          and constraint_row.contype = 'p'
          and pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (organization_id, revision)'
     ) then
    execute format('alter table public.cvg_state_snapshots drop constraint %I', primary_key_name);
  end if;

  if not exists (
    select 1
      from pg_constraint constraint_row
      join pg_class table_row on table_row.oid = constraint_row.conrelid
      join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
     where namespace_row.nspname = 'public'
       and table_row.relname = 'cvg_state_snapshots'
       and constraint_row.contype = 'p'
       and pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (organization_id, revision)'
  ) then
    alter table public.cvg_state_snapshots add constraint cvg_state_snapshots_scope_pkey primary key (organization_id, revision);
  end if;
end $$;

create index if not exists cvg_state_snapshots_scope_created_at
  on cvg_state_snapshots (organization_id, created_at desc, revision desc);
