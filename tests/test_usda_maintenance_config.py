"""Database-free production configuration checks, outside Backend's DB fixtures."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_ENV = {
    "BACKEND_IMAGE": "nutrition-backend:config-test",
    "FRONTEND_IMAGE": "nutrition-frontend:config-test",
    "POSTGRES_USER": "config_test",
    "POSTGRES_PASSWORD": "synthetic-only",
    "POSTGRES_DB": "config_test",
    "DATABASE_URL": "sqlite://",
    "SQLALCHEMY_DATABASE_URI": "sqlite://",
    "CORS_ALLOW_ORIGINS": "http://localhost",
    "ENVIRONMENT": "test",
    "DB_AUTO_CREATE": "false",
}


def isolated_env():
    # Retain OS runtime lookup, but never inherit application or Compose settings.
    keep = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE",
            "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
            "PROGRAMFILES", "PROGRAMFILES(X86)", "DOCKER_CONFIG"}
    return {**{k: v for k, v in os.environ.items() if k.upper() in keep},
            **SYNTHETIC_ENV}


def compose_config(tmp_path, source=None, maintenance=False, overrides=None):
    shutil.copyfile(ROOT / "docker-compose.prod.yml", tmp_path / "compose.yml")
    (tmp_path / ".env.production").write_text("", encoding="utf-8")
    env = isolated_env()
    env.update(overrides or {})
    if source is not None:
        env["USDA_FOUNDATION_FOODS_JSON"] = source
    command = ["docker", "compose", "--project-name", "nutrition-config-test",
               "--env-file", str(tmp_path / ".env.production"),
               "-f", str(tmp_path / "compose.yml")]
    if maintenance:
        command += ["--profile", "maintenance"]
    result = subprocess.run(command + ["config", "--format", "json"],
                            cwd=tmp_path, env=env, capture_output=True, text=True,
                            timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_default_services_do_not_require_foundation_input(tmp_path):
    config = compose_config(tmp_path)
    assert config["services"]["edge"]["ports"][0]["host_ip"] == "127.0.0.1"
    assert set(config["services"]) == {"db", "backend", "frontend", "edge"}
    assert config["services"]["backend"]["environment"]["USDA_API_KEY"] == ""


@pytest.mark.parametrize("source", [None, "", "/input/Foundation Foods.json",
                                     "https://example.invalid/foundation.zip?version=1"])
def test_maintenance_profile_preserves_optional_input(tmp_path, source):
    config = compose_config(tmp_path, source, maintenance=True)
    service = config["services"]["usda-sync"]
    assert service["profiles"] == ["maintenance"]
    assert service["environment"]["USDA_FOUNDATION_FOODS_JSON"] == (source or "")
    assert service["command"] == ["python", "-m",
                                  "Backend.commands.sync_usda_foundation"]


@pytest.mark.parametrize("source", [None, ""])
def test_missing_input_exits_before_any_io(tmp_path, source):
    env = isolated_env()
    env["PYTHONPATH"] = str(ROOT)
    if source is not None:
        env["USDA_FOUNDATION_FOODS_JSON"] = source
    # A separate process avoids importing application settings into other tests.
    # Guard DB/network access even during module import; then guard all ingestion.
    code = '''
import sys
from unittest.mock import patch
from sqlalchemy.engine import Engine
with patch.object(Engine, "connect", side_effect=AssertionError("Database access")), \\
     patch("socket.socket.connect", side_effect=AssertionError("Network access")):
    from Backend.commands import sync_usda_foundation as command
    with patch.object(command, "Session", side_effect=AssertionError("Session opened")), \\
         patch.object(command, "_load_payload", side_effect=AssertionError("Input loaded")), \\
         patch.object(command, "sync_usda_foundation", side_effect=AssertionError("Sync ran")):
        sys.argv = ["sync_usda_foundation", "--mark-stale"]
        command.main()
'''
    result = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 1
    assert "Provide --input or USDA_FOUNDATION_FOODS_JSON" in result.stderr
    assert "Traceback" not in result.stderr
    assert not (tmp_path / "nutrition.db").exists()


def test_private_http_settings_reach_production_backend(tmp_path):
    config = compose_config(tmp_path, overrides={
        "ENVIRONMENT": "production", "SESSION_SECURE_COOKIE": "false",
        "ALLOW_INSECURE_HTTP": "true", "CORS_ALLOW_ORIGINS": "http://nutrition.internal",
        "PROD_HTTP_BIND_ADDRESS": "192.168.1.24", "PROD_HTTP_PORT": "80",
    })
    backend = config["services"]["backend"]["environment"]
    assert backend["ENVIRONMENT"] == "production"
    assert backend["SESSION_SECURE_COOKIE"] == "false"
    assert backend["ALLOW_INSECURE_HTTP"] == "true"
    assert backend["CORS_ALLOW_ORIGINS"] == "http://nutrition.internal"
    assert config["services"]["edge"]["ports"][0]["host_ip"] == "192.168.1.24"
