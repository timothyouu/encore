"""Keep the established glasses services running without changing ports or tokens."""
from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from typing import IO

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / ".run"
TOKEN = Path("/home/tim/projects/encore-device-verify/.run/device-session-token")
NODE = "/usr/local/bin/node"
PORTS = {"analysis": 8012, "backend": 8799, "proxy": 5198}
STOPPING = False


def stop_requested(_signum: int, _frame: object) -> None:
    global STOPPING
    STOPPING = True


def available(port: int) -> bool:
    with socket.socket() as connection:
        return connection.connect_ex(("127.0.0.1", port)) != 0


def commands() -> dict[str, tuple[list[str], Path, dict[str, str]]]:
    return {
        "analysis": ([str(ROOT / "analysis/.venv/bin/python"), "-m", "uvicorn",
            "analysis.service:app", "--host", "127.0.0.1", "--port", "8012"], ROOT,
            {"ENCORE_ANALYSIS_DEBUG_DIR": str(RUN / "analysis-debug")}),
        "backend": ([NODE, "--import", "tsx", "../scripts/device-runtime.mjs"], ROOT / "server", {
            "ENCORE_DEVICE_PORT": "8799", "ENCORE_DEVICE_ORIGIN": "http://127.0.0.1:51260",
            "ENCORE_DEVICE_TOKEN_FILE": str(TOKEN), "ENCORE_ALLOW_LOOPBACK_CLIENT_ORIGINS": "true",
            "ENCORE_ANALYSIS_URL": "http://127.0.0.1:8012/v1/analyze"}),
        "proxy": ([NODE, "node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
            "--port", "5198", "--strictPort"], ROOT / "g2", {}),
    }


def run() -> None:
    RUN.mkdir(mode=0o700, exist_ok=True)
    os.umask(0o077)
    with (RUN / "device-services.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Encore device supervisor is already running.")
        if not TOKEN.is_file():
            raise SystemExit("Existing token file is missing; no replacement will be generated.")
        if not (ROOT / "g2/dist/index.html").is_file():
            raise SystemExit("Build the glasses package before starting its HTTPS upstream.")
        for name, port in PORTS.items():
            if not available(port):
                raise SystemExit(f"Port {port} ({name}) is occupied; existing process preserved.")
        signal.signal(signal.SIGTERM, stop_requested)
        signal.signal(signal.SIGINT, stop_requested)
        children: dict[str, subprocess.Popen[bytes]] = {}
        logs: dict[str, IO[bytes]] = {}
        starts: dict[str, list[float]] = {name: [] for name in PORTS}
        specs = commands()
        (RUN / "device-services.pid").write_text(str(os.getpid()))
        try:
            while not STOPPING:
                for name, (args, cwd, extra) in specs.items():
                    child = children.get(name)
                    if child is not None and child.poll() is None:
                        continue
                    now = time.monotonic()
                    starts[name] = [started for started in starts[name] if now - started < 60]
                    if len(starts[name]) >= 5:
                        continue  # Bound crash retries; retry once the window expires.
                    if not available(PORTS[name]):
                        continue  # Never replace another process that claimed the port.
                    if name not in logs:
                        logs[name] = (RUN / f"device-managed-{name}.log").open("ab")
                    children[name] = subprocess.Popen(args, cwd=cwd, env={**os.environ, **extra},
                        stdin=subprocess.DEVNULL, stdout=logs[name], stderr=logs[name])
                    starts[name].append(now)
                status = {"supervisorPid": os.getpid(), "updatedAt": time.time(), "services": {
                    name: {"port": PORTS[name], "pid": child.pid, "running": child.poll() is None,
                           "exitCode": child.poll()} for name, child in children.items()}}
                temporary = RUN / "device-services-status.tmp"
                temporary.write_text(json.dumps(status, indent=2) + "\n")
                temporary.replace(RUN / "device-services-status.json")
                time.sleep(1)
        finally:
            for child in children.values():
                if child.poll() is None:
                    child.terminate()
            for child in children.values():
                try:
                    child.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            for log in logs.values():
                log.close()


def start() -> None:
    check = subprocess.run([sys.executable, str(Path(__file__).resolve()), "status"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if check.returncode == 0:
        print("Encore device supervisor is already running on 5198 / 8799 / 8012.")
        return
    RUN.mkdir(mode=0o700, exist_ok=True)
    with (RUN / "device-supervisor.log").open("ab") as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve())], cwd=ROOT,
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    time.sleep(1)
    if child.poll() is not None:
        raise SystemExit("Supervisor did not start; inspect .run/device-supervisor.log. Existing listeners are preserved.")
    print("Started Encore on 5198 / 8799 / 8012. Allow time for model loading, then check /health.")


if __name__ == "__main__":
    if sys.argv[1:] == ["status"]:
        report = json.loads((RUN / "device-services-status.json").read_text())
        pid = report["supervisorPid"]
        command = Path(f"/proc/{pid}/cmdline").read_bytes()
        if str(Path(__file__).resolve()).encode() not in command or time.time() - report["updatedAt"] > 5:
            raise SystemExit("Supervisor is unavailable or its status is stale.")
        print(json.dumps(report, indent=2))
    elif sys.argv[1:] == ["start"]:
        start()
    elif sys.argv[1:]:
        raise SystemExit("Usage: python3 scripts/device-services.py [start|status]")
    else:
        run()
