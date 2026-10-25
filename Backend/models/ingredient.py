from typing import List, Optional, TYPE_CHECKING

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, String, UniqueConstraint

from .ingredient_unit import IngredientUnit
from .ingredient_source import IngredientSource
from .nutrition import Nutrition
from .possible_ingredient_tag import PossibleIngredientTag
from .ingredient_tag import IngredientTagLink

if TYPE_CHECKING:  # pragma: no cover - only for type checking
    from .schemas import IngredientCreate
    from .ingredient_shopping_unit import IngredientShoppingUnit
    from .stored_food import StoredFood


class Ingredient(SQLModel, table=True):
    """Core ingredient information."""

    __tablename__ = "ingredients"
    __table_args__ = (
        CheckConstraint("is_shared OR user_id IS NOT NULL", name="ck_ingredients_personal_has_owner"),
        CheckConstraint("NOT is_shared OR user_id IS NULL", name="ck_ingredients_shared_has_no_owner"),
        UniqueConstraint("user_id", "name", name="uq_ingredients_user_id_name"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            String(36),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )
    is_shared: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    name: str = Field(sa_column=Column(String(255), nullable=False))
    nutrition: Optional[Nutrition] = Relationship(
        back_populates="ingredient",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    units: List[IngredientUnit] = Relationship(
        back_populates="ingredient",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    sources: List[IngredientSource] = Relationship(
        back_populates="ingredient",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    shopping_unit: Optional["IngredientShoppingUnit"] = Relationship(
        back_populates="ingredient",
        sa_relationship_kwargs={
            "cascade": "all, delete-orphan",
            "uselist": False,
        },
    )
    tags: List[PossibleIngredientTag] = Relationship(
        back_populates="ingredients", link_model=IngredientTagLink
    )
    stored_food_items: List["StoredFood"] = Relationship(back_populates="ingredient")

    @classmethod
    def from_create(cls, data: "IngredientCreate") -> "Ingredient":
        """Create an :class:`Ingredient` ORM object from an ``IngredientCreate`` schema."""

        ingredient = cls(name=data.name)

        if data.nutrition:
            ingredient.nutrition = Nutrition.model_validate(
                data.nutrition.model_dump()
            )

        ingredient.units = [
            IngredientUnit.model_validate(unit.model_dump()) for unit in data.units
        ]

        # Tags are resolved separately in the routes using the database session
        # to load existing ``PossibleIngredientTag`` records by ID.
        # ``Ingredient.from_create`` therefore leaves the ``tags`` collection
        # empty so that the routes can populate it appropriately.

        return ingredient
