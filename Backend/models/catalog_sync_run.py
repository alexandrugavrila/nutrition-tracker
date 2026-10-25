from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import Column, DateTime, String, func
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel


class CatalogSyncRun(SQLModel, table=True):
    """Audit row for external catalog maintenance jobs."""

    __tablename__ = "catalog_sync_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    source: str = Field(sa_column=Column(String(50), nullable=False, index=True))
    artifact_sha256: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    artifact_uri: Optional[str] = Field(default=None, sa_column=Column(String(2048), nullable=True))
    normalization_version: Optional[str] = Field(default=None, sa_column=Column(String(50), nullable=True))
    status: str = Field(sa_column=Column(String(30), nullable=False))
    summary: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    started_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    )
    completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )


__all__ = ["CatalogSyncRun"]
