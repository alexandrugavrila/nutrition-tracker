"""Historical provenance retained when a personal row releases a canonical mapping."""
from datetime import datetime
from typing import Any, Optional
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, func
from sqlmodel import Field, SQLModel


class IngredientProvenanceHistory(SQLModel, table=True):
    __tablename__ = "ingredient_provenance_history"
    id: Optional[int] = Field(default=None, primary_key=True)
    ingredient_id: int = Field(sa_column=Column(Integer, ForeignKey("ingredients.id"), nullable=False, index=True))
    source: str = Field(sa_column=Column(String(50), nullable=False))
    source_id: str = Field(sa_column=Column(String(100), nullable=False))
    adoption_version: Optional[str] = Field(default=None, sa_column=Column(String(50), ForeignKey("ownership_adoptions.version"), nullable=True))
    reason: str = Field(sa_column=Column(String(255), nullable=False))
    details: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    recorded_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()))
