#!/usr/bin/env python
"""Ensure Alembic migrations reflect models and produce an up-to-date DB.

Exit codes:
    0 = Up to date (already clean, or adopted migration and verified clean)
    1 = Script error (infra/tooling failure)
    2 = Unexpected continued drift after adoption (investigate)
"""
from __future__ import annotations

import datetime as _dt
import os
import re
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

from alembic import command
from alembic.config import Config


# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
def _log(msg: str) -> None:
    print(msg)


def _warn(msg: str) -> None:
    print(f"\033[33m{msg}\033[0m", file=sys.stderr)


def _ok(msg: str) -> None:
    print(f"\033[32m{msg}\033[0m")


def _err(msg: str) -> None:
    print(f"\033[31m{msg}\033[0m", file=sys.stderr)


# ---------------------------------------------------------------------------
# Paths and configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
# The repo root is two levels up from this script (scripts/db/.. -> scripts/.. -> repo root)
REPO_ROOT = SCRIPT_DIR.parent.parent
os.chdir(REPO_ROOT)

ALEMBIC_INI = REPO_ROOT / "Backend" / "alembic.ini"
MIGRATIONS_DIR = REPO_ROOT / "Backend" / "migrations"
MIGRATION_ROOT = MIGRATIONS_DIR / "versions"
if not MIGRATION_ROOT.is_dir():
    _err(f"Alembic versions directory not found: {MIGRATION_ROOT}")
    sys.exit(1)

CONFIG = Config(str(ALEMBIC_INI)) if ALEMBIC_INI.exists() else Config()
# Ensure Alembic resolves script_location to Backend/migrations regardless of CWD
try:
    CONFIG.set_main_option("script_location", str(MIGRATIONS_DIR))
except Exception:
    # Config without an ini still supports overriding options; ignore if not available
    pass


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------
def _get_free_tcp_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def _new_rev_id() -> str:
    return uuid.uuid4().hex[:12]


def _timestamp_slug() -> str:
    return _dt.datetime.now().strftime("%Y%m%d_%H%M%S")


def _run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, check=check, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


# ---------------------------------------------------------------------------
# Environment prep
# ---------------------------------------------------------------------------
# We always run the temporary Postgres locally and connect via localhost.
# If DATABASE_URL is provided, we borrow credentials and db name from it,
# but we override host/port to localhost:<chosen_port> to avoid collisions
# with branch stacks or other services.

CONTAINER_NAME = f"nutrition-drift-{uuid.uuid4().hex}"

DB_NAME = "nutrition"
DB_USER = "nutrition_user"
DB_PASS = "nutrition_pass"

_env_db_url = os.environ.get("DATABASE_URL")
if _env_db_url:
    try:
        from urllib.parse import urlparse

        _parsed = urlparse(_env_db_url)
        if _parsed.path and _parsed.path != "/":
            # strip leading '/'
            DB_NAME = _parsed.path[1:] or DB_NAME
        if _parsed.username:
            DB_USER = _parsed.username
        if _parsed.password:
            DB_PASS = _parsed.password
    except Exception:  # pragma: no cover - extremely unlikely
        pass

# If caller provided TEST_DB_PORT, we use it. Otherwise, if DEV_DB_PORT is set
# and explicitly intended for testing, it will be honored; if neither is set,
# we ask Docker to assign a random host port to eliminate bind conflicts.
_requested_db_port = os.environ.get("TEST_DB_PORT") or os.environ.get("DEV_DB_PORT")
_db_port: Optional[str] = _requested_db_port if _requested_db_port else None


# ---------------------------------------------------------------------------
# Pre-run cleanup
# ---------------------------------------------------------------------------
_DRIFT_GLOB = "*_driftchecktmp*.py"
for _tmp in MIGRATION_ROOT.glob(_DRIFT_GLOB):
    try:
        _tmp.unlink()
    except OSError:
        pass


def _clear_temp_drift_files() -> None:
    for _tmp in MIGRATION_ROOT.glob(_DRIFT_GLOB):
        try:
            _tmp.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Alembic helpers
