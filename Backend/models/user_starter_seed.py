"""Durable completion marker; deleting starter content does not reset onboarding."""
from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlmodel import Field, SQLModel


class UserStarterSeed(SQLModel, table=True):
    __tablename__ = "user_starter_seeds"
    user_id: str = Field(sa_column=Column(String(36), ForeignKey("users.id"), primary_key=True))
    manifest_version: int = Field(sa_column=Column(Integer, primary_key=True))
    manifest_hash: str = Field(sa_column=Column(String(64), nullable=False))
    completed_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()))
