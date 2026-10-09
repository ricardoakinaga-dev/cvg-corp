"""Requalify one committed SHA: run each gate, bind every receipt to the SHA,
the subject fingerprint and the tree state observed before and after it.

Usage: GATES_OUT=<dir relative to repo> python3 requalify.py [step ...]
A receipt whose subject changed during the command is marked SUBJECT_DRIFT.
"""
import datetime
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time

ROOT = "/home/ricardo/Área de trabalho/cvg-corp"
OUT = os.path.join(ROOT, os.environ["GATES_OUT"])
os.makedirs(OUT, exist_ok=True)
RUNTIME = os.environ["REQUAL_RUNTIME"]

STEPS = [
    ("typecheck", ["npm", "run", "typecheck"]),
    ("lint", ["npm", "run", "lint"]),
    ("full-suite", ["npm", "test"]),
    ("build", ["npm", "run", "build"]),
    ("architecture", ["npm", "run", "verify:architecture"]),
    ("static", ["npm", "run", "verify:static"]),
    ("pdp", ["npm", "run", "verify:pdp"]),
    ("pdp-universal", ["npm", "run", "verify:pdp-universal"]),
    ("schema-manifest", ["npm", "run", "verify:schema-manifest"]),
    ("docs-integrity", ["npm", "run", "verify:docs-integrity"]),
    ("claims", ["npm", "run", "verify:claims"]),
    ("licenses", ["npm", "run", "audit:licenses"]),
    ("design-tokens", ["npm", "run", "audit:tokens"]),
    ("contrast", ["npm", "run", "audit:contrast"]),
    ("ai-disabled", ["npm", "run", "verify:ai-disabled"]),
    ("agent-security", ["npm", "run", "verify:agent-security"]),
    ("provider-sandbox", ["npm", "run", "verify:provider-sandbox"]),
    ("authoritative-writes", ["npm", "run", "verify:authoritative-writes"]),
    ("worker-runtime", ["npm", "run", "verify:worker-runtime"]),
    ("coverage", ["npm", "run", "verify:coverage"]),
    ("mutation", ["npm", "run", "verify:mutation"]),
    ("production-structure", ["node", "--import", "tsx", "scripts/verify-production.ts", "--structural", "--skip-local-gates"]),
    ("npm-audit", ["npm", "audit"]),
    ("secrets", ["npm", "run", "verify:secrets"]),
    ("diff-check", ["git", "diff", "--check"]),
    ("ci-test-contract", ["npm", "run", "test:contract"]),
    ("ci-test-security", ["npm", "run", "test:security"]),
    ("ci-test-database", ["npm", "run", "test:database"]),
    ("ci-test-fault", ["npm", "run", "test:fault"]),
    ("ci-build-runtime", ["npm", "run", "build:runtime"]),
    ("ci-audit-chain", ["npm", "run", "verify:audit-chain"]),
    ("ci-agent-runtime", ["npm", "run", "verify:agent-runtime"]),
    ("ci-agent-runtime-smoke", ["npm", "run", "verify:agent-runtime-smoke"]),
    ("ci-embedded-harness", ["npm", "run", "verify:embedded-harness"]),
    ("ci-plugins", ["npm", "run", "verify:plugins"]),
    ("ci-skills", ["npm", "run", "verify:skills"]),
    ("ci-agent-evals", ["npm", "run", "verify:agent-evals"]),
    ("postgres-api-response", ["node", "--import", "tsx", "tests/integration/api-response-postgres.verify.ts"]),
    ("postgres-migration-cli", ["npm", "run", "verify:db-migration-cli"]),
    ("postgres-core-restore", ["npm", "run", "verify:ephemeral-postgres", "--", "--rounds=1", "--run-restore"]),
    ("postgres-migration-data", ["npm", "run", "verify:ephemeral-postgres", "--", "--rounds=1", "--run-aud27-migration", "--run-aud27-normalized-writes"]),
    ("postgres-24-slices", ["npm", "run", "verify:ephemeral-postgres", "--", "--rounds=1", "--run-aud27-24-slices"]),
    ("alertmanager", ["npm", "run", "verify:alertmanager"]),
    ("evidence-aud26-capture", ["npm", "run", "verify:aud26-evidence", "--", "--capture"]),
    ("evidence-snapshot", ["npm", "run", "verify:evidence-snapshot"]),
    ("e2e-full-matrix", ["npx", "playwright", "test", "--reporter=list,json"]),
    # Every project except firefox-stress, whose Firefox content process enters
    # an unkillable kernel loop on this host (see e2e-hang-diagnostics/).
    ("e2e-matrix-host-bounded", ["npx", "playwright", "test", "--reporter=list,json", "--project=chromium-wide-1440", "--project=chromium-tablet-768", "--project=chromium-mobile-375", "--project=firefox-wide-1440", "--project=firefox-tablet-768", "--project=firefox-mobile-375", "--project=webkit-wide-1440", "--project=webkit-tablet-768", "--project=webkit-mobile-375", "--project=chromium-stress", "--project=webkit-stress"]),
    ("image-builds", ["python3", "/tmp/claude-1000/-home-ricardo--rea-de-trabalho-cvg-corp/7bb373b5-a17c-4b1f-898f-5e365e4ddc59/scratchpad/build-images-committed.py"]),
    ("image-smoke", ["python3", f"{RUNTIME}/smoke-images.py", f"{RUNTIME}/verified-builds.json"]),
    ("image-durable-smoke", ["python3", f"{RUNTIME}/smoke-durable-images.py"]),
]

