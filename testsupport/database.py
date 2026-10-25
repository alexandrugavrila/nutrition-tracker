"""Require deliberate selection of a test database before opening a connection."""

from sqlalchemy.engine import make_url


def validated_test_url(env):
    raw = env.get("TEST_DATABASE_URL")
    if not raw:
        return None
    url = make_url(raw)
    database = url.database or ""
    if (url.get_backend_name() != "postgresql"
            or not database.endswith("_test")
            or env.get("TEST_DATABASE_CONFIRM") != database
            or url.query):
        raise RuntimeError(
            "TEST_DATABASE_URL must select PostgreSQL database ending in _test, "
            "without URL query options; TEST_DATABASE_CONFIRM must match its name."
        )
    return raw
