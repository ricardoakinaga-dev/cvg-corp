import os, signal, subprocess, sys, time, tempfile
src = open(sys.argv[1]).read()
helpers = src[src.index("# Watchdog:"):src.index("\nonly = set(")]
ns = {"os": os, "time": time, "signal": signal, "subprocess": subprocess, "ROOT": tempfile.gettempdir()}
exec(helpers, ns)
tmp = tempfile.mkdtemp(dir=os.path.dirname(os.path.abspath(sys.argv[1])))
# 1) stall: a detached child in its own session and an orphan reparented to init
log = os.path.join(tmp, "stall.log")
rc, fired, survivors = ns["run_with_watchdog"](["bash", "-c", "setsid sleep 997 & (sleep 998 &); echo started; sleep 999"], dict(os.environ), log, 3, 60)
time.sleep(1)
left = subprocess.run(["pgrep", "-f", "^sleep 99[789]$"], capture_output=True, text=True).stdout.split()
print("stall:", "rc", rc, "fired", fired and fired["reason"], "survivors", survivors, "left", left)
assert fired and fired["reason"] == "STALLED" and not survivors and not left
# 2) hard limit while output keeps growing
rc, fired, survivors = ns["run_with_watchdog"](["bash", "-c", "while true; do echo tick; sleep 1; done"], dict(os.environ), os.path.join(tmp, "limit.log"), 30, 4)
print("limit:", "rc", rc, "fired", fired and fired["reason"], "survivors", survivors)
assert fired and fired["reason"] == "TIMEOUT" and not survivors
# 3) normal completion keeps the exit status and does not fire
rc, fired, survivors = ns["run_with_watchdog"](["bash", "-c", "echo ok; exit 3"], dict(os.environ), os.path.join(tmp, "ok.log"), 30, 60)
print("normal:", "rc", rc, "fired", fired, "survivors", survivors)
assert rc == 3 and fired is None and not survivors
print("WATCHDOG_SELFTEST PASS")
