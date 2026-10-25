"""Completed adoption ledger, written atomically by the future adoption command."""
from datetime import datetime
from typing import Any
from sqlalchemy import Column, DateTime, ForeignKey, JSON, String, func
from sqlmodel import Field, SQLModel


class OwnershipAdoption(SQLModel, table=True):
    __tablename__ = "ownership_adoptions"
    version: str = Field(sa_column=Column(String(50), primary_key=True))
    owner_user_id: str = Field(sa_column=Column(String(36), ForeignKey("users.id"), nullable=False))
    report_hash: str = Field(sa_column=Column(String(64), nullable=False))
    mapping: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    report: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    completed_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()))
