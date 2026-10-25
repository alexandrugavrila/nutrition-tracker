import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Column, DateTime, ForeignKey, String, func
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .user import User


def _default_session_id() -> str:
    return str(uuid.uuid4())


class AuthSession(SQLModel, table=True):
    """Server-side session for an authenticated user."""

    __tablename__ = "auth_sessions"

    id: str = Field(
        default_factory=_default_session_id,
        sa_column=Column(String(36), primary_key=True, nullable=False),
    )
    user_id: str = Field(
        sa_column=Column(
            String(36),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    last_seen_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))

    user: Optional["User"] = Relationship(back_populates="sessions")


__all__ = ["AuthSession"]
