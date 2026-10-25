"""Server-side session helpers."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlmodel import Session, delete, select

from Backend.models import AuthSession, User


def utc_now() -> datetime:
    """Return the current UTC timestamp."""

    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime) -> datetime:
    """Normalize naive datetimes from SQLite to UTC-aware values."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def normalize_email(email: str) -> str:
    """Normalize email addresses for consistent lookup and uniqueness."""

    return email.strip().lower()


def generate_session_token() -> str:
    """Generate a random session token suitable for cookie transport."""

    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """Hash a raw session token before persisting it."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_auth_session(
    db: Session,
    user: User,
    *,
    ttl_days: int,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[AuthSession, str]:
    """Create and persist a new server-side session."""

    raw_token = generate_session_token()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        expires_at=utc_now() + timedelta(days=ttl_days),
        last_seen_at=utc_now(),
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(auth_session)
    db.flush()
    return auth_session, raw_token


def get_session_by_token(db: Session, token: str) -> Optional[AuthSession]:
    """Return the active session for a raw token when one exists."""

    statement = select(AuthSession).where(AuthSession.token_hash == hash_session_token(token))
    auth_session = db.exec(statement).one_or_none()
    if auth_session is None:
        return None
    if _coerce_utc(auth_session.expires_at) <= utc_now():
        db.delete(auth_session)
        db.commit()
        return None
    return auth_session


def get_user_by_session_token(db: Session, token: str) -> Optional[User]:
    """Resolve the authenticated user for a raw session token."""

    auth_session = get_session_by_token(db, token)
    if auth_session is None:
        return None
    user = db.get(User, auth_session.user_id)
    if user is None or not user.is_active:
        return None
    return user


def revoke_session(db: Session, token: str) -> None:
    """Delete the session associated with a raw token."""

    auth_session = get_session_by_token(db, token)
    if auth_session is None:
        return
    db.delete(auth_session)
    db.commit()


def revoke_all_user_sessions(db: Session, user_id: str, *, commit: bool = True) -> None:
    """Delete all sessions for a user."""

    db.exec(delete(AuthSession).where(AuthSession.user_id == user_id))
    if commit:
        db.commit()


__all__ = [
    "create_auth_session",
    "generate_session_token",
    "get_session_by_token",
    "get_user_by_session_token",
    "hash_session_token",
    "normalize_email",
    "revoke_all_user_sessions",
    "revoke_session",
    "utc_now",
]
