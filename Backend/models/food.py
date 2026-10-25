from typing import List, Optional, TYPE_CHECKING

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, ForeignKey, String, UniqueConstraint

from .food_ingredient import FoodIngredient
from .possible_food_tag import PossibleFoodTag
from .food_tag import FoodTagLink

if TYPE_CHECKING:  # pragma: no cover - only for type checking
    from .schemas import FoodCreate
    from .stored_food import StoredFood


class Food(SQLModel, table=True):
    """Food with associated ingredients and tags."""

    __tablename__ = "foods"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_foods_user_id_name"),
    )

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
    name: str = Field(sa_column=Column(String(100), nullable=False))

    ingredients: List[FoodIngredient] = Relationship(
        back_populates="food",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    tags: List[PossibleFoodTag] = Relationship(
        back_populates="foods", link_model=FoodTagLink
    )
    stored_food_items: List["StoredFood"] = Relationship(back_populates="food")

    @classmethod
    def from_create(cls, data: "FoodCreate") -> "Food":
        """Create a :class:`Food` ORM object from a ``FoodCreate`` schema."""

        food = cls(name=data.name)

        food.ingredients = [
            FoodIngredient.model_validate(mi.model_dump()) for mi in data.ingredients
        ]

        # Tags are populated in the routes after resolving the provided IDs
        # against the database. ``Food.from_create`` therefore leaves the
        # ``tags`` relationship empty here.

        return food