# Outputs that gates regenerate inside tracked files; they are restored after
# each step so the next one sees the committed subject.
TRACKED_OUTPUTS = ["artifacts/aud26", "artifacts/coverage-output.txt", "artifacts/coverage-summary.json",
                   "artifacts/mutation-summary.json", "artifacts/operational-proof"]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


SUBJECT_PATHSPEC = [".", ":(exclude).agent/", ":(exclude)artifacts/", ":(exclude).gauntlet/", ":(exclude).opencode/"]


def subject():
    fingerprint = subprocess.check_output(["npx", "tsx", "-e", 'import { buildSubjectManifest } from "./scripts/subject-manifest.ts"; console.log(buildSubjectManifest().fingerprint)'], cwd=ROOT, text=True).strip().splitlines()[-1]
    drift = [line for line in git("status", "--porcelain=v1", "--untracked-files=no", "--", *SUBJECT_PATHSPEC).splitlines() if line.strip()]
    return {"sha": git("rev-parse", "HEAD"), "code_sha": git("log", "-1", "--format=%H", "--", *SUBJECT_PATHSPEC),
            "fingerprint": fingerprint, "tracked_changes": drift}


# Watchdog: a step fails closed when its log stops growing for `stall` seconds
# or when it runs longer than `limit` seconds. Playwright starts its web
# servers in their own sessions and browsers can orphan children, so every
# descendant seen while the step runs is tracked by (pid, start time) and
# signalled individually, not only the step's own process group.
WATCHDOG = {"e2e-full-matrix": (600, 3600), "e2e-matrix-host-bounded": (600, 3600), "e2e-firefox-stress-probe": (120, 600)}
DEFAULT_WATCHDOG = (900, 2400)


def start_time(pid):
    try:
        text = open(f"/proc/{pid}/stat").read()
        return text[text.rindex(")") + 2:].split()[19]
    except (OSError, ValueError, IndexError):
        return None


def descendants(root):
    children = {}
    for entry in os.listdir("/proc"):
        if entry.isdigit():
            try:
                text = open(f"/proc/{entry}/stat").read()
                children.setdefault(int(text[text.rindex(")") + 2:].split()[1]), []).append(int(entry))
            except (OSError, ValueError, IndexError):
                pass
    found, stack = [], [root]
    while stack:
        for child in children.get(stack.pop(), []):
            found.append(child)
            stack.append(child)
    return found


