from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, func
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


class Plan(SQLModel, table=True):
    """Persisted plan with arbitrary JSON payload."""

    __tablename__ = "plans"
    __table_args__ = (Index("ix_plans_user_updated", "user_id", "updated_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            String(36),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    label: str = Field(sa_column=Column(String(255), nullable=False))
    payload: Dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        )
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        )
    )


__all__ = ["Plan"]
