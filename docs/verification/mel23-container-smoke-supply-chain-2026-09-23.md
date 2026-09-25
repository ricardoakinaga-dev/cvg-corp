# MEL23 local container and supply-chain checks — 2026-09-23

Status: supporting local evidence for MEL23-015, MEL23-016 and MEL23-039. This
does not qualify a release candidate or change the overall promotion verdict.

## Subject and limits

Both images were built from the local working tree at HEAD
`c990914148a8f375082cd12bbdb2ad20cfe1900f`. The tree was dirty, so both builds
used `CVG_SOURCE_REVISION=unbound`; the BuildKit VCS revision is only the Git
HEAD and does not describe the uncommitted files. The image digests below
identify these local test images, not a frozen candidate. No registry push,
signature, external issuer, production deployment, real veterinary data,
provider, or credential was used. Login and guardian records used synthetic
local values.

After the documentation and evidence updates in this continuation,
`candidate_fingerprint` remains `null` and the matrix qualifies 0/50 rows.

## API image — MEL23-015

`cvg-mel23-api:mel23-015-20260923-r4` has local index digest
`sha256:795eb35d1d4eedca9b15b345ceceee790020a3553224a159382f3245a1d3fc42`,
platform manifest digest
`sha256:74691497fe8ac98533e423df0f907d1d12b5dc5027ff837709eeb411d9366485`, and
config digest
`sha256:f5c276225d7c8c5773178cc6714917f5aeafae7ba7b80ea5c7b8ac69c9decd74`.
The API Dockerfile build ran `npm run typecheck`, `npm run build:runtime`, and
the runtime entrypoint syntax check. BuildKit exported SPDX and SLSA v0.2
attestations; the subjects in both attestations match the platform manifest.
The SPDX 2.3 document contains 16 packages.

The image ran as UID/GID `65532:65532` with a read-only root filesystem, all
Linux capabilities dropped, `no-new-privileges`, a 768 MiB memory limit and a
1 CPU limit. It connected only to an internal disposable network, with no host
port published. A pinned PostgreSQL 18.0 disposable database ran as UID/GID
`999:999`, also with a read-only root filesystem and all capabilities dropped.
The image's bare `migrate` command applied all 48 migrations. A synthetic
login returned 200, a guardian write returned 201, and a scoped read returned
200. After a graceful stop (exit 0) and restart, health and readiness returned
200 and the same guardian remained readable. No release SHA or artifact digest
was supplied; release binding was not tested.

Trivy 0.74.0 scanned the saved image archive with its database downloaded at
`2026-09-23T14:07:58Z`. It reported 22 Debian 13.7 OS-package vulnerabilities:
15 medium and 7 low, with no critical or high findings. All 22 entries had an
empty fixed-version field. The scan reported zero secrets and zero
misconfigurations. No organization-approved severity threshold or risk
acceptance was supplied.

## Web image — MEL23-016

`cvg-mel23-web:mel23-016-20260923-r2` has local index digest
`sha256:83936d5150baad4d98ffaa60a7ba7d9ca551a25469706e451069b232336bf11f`,
platform manifest digest
`sha256:9a4bb0b20a6ca8f2fe310cc7f39ce83e9b27cdb9945dd80fe2ba3bba4b8256aa`, and
config digest
`sha256:232ed49a05a433627b1164d18952838d546b20e608cf1ec2a9deab836592f512`.
Its SPDX 2.3 document contains 71 packages, and its BuildKit SLSA v0.2 and SPDX
subjects match the platform manifest.

The web image ran as UID/GID `101:101` with a read-only root filesystem, all
capabilities dropped, `no-new-privileges`, a 128 MiB memory limit and a 0.5 CPU
limit. It had no published host port and used the internal test network. The
health endpoint, root page, JavaScript and CSS assets returned 200. The root
page and assets returned the configured Content-Security-Policy, frame,
content-type, referrer, permissions and cross-origin headers. Trivy reported
zero vulnerabilities, secrets, and misconfigurations for Alpine 3.24.1.

## Compose and backup-volume checks — MEL23-039

`docker compose config` successfully resolved the production overlay using a
synthetic environment file; it did not start services or mutate a Compose
project. The summary is recorded in
[`compose-production-static-summary.json`](../../artifacts/operational-proof/mel23-image-smoke-2026-09-23/compose-production-static-summary.json).
The backend and observability networks resolve as internal. Only the proxy
joins the non-internal edge network, which retains network egress; an external
egress policy remains an operational decision. The configuration references
external Docker secrets and TLS files, but their providers, contents and TLS
behavior were not exercised.

The Postgres service now pins PostgreSQL 18.0, runs as UID/GID `999:999`, drops
all capabilities and has a read-only root filesystem. The worker's new
`backup-init` one-shot service has no network, a read-only root filesystem, and
only `CHOWN` added to its dropped capabilities. A fresh disposable volume probe
confirmed that it changes only the backup directory owner to `65532:65532`;
an existing root-owned mode-0600 marker retained its UID, mode and bytes, and
the worker identity could create and read a synthetic backup file. No backup
restore or production volume was touched.

## Evidence files

The [`image-smoke` evidence directory](../../artifacts/operational-proof/mel23-image-smoke-2026-09-23/)
contains the current report, raw Trivy JSON, BuildKit SPDX and SLSA in-toto
documents, and BuildKit metadata. The JSON report maps each attestation subject
to its platform manifest and each Trivy `Metadata.ImageID` to the corresponding
image config digest. [`SHA256SUMS.txt`](../../artifacts/operational-proof/mel23-image-smoke-2026-09-23/SHA256SUMS.txt)
contains hashes for the 17 evidence files. The OCI index digests for the attestation-export builds
are also recorded separately because their generated provenance changes the
index while retaining the same platform manifest subject.

These local checks add evidence but do not close the mapped MEL23 requirements:
the current matrix remains 0/50 qualified because the receipts do not match the
observed subject fingerprint. License-policy approval, frozen candidate
identity, external evidence and human acceptance remain open. Promotion stays
`PROMOTION_BLOCKED / AAA_NOT_PROVEN`.
