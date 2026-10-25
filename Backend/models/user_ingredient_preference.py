"""Per-account shopping overrides; the catalog default remains separate."""
from sqlalchemy import Column, ForeignKey, ForeignKeyConstraint, Integer, String
from sqlmodel import Field, SQLModel


class UserIngredientPreference(SQLModel, table=True):
    __tablename__ = "user_ingredient_preferences"
    __table_args__ = (
        ForeignKeyConstraint(["ingredient_id", "unit_id"],
            ["ingredient_units.ingredient_id", "ingredient_units.id"],
            name="fk_user_preference_unit_matches_ingredient"),
    )
    user_id: str = Field(sa_column=Column(String(36), ForeignKey("users.id"), primary_key=True))
    ingredient_id: int = Field(sa_column=Column(Integer, ForeignKey("ingredients.id"), primary_key=True))
    unit_id: int = Field(sa_column=Column(Integer, nullable=False))
