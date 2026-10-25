"""FastAPI authentication dependencies."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select

from Backend.auth.sessions import get_user_by_session_token
from Backend.db import get_db
from Backend.models import User
from Backend.settings import settings


def _extract_session_token(request: Request) -> str | None:
    return request.cookies.get(settings.session_cookie_name)


def get_optional_current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Return the authenticated user when a valid session cookie is present."""

    token = _extract_session_token(request)
    if not token:
        return None
    return get_user_by_session_token(db, token)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Require an authenticated user."""

    user = get_optional_current_user(request, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    verify_expected_account(request, user)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        # Serialize each account's mutations, including JSON references and deletes.
        # Re-read identity after locking to coordinate with password reset/deactivation.
        user = db.exec(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one()
        if not user.is_active or get_optional_current_user(request, db) is None:
            raise HTTPException(401, "Authentication required.")
    return user


def require_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Require an authenticated admin account."""

    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return current_user


__all__ = ["get_optional_current_user", "get_current_user", "require_admin_user"]


def verify_expected_account(request: Request, user: User) -> None:
    expected = request.headers.get("X-Account-ID")
    if expected is not None and expected != user.id:
        raise HTTPException(
            409, "Account changed. Reload before continuing.", headers={"X-Account-Mismatch": "1"}
        )
