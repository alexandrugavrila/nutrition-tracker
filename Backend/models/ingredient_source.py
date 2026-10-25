from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:  # pragma: no cover - only for type checking
    from .ingredient import Ingredient


class IngredientSource(SQLModel, table=True):
    """External source mapping for an ingredient."""

    __tablename__ = "ingredient_sources"
    __table_args__ = (
        CheckConstraint("verification_status IN ('unverified', 'verified', 'rejected')", name="ck_source_verification_status"),
        CheckConstraint("verification_status != 'verified' OR (verified_at IS NOT NULL AND artifact_sha256 IS NOT NULL AND normalization_version IS NOT NULL)", name="ck_verified_source_evidence"),
        UniqueConstraint(
            "source",
            "source_id",
            name="uq_ingredient_sources_source_source_id",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    ingredient_id: int = Field(
        foreign_key="ingredients.id",
        nullable=False,
    )
    source: str = Field(sa_column=Column(String(50), nullable=False))
    source_id: str = Field(sa_column=Column(String(100), nullable=False))
    payload_hash: Optional[str] = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    last_synced_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    is_stale: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, server_default="false")
    )

    verification_status: str = Field(default="unverified", sa_column=Column(String(20), nullable=False, server_default="unverified"))
    verified_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    artifact_sha256: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    normalization_version: Optional[str] = Field(default=None, sa_column=Column(String(50), nullable=True))
    import_run_id: Optional[int] = Field(default=None, sa_column=Column(Integer, ForeignKey("catalog_sync_runs.id"), nullable=True))

    ingredient: Optional["Ingredient"] = Relationship(back_populates="sources")