# ---------------------------------------------------------------------------
def _invoke_upgrade_head() -> None:
    command.upgrade(CONFIG, "head")


def _new_temp_revision(message: str) -> Path:
    rev_id = _new_rev_id()
    command.revision(CONFIG, message=message, autogenerate=True, rev_id=rev_id)
    path = next(MIGRATION_ROOT.glob(f"{rev_id}*.py"), None)
    if path is None:
        raise RuntimeError(f"No revision file generated for rev-id {rev_id}")
    return path


def _revision_has_ops(path: Path) -> bool:
    text = path.read_text()
    has_rev = re.search(r"(?m)^\s*revision\s*=\s*['\"]\w+['\"]", text)
    if not has_rev:
        raise RuntimeError(f"Generated file malformed (no 'revision ='): {path}")
    return bool(re.search(r"(?m)^\s*op\.\w+\(", text))


def _convert_drift_file_to_migration(path: Path) -> Path:
    slug = f"sync_models_{_timestamp_slug()}"
    m = re.match(r"([0-9a-fA-F]+)_", path.name)
    if not m:
        raise RuntimeError(f"Could not parse revision id from filename: {path.name}")
    rev = m.group(1)
    new_name = f"{rev}_{slug}.py"
    text = path.read_text()
    text = re.sub(r"(?m)^\"\"\".*", f'"""{slug}', text, count=1)
    path.write_text(text)
    new_path = path.with_name(new_name)
    path.rename(new_path)
    return new_path


# ---------------------------------------------------------------------------
# DB container management
# ---------------------------------------------------------------------------
_db_started = False


