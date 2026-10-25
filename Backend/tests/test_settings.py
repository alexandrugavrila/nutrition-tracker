import importlib

import pytest


def _reload_settings():
    # Reload the module so the singleton picks up environment changes.
    module = importlib.import_module("Backend.settings")
    importlib.reload(module)
    return module.settings


def test_settings_fallbacks_to_sqlite(tmp_path, monkeypatch):
    monkeypatch.delenv("SQLALCHEMY_DATABASE_URI", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DB_AUTO_CREATE", raising=False)

    settings = _reload_settings()
    assert settings.database_url == "sqlite:///./nutrition.db"
    assert settings.db_auto_create is True


def test_settings_respects_provided_database_url(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://nutrition_user:nutrition_pass@db:5432/nutrition"
    )
    monkeypatch.delenv("DB_AUTO_CREATE", raising=False)

    settings = _reload_settings()
    assert settings.database_url.endswith("@db:5432/nutrition")
    assert settings.db_auto_create is False


def test_db_auto_create_can_be_overridden(monkeypatch):
    monkeypatch.delenv("SQLALCHEMY_DATABASE_URI", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_AUTO_CREATE", "false")

    settings = _reload_settings()
    assert settings.database_url == "sqlite:///./nutrition.db"
    assert settings.db_auto_create is False


def test_production_allows_missing_usda_api_key(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://nutrition_user:secret@db:5432/nutrition"
    )
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SESSION_SECURE_COOKIE", raising=False)
    monkeypatch.delenv("USDA_API_KEY", raising=False)

    assert _reload_settings().usda_api_key is None


def test_production_requires_database_password(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://nutrition_user@db:5432/nutrition")
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("SESSION_SECURE_COOKIE", raising=False)
    monkeypatch.setenv("USDA_API_KEY", "set")

    with pytest.raises(RuntimeError, match="DATABASE_URL must include a database password"):
        _reload_settings()


def test_production_rejects_insecure_cookie_override(monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'postgresql://test:test@db:5432/test')
    monkeypatch.setenv('ENVIRONMENT', 'production')
    monkeypatch.setenv('SESSION_SECURE_COOKIE', 'false')
    with pytest.raises(RuntimeError, match='secure session cookies'):
        _reload_settings()
