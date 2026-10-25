import pytest
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.auth.passwords import hash_password
from Backend.auth.sessions import hash_session_token, utc_now
from Backend.models import AuthSession, User
from Backend.settings import settings


def _create_user(
    session: Session,
    *,
    email: str = "user@example.com",
    password: str = "Password123!",
    display_name: str = "Test User",
    is_admin: bool = False,
) -> User:
    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name,
        is_admin=is_admin,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_login_returns_200_and_sets_cookie(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session)

    response = anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "Password123!"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == "user@example.com"
    assert settings.session_cookie_name in response.cookies


def test_login_rejects_unknown_email(anonymous_client: TestClient) -> None:
    response = anonymous_client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "Password123!"},
    )
    assert response.status_code == 401


def test_login_rejects_bad_password(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session)

    response = anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "wrong"},
    )
    assert response.status_code == 401


def test_me_requires_session(anonymous_client: TestClient) -> None:
    response = anonymous_client.get("/api/auth/me")
    assert response.status_code == 401


def test_me_returns_current_user_when_authenticated(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session)

    login_response = anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "Password123!"},
    )
    assert login_response.status_code == 200

    response = anonymous_client.get("/api/auth/me")
    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is True
    assert body["user"]["display_name"] == "Test User"


def test_logout_clears_session(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session)

    login_response = anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "Password123!"},
    )
    token = login_response.cookies.get(settings.session_cookie_name)
    assert token is not None

    response = anonymous_client.post("/api/auth/logout")
    assert response.status_code == 204
    assert anonymous_client.cookies.get(settings.session_cookie_name) is None

    with Session(engine) as session:
        auth_session = session.exec(
            select(AuthSession).where(AuthSession.token_hash == hash_session_token(token))
        ).one_or_none()
        assert auth_session is None


def test_expired_session_rejected(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        user = _create_user(session)
        expired = AuthSession(
            user_id=user.id,
            token_hash=hash_session_token("expired-token"),
            expires_at=utc_now() - timedelta(days=1),
        )
        session.add(expired)
        session.commit()

    anonymous_client.cookies.set(settings.session_cookie_name, "expired-token")
    response = anonymous_client.get("/api/auth/me")
    assert response.status_code == 401


def test_change_password_rejects_wrong_current_password(
    anonymous_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        _create_user(session)

    anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "Password123!"},
    )
    response = anonymous_client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "NewPassword123!"},
    )
    assert response.status_code == 400


def test_change_password_accepts_correct_current_password(
    anonymous_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        _create_user(session)

    anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "Password123!"},
    )
    response = anonymous_client.post(
        "/api/auth/change-password",
        json={
            "current_password": "Password123!",
            "new_password": "NewPassword123!",
        },
    )
    assert response.status_code == 204

    relogin = anonymous_client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "NewPassword123!"},
    )
    assert relogin.status_code == 200


def test_admin_can_create_user(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session, email="admin@example.com", is_admin=True)

    anonymous_client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "Password123!"},
    )
    response = anonymous_client.post(
        "/api/auth/users",
        json={
            "email": "new@example.com",
            "password": "Password123!",
            "display_name": "New User",
            "is_admin": False,
        },
    )
    assert response.status_code == 201
    assert response.json()["email"] == "new@example.com"


def test_non_admin_cannot_create_user(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        _create_user(session, email="user2@example.com")

    anonymous_client.post(
        "/api/auth/login",
        json={"email": "user2@example.com", "password": "Password123!"},
    )
    response = anonymous_client.post(
        "/api/auth/users",
        json={
            "email": "new@example.com",
            "password": "Password123!",
            "display_name": "New User",
            "is_admin": False,
        },
    )
    assert response.status_code == 403


@pytest.mark.parametrize("password", ["", "x" * 1025])
def test_create_user_rejects_unusable_password(admin_client, engine, password):
    response = admin_client.post("/api/auth/users", json={
        "email": "invalid-password@example.com", "password": password,
        "display_name": "Invalid password",
    })
    assert response.status_code == 422
    with Session(engine) as session:
        assert session.exec(select(User).where(User.email == "invalid-password@example.com")).first() is None


@pytest.mark.parametrize("password", ["", "x" * 1025])
def test_invalid_password_change_preserves_credentials_and_session(user_a_client, password):
    response = user_a_client.post("/api/auth/change-password", json={
        "current_password": "Password123!", "new_password": password,
    })
    assert response.status_code == 422
    assert user_a_client.get("/api/auth/me").status_code == 200
    assert user_a_client.post("/api/auth/login", json={
        "email": "user-a@example.com", "password": "Password123!",
    }).status_code == 200
