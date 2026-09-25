#!/bin/sh
set -eu

# The local Compose files historically pass TypeScript commands to this image.
# Translate those commands to the compiled artifacts so the final image does
# not need tsx, npm, or repository source files. New deployments should use
# the short api/worker/migrate commands directly.
if [ "$#" -eq 0 ]; then
  set -- api
fi

case "$1" in
  api)
    shift
    set -- /app/runtime/api.mjs "$@"
    ;;
  worker)
    shift
    set -- /app/runtime/worker.mjs "$@"
    ;;
  migrate)
    shift
    if [ "$#" -eq 0 ]; then
      set -- migrate
    fi
    set -- /app/runtime/migrate.mjs "$@"
    ;;
  backup-volume-init)
    shift
    set -- /app/runtime/init-backup-volume.mjs "$@"
    ;;
  node)
    shift
    if [ "${1:-}" = "--import" ] && [ "${2:-}" = "tsx" ]; then
      shift 2
    fi
    case "${1:-}" in
      docker/worker.ts)
        shift
        set -- /app/runtime/worker.mjs "$@"
        ;;
      scripts/db.ts)
        shift
        set -- /app/runtime/migrate.mjs "$@"
        ;;
    esac
    ;;
esac

exec node "$@"
