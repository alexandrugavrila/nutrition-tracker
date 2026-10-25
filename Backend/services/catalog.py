"""Trusted, identifier-only catalog import. Caller owns the transaction."""

import hashlib
import json
import math
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import select
from Backend.models import (
    Ingredient,
    IngredientUnit,
    IngredientSource,
    Nutrition,
    IngredientShoppingUnit,
    CatalogSelection,
)
from Backend.services.usda_normalization import _trim_food_payload, _trim_nutrients


def select_catalog(db, user_id, ingredient_id):
    if db.get(CatalogSelection, (user_id, ingredient_id)) is None:
        db.add(CatalogSelection(user_id=user_id, ingredient_id=ingredient_id))
        db.flush()


NORMALIZATION_VERSION = "usda-per-g-nullable-v2"


def normalize_verified(fdc_id, raw):
    if not isinstance(raw, dict) or type(raw.get('fdcId')) is not int or raw['fdcId'] != fdc_id:
        raise HTTPException(502, 'USDA returned an unexpected record.')
    try:
        normalized = _trim_food_payload(raw)
        macros = _trim_nutrients(raw.get('foodNutrients', []))
        if any(
            value is not None and (not math.isfinite(value) or value < 0)
            for value in macros.values()
        ):
            raise HTTPException(422, 'USDA returned invalid nutrient values.')
        values = normalized['nutrition']
        if not values or not normalized['normalization']['can_normalize']:
            raise HTTPException(422, 'This ingredient cannot be safely converted to grams.')
        if any(
            value is not None and (not math.isfinite(value) or not 0 <= round(value, 4) < 1000000)
            for value in values.values()
        ):
            raise HTTPException(422, 'USDA nutrient values exceed supported precision or range.')
        name = normalized['name']
        if not isinstance(name, str) or not name.strip() or len(name) > 255:
            raise HTTPException(422, 'USDA ingredient name is invalid.')
        for unit in normalized['units']:
            if (
                len(unit['name']) > 50
                or not math.isfinite(unit['grams'])
                or not 0 < round(unit['grams'], 4) < 1000000
            ):
                raise HTTPException(422, 'USDA unit conversion is invalid.')
        artifact = hashlib.sha256(
            json.dumps(raw, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        ).hexdigest()
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
        raise HTTPException(502, 'USDA returned invalid data.') from exc
    return normalized, artifact


def lock_provider(db, *, exclusive=False):
    """Bulk runs exclude all individual imports; imports retain per-ID concurrency."""
    if db.bind.dialect.name == 'postgresql':
        function = 'pg_advisory_xact_lock' if exclusive else 'pg_advisory_xact_lock_shared'
        db.execute(text(f'SELECT {function}(643220, 1)'))


def import_verified(db, user, fdc_id, raw):
    normalized, artifact = normalize_verified(fdc_id, raw)
    values = normalized['nutrition']
    name = normalized['name']
    lock_provider(db)
    if db.bind.dialect.name == 'postgresql':
        db.execute(text('SELECT pg_advisory_xact_lock(643221, :id)'), {'id': fdc_id})
    source = db.exec(
        select(IngredientSource).where(
            IngredientSource.source == 'usda', IngredientSource.source_id == str(fdc_id)
        )
    ).one_or_none()
    if source:
        ingredient = source.ingredient
        if (
            not ingredient.is_shared
            or ingredient.user_id is not None
            or source.verification_status != 'verified'
        ):
            raise HTTPException(409, 'Provider identifier requires operator reconciliation.')
        # Re-fetch corrects canonical nutrition only; personal copies and historical
        # snapshots retain their recorded values. Units and references stay stable.
        if ingredient.nutrition is None:
            ingredient.nutrition = Nutrition(**values)
        else:
            for key, value in values.items():
                setattr(ingredient.nutrition, key, value)
        source.artifact_sha256 = source.payload_hash = artifact
        source.is_stale = False
        if raw.get("dataType") != "Foundation":
            source.import_run_id = None
        source.verified_at = datetime.now(timezone.utc)
        source.normalization_version = NORMALIZATION_VERSION
        db.add(source)
        db.add(ingredient)
    else:
        ingredient = Ingredient(name=name.strip(), is_shared=True, nutrition=Nutrition(**values))
        ingredient.units = [
            IngredientUnit(name=u['name'], grams=u['grams']) for u in normalized['units']
        ]
        if not any(u.name == 'g' and u.grams == 1 for u in ingredient.units):
            ingredient.units.append(IngredientUnit(name='g', grams=1))
        ingredient.sources = [
            IngredientSource(
                source='usda',
                source_id=str(fdc_id),
                verification_status='verified',
                verified_at=datetime.now(timezone.utc),
                artifact_sha256=artifact,
                payload_hash=artifact,
                normalization_version=NORMALIZATION_VERSION,
            )
        ]
        db.add(ingredient)
        db.flush()
        default = next(
            (u for u, data in zip(ingredient.units, normalized['units']) if data.get('is_default')),
            ingredient.units[-1],
        )
        ingredient.shopping_unit = IngredientShoppingUnit(unit=default)
    select_catalog(db, user.id, ingredient.id)
    return ingredient
