"""Run the compiled migration/API/worker with an owned synthetic PostgreSQL."""
import datetime
import json
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error

BASE = Path(__file__).resolve().parent
OWNER = secrets.token_hex(12)
OUT = BASE / ("durable-smoke-" + OWNER)
OUT.mkdir()
BUILD = json.loads((BASE / "verified-builds.json").read_text())
IMAGE = next(item["image_id"] for item in BUILD["builds"] if item["kind"] == "api")
ORG = "00000000-0000-4000-8000-000000000010"
PASSWORD = secrets.token_hex(24)
RUNTIME_PASSWORD = secrets.token_hex(24)
BOOTSTRAP = secrets.token_hex(24)
REPORT = {"source_fingerprint": BUILD["source_fingerprint"], "image_id": IMAGE,
          "scope": "local compiled entrypoints; synthetic PostgreSQL; NODE_ENV=test; no TLS or provider qualification",
          "checks": [], "containers": [], "network_removed": False,
          "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
NETWORK = None
COOKIES = {}
HTTP_CLIENT = """
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const input=JSON.parse(raw);
const response=await fetch('http://127.0.0.1:4310'+input.path, {
  method:input.payload===null?'GET':'POST', redirect:'manual',
  headers:{'content-type':'application/json','origin':'http://127.0.0.1:5173',cookie:input.cookie},
  ...(input.payload===null?{}:{body:JSON.stringify(input.payload)}), signal:AbortSignal.timeout(4000)
});
console.log(JSON.stringify({status:response.status,body:await response.json(),cookies:response.headers.getSetCookie()}));
"""


def docker(*args, timeout=35):
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()


def start(kind, image, environment, arguments=(), publish=False, database=False):
    name = "cvg-durable-" + kind + "-" + OWNER
    args = ["run", "--detach", "--pull=never", "--name", name, "--network", NETWORK,
            "--label", "cvg.durable-smoke.owner=" + OWNER]
    if database:
        args += ["--network-alias", "db", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=384m"]
    else:
        args += ["--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                 "--tmpfs", "/tmp:rw,nosuid,noexec,size=32m,mode=1777"]
    if publish:
        args += ["--publish", "127.0.0.1::4310"]
    for key, value in environment.items():
        args += ["--env", key + "=" + value]
    container_id = docker(*args, image, *arguments)
    entry = {"kind": kind, "id": container_id, "removed": False}
    REPORT["containers"].append(entry)
    info = json.loads(docker("inspect", container_id))[0]
    assert info["Config"]["Labels"]["cvg.durable-smoke.owner"] == OWNER
    if not database:
        assert info["HostConfig"]["ReadonlyRootfs"]
        assert info["Config"]["User"].split(":")[0] == "65532"
    return container_id


def poll(check, seconds=25):
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check()
        except (AssertionError, urllib.error.URLError, subprocess.CalledProcessError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)


def sql(query):
    return docker("exec", pg, "psql", "-U", "cvg_smoke", "-d", "cvg_smoke", "-At", "-c", query)


def request(path, expected=200, payload=None):
    result = subprocess.run(["docker", "exec", "-i", api, "/nodejs/bin/node", "--input-type=module", "-e", HTTP_CLIENT],
        input=json.dumps({"path": path, "payload": payload, "cookie": "; ".join(key + "=" + value for key, value in COOKIES.items())}),
        text=True, capture_output=True, check=True, timeout=10)
    response = json.loads(result.stdout)
    assert response["status"] == expected, f"{path}: expected {expected}, got {response['status']}"
    for cookie in response["cookies"]:
        key, value = cookie.split(";", 1)[0].split("=", 1)
        COOKIES[key] = value
    return response["body"]


try:
    NETWORK = docker("network", "create", "--internal", "--label", "cvg.durable-smoke.owner=" + OWNER,
                     "cvg-durable-" + OWNER)
    pg = start("postgres", "postgres:16-alpine", {"POSTGRES_USER": "cvg_smoke",
               "POSTGRES_PASSWORD": PASSWORD, "POSTGRES_DB": "cvg_smoke"}, database=True)
    poll(lambda: sql("select 1"))
    migration = start("migrate", IMAGE, {
        "DATABASE_URL": "postgresql://cvg_smoke:" + PASSWORD + "@db:5432/cvg_smoke",
        "CVG_RUNTIME_DB_USER": "cvg_runtime", "CVG_RUNTIME_DB_PASSWORD": RUNTIME_PASSWORD}, ["migrate"])
    assert docker("wait", migration) == "0", "compiled migration failed"
    assert sql("select count(*) from schema_migrations") == "49"
    assert sql("select count(*) from pg_roles where rolname='cvg_runtime' and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole") == "1"
    REPORT["checks"] += ["compiled_migrate_exit_0", "migrations_49", "runtime_role_unprivileged"]
    runtime_env = {"NODE_ENV": "test", "CVG_STORAGE": "postgres", "CVG_DEMO_MODE": "false",
                   "DATABASE_URL": "postgresql://cvg_runtime:" + RUNTIME_PASSWORD + "@db:5432/cvg_smoke",
                   "CVG_AGENT_RUNTIME": "disabled", "CVG_DEEPSEEK_RUNTIME_ENABLED": "false",
                   "CVG_AUTH_MFA_MODE": "disabled", "CVG_SECRET_PROVIDER": "none",
                   "CVG_HOST": "0.0.0.0", "CVG_BOOTSTRAP_PASSWORD": BOOTSTRAP,
                   "CVG_WEB_ORIGIN": "http://127.0.0.1:5173", "OTEL_SDK_DISABLED": "true"}
    # The isolated internal network does not expose host port bindings. Make
    # actual HTTP requests on the API container's own loopback instead.
    api = start("api", IMAGE, runtime_env, ["api"])
    poll(lambda: request("/api/v1/ready"))
    request("/api/v1/patients", 401)
    request("/api/v1/auth/login", payload={"login": "admin@cvg.local", "password": BOOTSTRAP})
    before_me = request("/api/v1/me")["data"]
    request("/api/v1/contexts")
    assert int(sql("select count(*) from sessions")) >= 1
    REPORT["checks"] += ["postgres_api_ready", "anonymous_401", "authenticated_login", "durable_session_sql"]
    docker("restart", "--timeout", "15", api)
    poll(lambda: request("/api/v1/ready"))
    after_me = request("/api/v1/me")["data"]
    def changed_fields(before, after, path="data"):
        if isinstance(before, dict) and isinstance(after, dict):
            return [field for key in sorted(before.keys() | after.keys())
                    for field in changed_fields(before.get(key), after.get(key), path + "." + key)]
        return [] if before == after else [path]
    REPORT["restart_changed_fields"] = changed_fields(before_me, after_me)
    # A fresh HTTP request receives its own correlation ID. Every identity,
    # session and authorization field must survive the process restart.
    assert REPORT["restart_changed_fields"] == ["data.context.correlationId"], "unexpected session response changes: " + ", ".join(REPORT["restart_changed_fields"])
    REPORT["checks"].append("session_survives_api_restart")
    worker = start("worker", IMAGE, {"NODE_ENV": "test", "CVG_STORAGE": "postgres",
        "DATABASE_URL": runtime_env["DATABASE_URL"], "CVG_WORKER_ORGANIZATION_ID": ORG,
        "CVG_WORKER_ID": "image-smoke-" + OWNER, "CVG_WORKER_INTERVAL_MS": "1000",
        "CVG_WORKER_SINK_MODE": "quarantine", "CVG_SECRET_PROVIDER": "none", "OTEL_SDK_DISABLED": "true"}, ["worker"])
    def heartbeat():
        value = json.loads(docker("exec", worker, "/nodejs/bin/node", "--input-type=module", "-e",
            "import{readFileSync}from'node:fs';console.log(readFileSync('/tmp/cvg-worker/heartbeat','utf8'))"))
        assert value["failedLanes"] == "" and value["cycleStatus"] != "FAILED"
        assert value["delivered"] == 0
        return value
    poll(heartbeat)
    assert int(sql("select count(*) from cvg_worker_heartbeats where organization_id='" + ORG + "'")) >= 1
    REPORT["checks"] += ["compiled_worker_cycle", "durable_worker_heartbeat", "no_external_delivery"]
    for kind, container in [("worker", worker), ("api", api)]:
        docker("kill", "--signal=TERM", container)
        assert docker("wait", container) == "0", kind + " failed graceful shutdown"
        REPORT["checks"].append(kind + "_sigterm_exit_0")
    REPORT["status"] = "PASS"
except Exception as error:
    REPORT["status"] = "FAIL"
    message = str(error)
    for secret in [PASSWORD, RUNTIME_PASSWORD, BOOTSTRAP]:
        message = message.replace(secret, "[synthetic-redacted]")
    REPORT["error"] = type(error).__name__ + ": " + message
finally:
    for entry in reversed(REPORT["containers"]):
        info = json.loads(docker("inspect", entry["id"]))[0]
        assert info["Id"] == entry["id"] and info["Config"]["Labels"]["cvg.durable-smoke.owner"] == OWNER
        try:
            (OUT / (entry["kind"] + ".log")).write_text(docker("logs", entry["id"]))
        finally:
            docker("rm", "--force", "--volumes", entry["id"])
            entry["removed"] = True
    if NETWORK:
        info = json.loads(docker("network", "inspect", NETWORK))[0]
        assert info["Labels"]["cvg.durable-smoke.owner"] == OWNER and not info["Containers"]
        docker("network", "rm", NETWORK)
        REPORT["network_removed"] = True
    REPORT["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT / "results.json").write_text(json.dumps(REPORT, indent=2) + "\n")
print(json.dumps(REPORT, indent=2))
raise SystemExit(0 if REPORT["status"] == "PASS" else 1)
