-- Forward-fix for 027: SELECT ... FOR UPDATE is used only to serialize
-- persistence writers. UPDATE remains guarded by cvg_append_only_guard(); this
-- grants the lock privilege without permitting an actual row mutation.
grant update on cvg_state_snapshots, cvg_audit_ledger to cvg_runtime;
