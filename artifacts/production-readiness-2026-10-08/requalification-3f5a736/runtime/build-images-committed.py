"""Build the API and web images from the committed tree (git archive HEAD), never
from the working tree, and record the builds next to the smoke scripts."""
import datetime
import hashlib
import json
import os
import subprocess
import time

ROOT = "/home/ricardo/Área de trabalho/cvg-corp"
RUNTIME = os.path.join(ROOT, os.environ["REQUAL_RUNTIME"])
VERIFICATION = os.path.join(ROOT, os.environ["GATES_OUT"])
SHA = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
FP = subprocess.check_output(["npx", "tsx", "-e", 'import { buildSubjectManifest } from "./scripts/subject-manifest.ts"; console.log(buildSubjectManifest().fingerprint)'], cwd=ROOT, text=True).strip().splitlines()[-1]
builds = []
failed = False
for kind, dockerfile in (("api", "Dockerfile.api"), ("web", "Dockerfile.web")):
    tag = f"cvg-corp-requal-{kind}:{SHA[:12]}"
    log = os.path.join(VERIFICATION, f"image-{kind}.log")
    t0 = time.time()
    with open(log, "wb") as handle:
        archive = subprocess.Popen(["git", "archive", "--format=tar", SHA], cwd=ROOT, stdout=subprocess.PIPE)
        rc = subprocess.run(["docker", "build", "--file", dockerfile, "--build-arg", f"CVG_SOURCE_REVISION={SHA}",
                             "--label", f"io.cvg.qualification.fingerprint={FP}", "--label", f"io.cvg.qualification.source-sha={SHA}",
                             "--tag", tag, "-"], cwd=ROOT, stdin=archive.stdout, stdout=handle, stderr=subprocess.STDOUT).returncode
        archive.stdout.close()
        rc = rc or archive.wait()
    image_id = subprocess.check_output(["docker", "image", "inspect", tag, "--format", "{{.Id}}"], text=True).strip() if rc == 0 else None
    user = subprocess.check_output(["docker", "image", "inspect", tag, "--format", "{{.Config.User}}"], text=True).strip() if rc == 0 else None
    receipt = {"name": f"image-{kind}", "context": f"git archive {SHA}", "exit_status": rc, "duration_s": round(time.time() - t0, 1),
               "source_sha": SHA, "subject_fingerprint": FP, "tag": tag, "image_id": image_id,
               "log": os.path.relpath(log, ROOT), "log_sha256": hashlib.sha256(open(log, "rb").read()).hexdigest(),
               "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    json.dump(receipt, open(os.path.join(VERIFICATION, f"image-{kind}.json"), "w"), indent=2)
    builds.append({"kind": kind, "tag": tag, "image_id": image_id, "user": user, "exit_status": rc, "receipt": os.path.relpath(os.path.join(VERIFICATION, f"image-{kind}.json"), ROOT)})
    failed = failed or rc != 0
    print(f"image-{kind} exit={rc} {receipt['duration_s']}s {image_id}", flush=True)
json.dump({"source_fingerprint": FP, "source_sha": SHA, "context": "git archive of the committed SHA", "scope": "committed source; not a frozen release", "builds": builds},
          open(os.path.join(RUNTIME, "verified-builds.json"), "w"), indent=2)
raise SystemExit(1 if failed else 0)
