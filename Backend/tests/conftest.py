import os
import sys
from typing import Iterator

import pytest
import python_multipart
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

os.environ["DATABASE_URL"] = "sqlite://"
os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
os.environ["DB_AUTO_CREATE"] = "false"
os.environ["ENVIRONMENT"] = "test"

from Backend import models  # noqa: F401  ensure models imported for metadata
from Backend.auth.passwords import hash_password
from Backend.backend import app
from Backend.db import get_db
from Backend.models import User

# Ensure tests load python_multipart instead of the deprecated multipart alias.
sys.modules["multipart"] = python_multipart


@pytest.fixture(scope="session")
def postgres_engine():
    """Migrate only a unique schema on an explicitly opted-in test database."""
    import subprocess
    from uuid import uuid4
    from sqlalchemy import text
    from testsupport.database import validated_test_url

    url = validated_test_url(os.environ)
    if url is None:
        yield None
        return
    schema = "test_" + uuid4().hex
    control = create_engine(url)
    owned = False
    try:
        with control.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        owned = True
        env = {**os.environ, "DATABASE_URL": url, "SQLALCHEMY_DATABASE_URI": url,
               "PGOPTIONS": f"-c search_path={schema}", "DB_AUTO_CREATE": "false"}
        subprocess.run([sys.executable, "-m", "alembic", "-c", "Backend/alembic.ini",
                        "upgrade", "head"], check=True, env=env)
        migrated = create_engine(url, connect_args={"options": f"-c search_path={schema}"})
        try:
            yield migrated
        finally:
            migrated.dispose()
    finally:
        if owned:
            with control.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        control.dispose()


@pytest.fixture(name="engine")
def engine_fixture(postgres_engine) -> Iterator:
    from sqlalchemy import inspect, text
    if postgres_engine is not None:
        engine = postgres_engine
        tables = [name for name in inspect(engine).get_table_names() if name != "alembic_version"]
        statement = "TRUNCATE " + ", ".join(engine.dialect.identifier_preparer.quote(t) for t in tables) + " RESTART IDENTITY CASCADE"
        with engine.begin() as connection:
            connection.execute(text(statement))
        yield engine
        return
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(name="anonymous_client")
def client_fixture(engine) -> Iterator[TestClient]:
    def override_get_db() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, headers={"Origin":"http://testserver"}) as client:
        yield client
    app.dependency_overrides.clear()




@pytest.fixture
def account_client(engine):
    """Independent cookie jars; callers must name the role they need."""
    clients = []
    def make(user_id, is_admin=False):
        with Session(engine) as session:
            session.add(User(id=user_id, email=f"{user_id}@example.com",
                             password_hash=hash_password("Password123!"),
                             display_name=user_id, is_admin=is_admin))
            session.commit()
        def override_get_db():
            with Session(engine) as session:
                yield session
        app.dependency_overrides[get_db] = override_get_db
        client = TestClient(app, headers={"Origin":"http://testserver"})
        clients.append(client)
        response = client.post("/api/auth/login", json={"email": f"{user_id}@example.com", "password": "Password123!"})
        assert response.status_code == 200
        return client
    yield make
    for client in clients:
        client.close()
    app.dependency_overrides.clear()


@pytest.fixture
def admin_client(account_client):
    return account_client("test-user", is_admin=True)


@pytest.fixture
def user_a_client(account_client):
    return account_client("user-a")


@pytest.fixture
def user_b_client(account_client):
    return account_client("user-b")
