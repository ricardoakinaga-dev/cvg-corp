"""Archive audit-generated tracked outputs, then restore their clean baseline bytes.

Only the explicit output paths below are eligible. Product, docs and .agent
are never written. The initial inventory proves these outputs were clean.
"""
from pathlib import Path
import hashlib
import json
import subprocess
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[2]
audit = root / "artifacts/audit-2026-10-03"
baseline = json.loads((audit / "docs-inventory.json").read_text())
def git(*args):
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True).stdout
def sha(data):
    return hashlib.sha256(data).hexdigest()

assert git("rev-parse", "HEAD").decode().strip() == baseline["head"]
names = [
    "application-pdp-coverage", "browser-e2e", "contract-tests", "contrast-audit",
    "cyclonedx-sbom", "database-recovery-tests", "dependency-audit", "design-token-audit",
    "diff-whitespace", "fault-worker-tests", "license-policy", "provider-loopback-sandbox",
    "repository-lint", "security-tests", "static-verification", "synthetic-benchmark",
    "typecheck", "unit-integration-tests", "web-build",
]
eligible = [f"artifacts/aud26/production-gates/{name}.json" for name in names] + [
    "artifacts/coverage-output.txt", "artifacts/coverage-summary.json",
    "artifacts/mutation-summary.json", "artifacts/operational-proof/mel23-evidence-matrix-current.json",
]
records = []
for relative in eligible:
    if relative in baseline["gitStatus"]:
        raise RuntimeError(f"Refusing a pre-existing modification: {relative}")
    source = root / relative
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"Expected regular generated file: {relative}")
    current = source.read_bytes()
    original = git("show", f"HEAD:{relative}")
    target = audit / "generated" / relative
    if target.exists() and target.read_bytes() != current:
        raise RuntimeError(f"Archive already differs: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(current)
    assert target.read_bytes() == current
    if source.read_bytes() != current:
        raise RuntimeError(f"Concurrent writer detected: {relative}")
    source.write_bytes(original)
    assert source.read_bytes() == original
    records.append({"path": relative, "archive": str(target.relative_to(root)),
                    "audit_sha256": sha(current), "baseline_sha256": sha(original),
                    "baseline_restored": True})
result = {"observed_at": datetime.now(timezone.utc).isoformat(), "head": baseline["head"],
          "method": "Exact audit bytes archived; only initially-clean named generated outputs restored from HEAD.",
          "records": records, "product_and_control_plane_written": False}
(audit / "generated-preservation.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"archived_and_restored": len(records), "manifest": "generated-preservation.json"}))
