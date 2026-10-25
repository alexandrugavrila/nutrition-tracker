"""Private HTTP opt-in checks without application database fixtures."""
import os
import subprocess
import sys

import pytest


@pytest.mark.parametrize('secure,opt_in,origin,expected', [
    ('true', 'false', 'https://nutrition.internal', 0),
    ('false', 'false', 'http://nutrition.internal', 1),
    ('false', 'true', 'http://nutrition.internal', 0),
    ('false', 'true', '*', 1),
    ('false', 'true', 'https://nutrition.internal', 1),
    ('false', 'true', 'http://', 1),
])
def test_production_transport_policy(secure, opt_in, origin, expected):
    env = {**os.environ, 'ENVIRONMENT': 'production',
           'DATABASE_URL': 'postgresql://synthetic:synthetic@invalid/test',
           'SQLALCHEMY_DATABASE_URI': '', 'DB_AUTO_CREATE': 'false',
           'SESSION_SECURE_COOKIE': secure, 'ALLOW_INSECURE_HTTP': opt_in,
           'CORS_ALLOW_ORIGINS': origin}
    result = subprocess.run([sys.executable, '-c',
        'from Backend.settings import settings; '
        'assert settings.db_auto_create is False; '
        f'assert settings.session_secure_cookie is {secure == "true"}'],
        env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == expected, result.stderr