def signal_all(proc, seen, sig):
    try:
        os.killpg(proc.pid, sig)
    except OSError:
        pass
    for pid, started in seen.items():
        if start_time(pid) == started:
            try:
                os.kill(pid, sig)
            except OSError:
                pass


def run_with_watchdog(command, env, log, stall, limit):
    seen, fired = {}, None
    with open(log, "wb") as handle:
        proc = subprocess.Popen(command, cwd=ROOT, stdout=handle, stderr=subprocess.STDOUT, env=env, start_new_session=True)
        seen[proc.pid] = start_time(proc.pid)
        started = last_change = time.time()
        last_size = 0
        while True:
            try:
                rc = proc.wait(timeout=5)
                break
            except subprocess.TimeoutExpired:
                pass
            for pid in descendants(proc.pid):
                seen.setdefault(pid, start_time(pid))
            size = os.path.getsize(log)
            if size != last_size:
                last_size, last_change = size, time.time()
            now = time.time()
            if now - last_change > stall:
                fired = {"reason": "STALLED", "idle_s": round(now - last_change, 1)}
            elif now - started > limit:
                fired = {"reason": "TIMEOUT", "elapsed_s": round(now - started, 1)}
            if fired:
                signal_all(proc, seen, signal.SIGTERM)
                time.sleep(10)
                signal_all(proc, seen, signal.SIGKILL)
                rc = proc.wait()
                break
    # Descendants that outlive the step are reported, never silently ignored.
    survivors = [pid for pid, started in seen.items() if started and start_time(pid) == started]
    return rc, fired, survivors


only = set(sys.argv[1:])
for name, command in STEPS:
    if only and name not in only:
        continue
    before = subject()
    env = {**os.environ, "FORCE_COLOR": "0"}
    if name.startswith("e2e-"):
        env["PLAYWRIGHT_OUTPUT_DIR"] = os.path.join(ROOT, "test-results", "requalification-e2e")
        env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = os.path.join(OUT, name + "-report.json")
    if name == "alertmanager":
        env.pop("CVG_ALERTMANAGER_WEBHOOK_URL", None)
    log = os.path.join(OUT, name + ".log")
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    t0 = time.time()
    stall, limit = WATCHDOG.get(name, DEFAULT_WATCHDOG)
    rc, fired, survivors = run_with_watchdog(command, env, log, stall, limit)
    duration = round(time.time() - t0, 1)
    for produced in {"mutation": ["artifacts/mutation-summary.json"], "coverage": ["artifacts/coverage-summary.json"]}.get(name, []):
        if os.path.exists(os.path.join(ROOT, produced)):
            shutil.copyfile(os.path.join(ROOT, produced), os.path.join(OUT, os.path.basename(produced)))
    subprocess.run(["git", "checkout", "--", *TRACKED_OUTPUTS], cwd=ROOT, check=False, stderr=subprocess.DEVNULL)
    after = subject()
    receipt = {
        "name": name, "command": command, "exit_status": rc, "started_at": started, "duration_s": duration,
        "head_sha": before["sha"], "code_sha": before["code_sha"], "subject_fingerprint": before["fingerprint"],
        "subject_tracked_changes_before": before["tracked_changes"], "subject_tracked_changes_after": after["tracked_changes"],
        "subject_after": "UNCHANGED" if (after["sha"], after["fingerprint"], after["tracked_changes"]) == (before["sha"], before["fingerprint"], before["tracked_changes"]) else "SUBJECT_DRIFT",
        "log": os.path.relpath(log, ROOT), "log_sha256": hashlib.sha256(open(log, "rb").read()).hexdigest(),
        "watchdog": {"stall_limit_s": stall, "time_limit_s": limit, "fired": fired, "surviving_descendants": survivors},
    }
    json.dump(receipt, open(os.path.join(OUT, name + ".json"), "w"), indent=2)
    print(f"{name} exit={rc} watchdog={fired['reason'] if fired else 'ok'} survivors={len(survivors)} {duration}s {receipt['subject_after']} code={before['code_sha'][:7]} head={before['sha'][:7]} {before['fingerprint'][7:19]}", flush=True)
print("DONE", flush=True)
