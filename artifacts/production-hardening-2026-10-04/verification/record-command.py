"""Record a local check against the actual source before and after execution."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "after-review"
OUT.mkdir(exist_ok=True)


def subject():
    script = "import {buildSubjectManifest} from './scripts/subject-manifest.ts'; console.log(JSON.stringify(buildSubjectManifest()));"
    return json.loads(subprocess.check_output(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=ROOT, text=True))


if __name__ == "__main__":
    name, *command = sys.argv[1:]
    if not name.replace("-", "").isalnum() or not command:
        raise SystemExit("usage: record-command.py NAME COMMAND [ARGS...]")
    receipt_path = OUT / (name + ".json")
    log_path = OUT / (name + ".log")
    if receipt_path.exists() or log_path.exists():
        raise SystemExit("Refusing to overwrite prior verification evidence")
    before = subject()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with log_path.open("w") as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                                env={**os.environ, "OTEL_SDK_DISABLED": "true"})
    after = subject()
    receipt = {"name": name, "command": command, "exit_status": result.returncode,
               "started_at": started, "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
               "source_fingerprint_before": before["fingerprint"],
               "source_fingerprint_after": after["fingerprint"],
               "source_unchanged": before["fingerprint"] == after["fingerprint"],
               "log": str(log_path.relative_to(ROOT)),
               "log_sha256": hashlib.sha256(log_path.read_bytes()).hexdigest()}
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    (OUT / (name + "-subject.json")).write_text(json.dumps(before, indent=2) + "\n")
    print(json.dumps(receipt, indent=2), flush=True)
    print("\n".join(log_path.read_text(errors="replace").splitlines()[-18:]), flush=True)
    raise SystemExit(result.returncode if receipt["source_unchanged"] else 3)
