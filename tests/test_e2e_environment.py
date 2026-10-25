"""Required E2E must not report success when its environment is missing."""
import os
from pathlib import Path
import subprocess
import sys


def test_required_api_e2e_rejects_missing_port():
    env = {**os.environ, "E2E_REQUIRED": "1"}
    env.pop("DEV_BACKEND_PORT", None)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "Backend/tests/test_e2e_api.py"],
        cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True,
        text=True, timeout=30,
    )
    assert result.returncode != 0
    assert "DEV_BACKEND_PORT is required" in result.stdout
