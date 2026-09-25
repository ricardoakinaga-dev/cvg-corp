# Changelog

## Unreleased

- Hardened the reproducible Node/npm toolchain and production container build.
- Added non-root compiled runtime images, build-context exclusions, SBOM/
  provenance generation, and dedicated secret scanning in CI.
- Made a bare API image `migrate` command apply forward migrations, and added
  a networkless backup-volume initializer so the unprivileged worker can write
  backups without changing existing artifact files.
- Pinned the Postgres image digest and verified its UID 999, read-only,
  capability-free runtime against the pinned image.