def _start_temp_db() -> None:
    global _db_started
    # Build docker run args. If no DEV_DB_PORT was requested, publish to a random
    # localhost port and discover it via `docker port`.
    if _db_port:
        port_arg = ["-p", f"{_db_port}:5432"]
        _log(
            f"Starting temporary database container {CONTAINER_NAME} on port {_db_port}..."
        )
    else:
        port_arg = ["-p", "127.0.0.1::5432"]
        _log(
            f"Starting temporary database container {CONTAINER_NAME} with random host port..."
        )
    try:
        _run("docker", "pull", "postgres:13")
        run_cmd = (
            [
                "docker",
                "run",
                "-d",
                "--name",
                CONTAINER_NAME,
                "-e",
                f"POSTGRES_USER={DB_USER}",
                "-e",
                f"POSTGRES_PASSWORD={DB_PASS}",
                "-e",
                f"POSTGRES_DB={DB_NAME}",
            ]
            + port_arg
            + [
                "postgres:13",
            ]
        )
        # Capture output for clearer diagnostics on failure
        subprocess.run(run_cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:  # pragma: no cover - external failure
        details = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(f"failed to start database container: {details}") from exc
    _db_started = True

    # If the host port was random, discover it and update env for downstream tools.
    if not _db_port:
        try:
            cp = subprocess.run(
                ["docker", "port", CONTAINER_NAME, "5432/tcp"],
                check=True,
                capture_output=True,
                text=True,
            )
            # Example outputs:
            #   0.0.0.0:49172
            #   127.0.0.1:55012
            #   ::1:55012
            port_line = cp.stdout.strip().splitlines()[0]
            m = re.search(r":(\d+)$", port_line)
            if not m:
                raise RuntimeError(f"could not parse docker port output: {port_line}")
            host_port = m.group(1)
            # Persist env for subsequent Alembic commands
            _set_database_url_with_port(host_port)
        except Exception as exc:  # pragma: no cover
            raise RuntimeError("failed to discover mapped host port") from exc
    else:
        # Ensure env reflects the requested port
        _set_database_url_with_port(_db_port)

    _log("Waiting for sustained database readiness (timeout 2 minutes)...")
    deadline = time.time() + 120
    consecutive_query_successes = 0
    last_connection_error: Optional[Exception] = None
    while time.time() < deadline:
        result = subprocess.run(
            [
                "docker",
                "exec",
                CONTAINER_NAME,
                "pg_isready",
                "-U",
                DB_USER,
                "-d",
                "nutrition",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            try:
                import psycopg2

                connection = psycopg2.connect(
                    os.environ["DATABASE_URL"], connect_timeout=2
                )
                try:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT 1")
                        cursor.fetchone()
                finally:
                    connection.close()
                consecutive_query_successes += 1
                # The official Postgres image briefly accepts connections from a
                # bootstrap server before stopping it and starting the final
                # server. Requiring two successful SQL probes one second apart
                # prevents callers from racing into that intentional restart.
                if consecutive_query_successes >= 2:
                    return
            except Exception as exc:
                last_connection_error = exc
                consecutive_query_successes = 0
        else:
            consecutive_query_successes = 0
        time.sleep(1)
    detail = f": {last_connection_error}" if last_connection_error else ""
    raise RuntimeError(f"Postgres did not become sustainably ready in 2 minutes{detail}")


def _cleanup(
    temp_first: Optional[Path], temp_verify: Optional[Path], adoption_done: bool
) -> None:
    # Always attempt cleanup if a container exists under our name (even if startup failed)
    _log(f"Removing temporary database container {CONTAINER_NAME}...")
    subprocess.run(
        ["docker", "rm", "-f", CONTAINER_NAME],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if temp_first and not adoption_done:
        try:
            temp_first.unlink()
        except OSError:
            pass
    if temp_verify:
        try:
            temp_verify.unlink()
        except OSError:
            pass


_clear_temp_drift_files()


# ---------------------------------------------------------------------------
# Connection URL management
# ---------------------------------------------------------------------------
def _set_database_url_with_port(port: str) -> None:
    """Build and set DATABASE_URL pointing at localhost:<port> with our creds/db.

    This intentionally overrides any host/port in incoming env to avoid
    accidental connections to branch stacks or external DBs.
    """
    url = f"postgresql://{DB_USER}:{DB_PASS}@localhost:{port}/{DB_NAME}"
    os.environ["DATABASE_URL"] = url
    # Keep both DEV_DB_PORT and TEST_DB_PORT in this process for downstream tools
    os.environ["DEV_DB_PORT"] = str(port)
    os.environ["TEST_DB_PORT"] = str(port)


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------
fatal_error: Optional[Exception] = None
first_generated: Optional[Path] = None
adopted_path: Optional[Path] = None
verify_generated: Optional[Path] = None
adoption_performed = False
verify_had_ops = False
first_had_ops = False

try:
    _start_temp_db()
    _invoke_upgrade_head()
    first_generated = _new_temp_revision("driftchecktmp")
    first_had_ops = _revision_has_ops(first_generated)
    if first_had_ops:
        _warn("Drift detected, adopting migration...")
        adopted_path = _convert_drift_file_to_migration(first_generated)
        adoption_performed = True
        _invoke_upgrade_head()
        verify_generated = _new_temp_revision("driftchecktmp_verify")
        verify_had_ops = _revision_has_ops(verify_generated)
        if not verify_had_ops:
            try:
                verify_generated.unlink()
            except OSError:
                pass
            verify_generated = None
    else:
        try:
            first_generated.unlink()
        except OSError:
            pass
        first_generated = None
except Exception as exc:  # pragma: no cover - high-level error handling
    fatal_error = exc
finally:
    _cleanup(first_generated, verify_generated, adoption_performed)

# ---------------------------------------------------------------------------
# Summary & exit codes
# ---------------------------------------------------------------------------
if fatal_error:
    _err(f"Script failed: {fatal_error}")
    _err("[RESULT] Script error")
    sys.exit(1)

if adoption_performed:
    if verify_had_ops:
        _warn(
            f"Adopted {adopted_path}, but a verification autogenerate still found differences."
        )
        _warn(
            "Investigate your models/env.py autogenerate settings. A noisy config can cause perpetual diffs."
        )
        _warn("[RESULT] Continued drift after adoption")
        sys.exit(2)
    _ok(f"Adopted migration: {adopted_path}")
    _ok("Verification clean: migrations now reproduce the model schema.")
    _ok("[RESULT] Up to date (after adoption)")
    sys.exit(0)

_ok("No migration drift detected.")
_ok("[RESULT] Up to date (no drift)")
sys.exit(0)
