from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:  # pragma: no cover - only used for typing
    from .food import Food
    from .ingredient import Ingredient


class StoredFood(SQLModel, table=True):
    """Prepared food stored for later consumption."""

    __tablename__ = "stored_food"
    __table_args__ = (
        CheckConstraint(
            "(food_id IS NOT NULL AND ingredient_id IS NULL) OR "
            "(food_id IS NULL AND ingredient_id IS NOT NULL)",
            name="stored_food_food_or_ingredient_ck",
        ),
        CheckConstraint(
            "prepared_portions >= 0", name="stored_food_prepared_portions_non_negative"
        ),
        CheckConstraint(
            "remaining_portions >= 0", name="stored_food_remaining_portions_non_negative"
        ),
        Index("ix_stored_food_user_finished", "user_id", "is_finished"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # Legacy identity retained verbatim until explicit adoption.
    owner_user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(36), ForeignKey("users.id"), nullable=False, index=True),
    )
    user_id: str = Field(sa_column=Column(String(255), nullable=False, index=True))
    label: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    food_id: Optional[int] = Field(
        default=None, sa_column=Column(ForeignKey("foods.id", ondelete="CASCADE"))
    )
    ingredient_id: Optional[int] = Field(
        default=None, sa_column=Column(ForeignKey("ingredients.id", ondelete="CASCADE"))
    )
    prepared_portions: float = Field(sa_column=Column(Float, nullable=False))
    remaining_portions: float = Field(sa_column=Column(Float, nullable=False))
    per_portion_calories: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    per_portion_protein: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    per_portion_carbohydrates: float | None = Field(
        default=None, sa_column=Column(Float, nullable=True)
    )
    per_portion_fat: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    per_portion_fiber: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    is_finished: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, server_default="false")
    )
    prepared_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        )
    )
    updated_at: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
            onupdate=func.now(),
        )
    )
    completed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )

    food: Optional["Food"] = Relationship(back_populates="stored_food_items")
    ingredient: Optional["Ingredient"] = Relationship(back_populates="stored_food_items")


__all__ = ["StoredFood"]
