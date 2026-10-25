"""Authentication routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from Backend.auth.dependencies import (
    get_current_user,
    require_admin_user,
    get_optional_current_user,
    verify_expected_account,
)
from Backend.auth.passwords import hash_password, verify_password
from Backend.auth.sessions import (
    create_auth_session,
    normalize_email,
    revoke_all_user_sessions,
    revoke_session,
    utc_now,
)
from Backend.db import get_db
from Backend.models import (
    AuthStatus,
    ChangePasswordRequest,
    LoginRequest,
    User,
    UserCreate,
    UserRead,
)
from Backend.settings import settings

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY_PASSWORD_HASH = hash_password("not-an-account-password")


def _set_session_cookie(response: Response, token: str) -> None:
    max_age = settings.session_ttl_days * 24 * 60 * 60
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.session_secure_cookie,
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.session_secure_cookie,
        samesite="lax",
        path="/",
    )


def _get_request_metadata(request: Request) -> tuple[str | None, str | None]:
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return ip_address, user_agent


@router.post("/login", response_model=AuthStatus)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthStatus:
    """Authenticate a user and issue a session cookie."""

    email = normalize_email(payload.email)
    from Backend.auth.security import login_budget

    login_budget(db, email, request.client.host if request.client else "unknown")
    statement = select(User).where(User.email == email).with_for_update()
    user = db.exec(statement).one_or_none()
    valid_password = verify_password(
        payload.password, user.password_hash if user else _DUMMY_PASSWORD_HASH
    )
    if user is None or not user.is_active or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    ip_address, user_agent = _get_request_metadata(request)
    _, raw_token = create_auth_session(
        db,
        user,
        ttl_days=settings.session_ttl_days,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    user.last_login_at = utc_now()
    db.add(user)
    db.commit()
    db.refresh(user)
    _set_session_cookie(response, raw_token)
    return AuthStatus(authenticated=True, user=UserRead.model_validate(user))


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> None:
    """Revoke the current session and clear the cookie."""

    current = get_optional_current_user(request, db)
    if current is not None:
        verify_expected_account(request, current)
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        revoke_session(db, token)
    _clear_session_cookie(response)


@router.get("/me", response_model=AuthStatus)
def get_me(current_user: User = Depends(get_current_user)) -> AuthStatus:
    """Return the authenticated user's profile."""

    return AuthStatus(authenticated=True, user=UserRead.model_validate(current_user))


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Change the current user's password and revoke their sessions."""

    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    revoke_all_user_sessions(db, current_user.id, commit=False)
    db.commit()
    _clear_session_cookie(response)


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_admin_user),
) -> UserRead:
    """Create a new user account."""

    email = normalize_email(payload.email)
    existing = db.exec(select(User).where(User.email == email)).one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with that email already exists.",
        )

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name.strip(),
        is_admin=payload.is_admin,
    )
    db.add(user)
    try:
        db.flush()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create user.",
        ) from exc
    db.refresh(user)
    return UserRead.model_validate(user)


__all__ = ["router"]
