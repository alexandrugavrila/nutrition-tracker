"""Operator account operations. Caller owns the transaction."""
from sqlalchemy import delete
from sqlmodel import Session, select
from Backend.auth.passwords import hash_password
from Backend.auth.sessions import normalize_email
from Backend.models import AuthSession, User


def find_user(session: Session, *, email=None, user_id=None) -> User:
    query = select(User).where(User.id == user_id) if user_id else select(User).where(User.email == normalize_email(email))
    user = session.exec(query.with_for_update()).one_or_none()
    if user is None:
        raise ValueError("Account not found.")
    return user


def bootstrap_admin(session: Session, *, email: str, display_name: str, password_provider) -> bool:
    email = normalize_email(email)
    if not email or not display_name.strip():
        raise ValueError("Email and display name must not be empty.")
    existing = session.exec(select(User).where(User.email == email).with_for_update()).one_or_none()
    if existing:
        if not existing.is_admin:
            raise ValueError("Email belongs to a non-admin account; bootstrap will not promote it.")
        return False
    password = password_provider()
    if not password or not password.strip():
        raise ValueError("Password must not be empty.")
    session.add(User(email=email, display_name=display_name.strip(), password_hash=hash_password(password), is_admin=True))
    session.flush()
    return True


def maintain_account(session: Session, user: User, action: str, *, password_provider=None):
    if action == "reset-password":
        password = password_provider()
        if not password or not password.strip():
            raise ValueError("Password must not be empty.")
        user.password_hash = hash_password(password)
    elif action in {"activate", "deactivate"}:
        user.is_active = action == "activate"
    else:
        raise ValueError("Unknown account operation.")
    session.add(user)
    session.exec(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.flush()


def create_personal_account(session: Session, *, email: str, display_name: str, password_provider):
    email = normalize_email(email)
    if not email or not display_name.strip():
        raise ValueError("Email and display name must not be empty.")
    if session.exec(select(User).where(User.email == email)).first():
        raise ValueError("Account already exists; no account was changed.")
    password = password_provider()
    if not password or not password.strip():
        raise ValueError("Password must not be empty.")
    user = User(email=email, display_name=display_name.strip(), password_hash=hash_password(password), is_admin=False)
    session.add(user)
    session.flush()
    return user
