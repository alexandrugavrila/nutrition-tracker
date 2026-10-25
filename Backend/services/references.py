"""Reference validation under the authenticated user's mutation lock."""

import math
from fastapi import HTTPException
from sqlmodel import select
from Backend.models import (
    Ingredient,
    IngredientUnit,
    Food,
    FoodIngredient,
    Plan,
    StoredFood,
    DailyLogEntry,
)
from Backend.services.visibility import visible_ingredient_clause


def identity(value):
    if type(value) is int and value > 0:
        return value
    if isinstance(value, str) and value.isdecimal() and int(value) > 0:
        return int(value)
    raise HTTPException(422, 'Invalid entity identifier in plan.')


def nested_reference(value):
    if isinstance(value, dict):
        return bool(set(value) & {'ingredientId', 'foodId', 'unitId', 'overrides'}) or any(
            nested_reference(v) for v in value.values()
        )
    return isinstance(value, list) and any(nested_reference(v) for v in value)


def validate_plan(db, user_id, payload):
    items = payload.get('plan', [])
    if not isinstance(items, list) or nested_reference(
        {k: v for k, v in payload.items() if k != 'plan'}
    ):
        raise HTTPException(422, 'Unrecognized plan reference structure.')

    def unit(value, ingredient_id):
        if value in (None, 0, '0') and not isinstance(value, bool):
            return
        row = db.get(IngredientUnit, identity(value))
        if row is None or row.ingredient_id != ingredient_id:
            raise HTTPException(400, 'Unit must belong to the referenced ingredient.')

    def quantity(value):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
        ):
            raise HTTPException(422, 'Plan quantities must be finite nonnegative numbers.')

    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(422, 'Invalid plan item.')
        if item.get('type') == 'ingredient':
            ingredient_id = identity(item.get('ingredientId'))
            ingredient = db.exec(
                select(Ingredient).where(
                    Ingredient.id == ingredient_id, visible_ingredient_clause(user_id)
                )
            ).one_or_none()
            if ingredient is None:
                raise HTTPException(404, 'Ingredient not found')
            unit(item.get('unitId'), ingredient_id)
            known = {'type', 'ingredientId', 'unitId', 'amount', 'portions'}
        elif item.get('type') == 'food':
            food = db.exec(
                select(Food).where(Food.id == identity(item.get('foodId')), Food.user_id == user_id)
            ).one_or_none()
            if food is None:
                raise HTTPException(404, 'Food not found')
            members = {row.ingredient_id for row in food.ingredients}
            overrides = item.get('overrides', {})
            if not isinstance(overrides, dict):
                raise HTTPException(422, 'Invalid overrides.')
            for key, override in overrides.items():
                ingredient_id = identity(key)
                if ingredient_id not in members or not isinstance(override, dict):
                    raise HTTPException(400, 'Override must reference an ingredient in the recipe.')
                unit(override.get('unitId'), ingredient_id)
                if 'quantity' in override:
                    quantity(override['quantity'])
                if nested_reference(
                    {k: v for k, v in override.items() if k not in {'quantity', 'unitId'}}
                ):
                    raise HTTPException(422, 'Unrecognized override references.')
            known = {'type', 'foodId', 'overrides', 'portions'}
        else:
            raise HTTPException(422, 'Unknown plan item type.')
        for key in ('amount', 'portions'):
            if key in item:
                quantity(item[key])
        if nested_reference({k: v for k, v in item.items() if k not in known}):
            raise HTTPException(422, 'Unrecognized nested references.')


def contains_id(value, key, target):
    if isinstance(value, list):
        return any(contains_id(v, key, target) for v in value)
    if isinstance(value, dict):
        if str(value.get(key)) == str(target):
            return True
        if (
            key == 'ingredientId'
            and isinstance(value.get('overrides'), dict)
            and str(target) in value['overrides']
        ):
            return True
        return any(contains_id(v, key, target) for v in value.values())
    return False


def ensure_unreferenced(db, user_id, *, ingredient_id=None, food_id=None):
    shared = ingredient_id is not None and db.get(Ingredient, ingredient_id).is_shared
    queries = []
    if ingredient_id is not None:
        recipe = (
            select(FoodIngredient).join(Food).where(FoodIngredient.ingredient_id == ingredient_id)
        )
        queries.append(recipe.where(Food.user_id == user_id) if shared else recipe)
    for model in (StoredFood, DailyLogEntry):
        query = (
            select(model).where(model.ingredient_id == ingredient_id)
            if ingredient_id is not None
            else select(model).where(model.food_id == food_id)
        )
        queries.append(query.where(model.owner_user_id == user_id) if shared else query)
    if any(db.exec(query).first() is not None for query in queries):
        raise HTTPException(409, 'This item is referenced by a recipe, stored food, or history.')
    query = select(Plan)
    if shared:
        query = query.where(Plan.user_id == user_id)
    key, target = (
        ('ingredientId', ingredient_id) if ingredient_id is not None else ('foodId', food_id)
    )
    if any(contains_id(plan.payload, key, target) for plan in db.exec(query).all()):
        raise HTTPException(409, 'This item is referenced by a saved plan.')
