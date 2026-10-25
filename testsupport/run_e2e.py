"""Cross-platform disposable PostgreSQL, API and browser validation runner."""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(url, process):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Service exited before readiness: {url}")
        try:
            if httpx.get(url, timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    raise RuntimeError(f"Service readiness timed out: {url}")


def main():
    # Preserve failure diagnostics on Windows consoles with a legacy encoding.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    project = "nutrition-e2e-" + uuid4().hex[:12]
    compose = ["docker", "compose", "-p", project, "-f",
               str(ROOT / "testsupport/docker-compose.e2e.yml")]
    env = dict(os.environ)
    for key in ("SQLALCHEMY_DATABASE_URI", "PGOPTIONS", "COMPOSE_FILE", "COMPOSE_PROFILES"):
        env.pop(key, None)
    processes = []
    from testsupport.usda_stub import start_provider
    provider = start_provider()
    with tempfile.TemporaryDirectory(prefix="nutrition-e2e-") as logs:
        handles = []
        try:
            subprocess.run(compose + ["up", "-d", "--wait"], cwd=ROOT, env=env, check=True)
            address = subprocess.check_output(compose + ["port", "db", "5432"], env=env, text=True).strip()
            db_port = address.rsplit(":", 1)[1]
            api_port, ui_port = free_port(), free_port()
            url = f"postgresql://nutrition_test:disposable-test-only@127.0.0.1:{db_port}/nutrition_test"
            env.update(DATABASE_URL=url, TEST_DATABASE_URL=url,
                       TEST_DATABASE_CONFIRM="nutrition_test", DB_AUTO_CREATE="false",
                       CORS_ALLOW_ORIGINS=f"http://127.0.0.1:{ui_port},http://127.0.0.1:{api_port}",
                       ENVIRONMENT="test", SESSION_SECURE_COOKIE="false", USDA_API_KEY="e2e-placeholder",
                       E2E_USDA_BASE_URL=f"http://127.0.0.1:{provider.server_port}",
                       E2E_REQUIRED="1", E2E_EMAIL="a@e2e.example", E2E_OTHER_EMAIL="b@e2e.example",
                       E2E_PASSWORD=uuid4().hex, DEV_BACKEND_PORT=str(api_port),
                       DEV_FRONTEND_PORT=str(ui_port), BACKEND_URL=f"http://127.0.0.1:{api_port}",
                       PLAYWRIGHT_BASE_URL=f"http://127.0.0.1:{ui_port}")
            def run(args):
                subprocess.run(args, cwd=ROOT, env=env, check=True)
            # Also run the role/unit suite on a separate migration-created schema.
            run([sys.executable, "-m", "pytest", "-xq", "-m", "not e2e"])
            run([sys.executable, "-m", "alembic", "-c", "Backend/alembic.ini", "upgrade", "head"])
            run([sys.executable, "-m", "testsupport.seed_accounts"])
            for name, command in [
                ("backend", [sys.executable, "-m", "uvicorn", "testsupport.e2e_app:app", "--host", "127.0.0.1", "--port", str(api_port)]),
                ("frontend", [shutil.which("node"), "Frontend/node_modules/vite/bin/vite.js", "Frontend", "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"]),
            ]:
                handle = open(Path(logs) / f"{name}.log", "w", encoding="utf-8")
                handles.append(handle)
                processes.append(subprocess.Popen(command, cwd=ROOT, env=env, stdout=handle,
                    stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
            wait_ready(f"http://127.0.0.1:{api_port}/api/health/ready", processes[0])
            wait_ready(env["PLAYWRIGHT_BASE_URL"], processes[1])
            run([sys.executable, "-m", "pytest", "-q", "-m", "e2e", "Backend/tests/test_e2e_api.py", *sys.argv[1:]])
            subprocess.run([shutil.which("node"), "node_modules/@playwright/test/cli.js", "test"],
                           cwd=ROOT / "Frontend", env=env, check=True)
        except Exception:
            for handle in handles:
                handle.flush()
            for path in Path(logs).glob("*.log"):
                print(f"\n{path.name}:\n{path.read_text(encoding='utf-8')[-12000:]}")
            raise
        finally:
            provider.shutdown()
            provider.server_close()
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            for handle in handles:
                handle.close()
            subprocess.run(compose + ["down", "--volumes", "--remove-orphans"], cwd=ROOT, env=env, check=True)


if __name__ == "__main__":
    main()
