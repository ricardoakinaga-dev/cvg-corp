"""Exercise locally built images with synthetic data and owned containers only."""
import datetime
import http.cookiejar
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = Path(__file__).resolve().parent
OWNER = uuid.uuid4().hex
OUT = BASE / ("smoke-" + OWNER[:12])
OUT.mkdir()
REPORT = {"started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "scope": "local images, synthetic memory API, loopback HTTP; no deployment or real providers",
          "containers": []}


def docker(*args, timeout=30):
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()


def request(opener, base, path, expected, data=None, headers=None):
    req = urllib.request.Request(base + path, data=data, headers=headers or {})
    try:
        response = opener.open(req, timeout=3)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read().decode()
        assert response.status == expected, f"{path}: expected {expected}, observed {response.status}"
        return body, dict(response.headers)


def smoke(build):
    assert build["exit_status"] == 0, "image build did not pass"
    kind = build["kind"]
    port = "4310" if kind == "api" else "8080"
    name = f"cvg-hardening-{kind}-{OWNER[:12]}"
    result = {"kind": kind, "name": name, "image": build["image_id"], "checks": [], "removed": False}
    REPORT["containers"].append(result)
    container_id = None
    try:
        args = ["run", "--detach", "--name", name, "--label", f"cvg.hardening.owner={OWNER}",
                "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                "--tmpfs", "/tmp:rw,nosuid,noexec,size=32m,mode=1777", "--publish", f"127.0.0.1::{port}"]
        if kind == "api":
            environment = {"NODE_ENV": "test", "CVG_HOST": "0.0.0.0", "CVG_API_PORT": port,
                           "CVG_STORAGE": "memory", "CVG_DEMO_MODE": "false", "CVG_AGENT_RUNTIME": "disabled",
                           "CVG_DEEPSEEK_RUNTIME_ENABLED": "false", "CVG_AUTH_MFA_MODE": "disabled",
                           "CVG_SECRET_PROVIDER": "none", "CVG_BOOTSTRAP_PASSWORD": "synthetic-image-smoke-" + OWNER,
                           "CVG_WEB_ORIGIN": "http://127.0.0.1:5173"}
            for key, value in environment.items():
                args += ["--env", key + "=" + value]
        container_id = docker(*args, build["image_id"])
        info = json.loads(docker("inspect", container_id))[0]
        assert info["Config"]["Labels"]["cvg.hardening.owner"] == OWNER
        assert info["HostConfig"]["ReadonlyRootfs"]
        assert str(info["Config"]["User"]).split(":")[0] not in ("", "0", "root")
        result.update(container_id=container_id, user=info["Config"]["User"])
        binding = info["NetworkSettings"]["Ports"][port + "/tcp"][0]
        assert binding["HostIp"] == "127.0.0.1"
        base = "http://127.0.0.1:" + binding["HostPort"]
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        health = "/api/v1/health" if kind == "api" else "/healthz"
        deadline = time.monotonic() + 30
        while True:
            try:
                request(opener, base, health, 200)
                break
            except (urllib.error.URLError, OSError, AssertionError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.2)
        result["checks"] += ["non_root", "read_only_rootfs", "loopback_only_publish", "health_200"]
        if kind == "api":
            request(opener, base, "/api/v1/ready", 200)
            request(opener, base, "/api/v1/patients", 401)
            body, _ = request(opener, base, "/api/v1/auth/login", 400,
                              b'{"private":"synthetic-smoke-value",', {"Content-Type": "application/json"})
            assert json.loads(body)["error"]["code"] == "INVALID_INPUT"
            assert "synthetic-smoke-value" not in body
            login = json.dumps({"login": "admin@cvg.local", "password": "synthetic-image-smoke-" + OWNER}).encode()
            request(opener, base, "/api/v1/auth/login", 200, login,
                    {"Content-Type": "application/json", "Origin": "http://127.0.0.1:5173"})
            body, _ = request(opener, base, "/api/v1/me", 200)
            assert json.loads(body)["schemaVersion"] == 1
            request(opener, base, "/api/v1/contexts", 200)
            result["checks"] += ["ready_200", "anonymous_denied_401", "malformed_json_redacted_400", "password_login_200", "session_and_contexts_200"]
        else:
            body, headers = request(opener, base, "/", 200)
            assert "Content-Security-Policy" in headers
            assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', body)
            assert assets, "built entry assets are absent"
            for asset in assets:
                request(opener, base, asset, 200)
            request(opener, base, "/patients", 200)
            request(opener, base, "/assets/absent-smoke-file.js", 404)
            result["checks"] += ["html_200", "csp_present", "entry_assets_200", "spa_deep_link_200", "missing_asset_404"]
        docker("kill", "--signal=TERM", container_id)
        exit_code = docker("wait", container_id, timeout=25)
        assert exit_code == "0", f"graceful shutdown exit {exit_code}"
        result["checks"].append("sigterm_exit_0")
        result["status"] = "PASS"
    except Exception as error:
        result["status"] = "FAIL"
        result["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        if container_id:
            info = json.loads(docker("inspect", container_id))[0]
            assert info["Id"] == container_id and info["Config"]["Labels"].get("cvg.hardening.owner") == OWNER
            try:
                (OUT / (kind + "-smoke-container.log")).write_text(docker("logs", container_id))
            finally:
                docker("rm", "--force", container_id)
                result["removed"] = True
        (OUT / "smoke-results.json").write_text(json.dumps(REPORT, indent=2) + "\n")


if __name__ == "__main__":
    manifest = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "final-builds.json"
    for build in json.loads(manifest.read_text())["builds"]:
        smoke(build)
    REPORT["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT / "smoke-results.json").write_text(json.dumps(REPORT, indent=2) + "\n")
    print(json.dumps(REPORT, indent=2))
