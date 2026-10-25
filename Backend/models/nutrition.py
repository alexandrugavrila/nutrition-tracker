from typing import Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Numeric


class Nutrition(SQLModel, table=True):
    """Nutritional information for a single ingredient."""

    __tablename__ = "nutrition"

    id: Optional[int] = Field(default=None, primary_key=True)
    ingredient_id: Optional[int] = Field(default=None, foreign_key="ingredients.id", nullable=False)
    calories: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )
    fat: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )
    carbohydrates: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )
    protein: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )
    fiber: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )

    ingredient: Optional["Ingredient"] = Relationship(back_populates="nutrition")
