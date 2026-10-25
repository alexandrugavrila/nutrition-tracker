"""Ingredient visibility during expansion and after adoption."""
from sqlalchemy import and_, or_
from Backend.models import Ingredient, IngredientSource, CatalogSelection
from sqlalchemy import exists


def visible_ingredient_clause(user_id: str):
    return or_(
        and_(Ingredient.is_shared.is_(False), Ingredient.user_id == user_id),
        and_(Ingredient.is_shared.is_(True), Ingredient.user_id.is_(None),
             Ingredient.sources.any(IngredientSource.verification_status == "verified"),
             exists().where(CatalogSelection.user_id == user_id, CatalogSelection.ingredient_id == Ingredient.id)),
    )
