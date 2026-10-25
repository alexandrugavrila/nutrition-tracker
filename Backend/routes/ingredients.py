from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from ..services.visibility import visible_ingredient_clause
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from ..db import get_db
from ..auth.dependencies import get_current_user
from ..models import (
    Ingredient,
    IngredientShoppingUnit,
    IngredientUnit,
    IngredientSource,
    Nutrition,
    PossibleIngredientTag,
    User,
)
from ..models.schemas import (
    IngredientCreate,
    IngredientRead,
    IngredientUpdate,
    IngredientShoppingUnitSelection,
)
from sqlmodel import SQLModel


class TagCreate(SQLModel):
    """Schema for creating a new possible tag by name."""

    name: str


router = APIRouter(prefix="/ingredients", tags=["ingredients"])

INGREDIENT_LOAD_OPTIONS = [
    selectinload(Ingredient.nutrition),
    selectinload(Ingredient.units),
    selectinload(Ingredient.sources),
    selectinload(Ingredient.tags),
    selectinload(Ingredient.shopping_unit).selectinload(IngredientShoppingUnit.unit),
]


def _resolve_primary_source(ingredient: Ingredient) -> tuple[Optional[str], Optional[str]]:
    sources = list(ingredient.sources or [])
    if not sources:
        return None, None
    usda = next((source for source in sources if source.source == "usda"), None)
    if usda:
        return usda.source, usda.source_id
    sources.sort(
        key=lambda source: (
            source.source or "",
            source.source_id or "",
            source.id or 0,
        )
    )
    primary = sources[0]
    return primary.source, primary.source_id


def _visible_ingredient_clause(current_user: User):
    return visible_ingredient_clause(current_user.id)


def _load_visible_ingredient(
    db: Session, ingredient_id: int, current_user: User
) -> Optional[Ingredient]:
    statement = (
        select(Ingredient)
        .options(*INGREDIENT_LOAD_OPTIONS)
        .where(Ingredient.id == ingredient_id)
        .where(_visible_ingredient_clause(current_user))
    )
    return db.exec(statement).one_or_none()


def _ensure_can_modify_ingredient(ingredient: Ingredient, current_user: User) -> None:
    if ingredient.is_shared:
        raise HTTPException(403, "USDA ingredients are read-only. Make a personal copy to edit.")
    if ingredient.user_id != current_user.id:
        raise HTTPException(404, "Ingredient not found")


def ingredient_to_read(ingredient: Ingredient, db=None, current_user=None) -> IngredientRead:
    """Convert an Ingredient to IngredientRead and ensure base 'g' unit is visible."""

    source, source_id = _resolve_primary_source(ingredient)
    resolved_unit = None
    resolved_unit_id = None
    if ingredient.shopping_unit:
        resolved_unit = ingredient.shopping_unit.unit
        resolved_unit_id = ingredient.shopping_unit.unit_id
        if resolved_unit is None and resolved_unit_id is not None:
            resolved_unit = next(
                (unit for unit in (ingredient.units or []) if unit.id == resolved_unit_id),
                None,
            )

    if db is not None and current_user is not None:
        from Backend.models import UserIngredientPreference

        override = db.get(UserIngredientPreference, (current_user.id, ingredient.id))
        if override:
            resolved_unit = next((u for u in ingredient.units if u.id == override.unit_id), None)
            resolved_unit_id = override.unit_id
    if resolved_unit is None:
        resolved_unit = next((u for u in ingredient.units if u.name == 'g' and u.grams == 1), None)
        resolved_unit_id = resolved_unit.id if resolved_unit else None

    payload = {
        "id": ingredient.id,
        "name": ingredient.name,
        "user_id": ingredient.user_id,
        "is_shared": ingredient.is_shared,
        "provenance_status": next(
            (
                row.verification_status
                for row in ingredient.sources
                if row.source == source and row.source_id == source_id
            ),
            "unverified",
        ),
        "source": source,
        "source_id": source_id,
        "nutrition": ingredient.nutrition,
        "units": list(ingredient.units or []),
        "tags": list(ingredient.tags or []),
        "shopping_unit": resolved_unit if resolved_unit is not None else None,
        "shopping_unit_id": None,
    }

    if resolved_unit is not None and getattr(resolved_unit, "id", None) is not None:
        payload["shopping_unit_id"] = resolved_unit.id
    elif resolved_unit_id is not None:
        payload["shopping_unit_id"] = resolved_unit_id

    read = IngredientRead.model_validate(payload)

    has_g = any((getattr(u, "name", None) == "g") for u in (read.units or []))
    if not has_g:
        # Append a synthetic base unit; id is None since it may not exist yet in DB
        read.units.append(IngredientUnit(name="g", grams=1))
    return read


def ensure_g_unit_present(ingredient_obj: Ingredient) -> None:
    """Ensure a 'g' unit with grams == 1 exists on the Ingredient's units.

    Checks both name and grams to satisfy the strict requirement.
    """
    units = list(ingredient_obj.units or [])
    for u in units:
        if u.name == "g":
            # Preserve persisted conversions, including malformed legacy aliases.
            if getattr(u, "grams", None) != 1:
                raise HTTPException(
                    409,
                    "An existing gram unit has an invalid conversion; preserve it and resolve the conflict explicitly.",
                )
            return
    # No 'g' unit found; append one with grams == 1
    units.append(IngredientUnit(name="g", grams=1))
    ingredient_obj.units = units


def _coerce_optional_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        if not candidate:
            return None
        try:
            return int(candidate)
        except ValueError:
            return None
    return None


def _resolve_shopping_unit(
    ingredient: Ingredient,
    requested_id: Optional[Any],
    payload: Optional[IngredientShoppingUnitSelection],
) -> Optional[IngredientUnit]:
    units = list(ingredient.units or [])
    if not units:
        if requested_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Preferred shopping unit must reference an existing unit.",
            )
        return None

    def match_by_id(raw_id: Any) -> Optional[IngredientUnit]:
        normalized = _coerce_optional_int(raw_id)
        if normalized is None:
            return None
        match = next((unit for unit in units if unit.id == normalized), None)
        if match is None:
            raise HTTPException(
                status_code=400,
                detail="Preferred shopping unit must belong to the ingredient.",
            )
        return match

    unit = match_by_id(requested_id)
    if unit is not None:
        return unit

    payload_obj: Optional[IngredientShoppingUnitSelection]
    if payload is not None and not isinstance(payload, IngredientShoppingUnitSelection):
        payload_obj = IngredientShoppingUnitSelection.model_validate(payload)
    else:
        payload_obj = payload

    if payload_obj is not None:
        candidate = match_by_id(
            getattr(payload_obj, "unit_id", None) or getattr(payload_obj, "id", None)
        )
        if candidate is not None:
            return candidate

        name = getattr(payload_obj, "name", None)
        grams = getattr(payload_obj, "grams", None)
        normalized_name = name.strip().lower() if isinstance(name, str) else None
        grams_value: Optional[float] = None
        if grams is not None:
            try:
                grams_value = float(grams)
            except (TypeError, ValueError):
                grams_value = None

        if normalized_name:
            matching = [
                unit for unit in units if (unit.name or "").strip().lower() == normalized_name
            ]
            if grams_value is not None:
                matching = [
                    unit
                    for unit in matching
                    if unit.grams is not None and abs(float(unit.grams) - grams_value) < 1e-9
                ]
            if matching:
                return matching[0]

    return None


@router.get("/", response_model=List[IngredientRead])
def get_all_ingredients(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[IngredientRead]:
    """Return all ingredients."""
    statement = (
        select(Ingredient)
        .options(*INGREDIENT_LOAD_OPTIONS)
        .where(_visible_ingredient_clause(current_user))
    )
    ingredients = db.exec(statement).all()
    return [ingredient_to_read(ing, db, current_user) for ing in ingredients]


@router.get("/possible_tags", response_model=List[PossibleIngredientTag])
def get_all_possible_tags(
    db: Session = Depends(get_db),
) -> List[PossibleIngredientTag]:
    """Return all possible ingredient tags ordered by name."""
    statement = select(PossibleIngredientTag).order_by(PossibleIngredientTag.name)
    return db.exec(statement).all()


@router.post("/possible_tags", response_model=PossibleIngredientTag, status_code=201)
def add_possible_tag(
    tag: TagCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> PossibleIngredientTag:
    """Create a new possible ingredient tag, or return existing on duplicate name."""
    obj = PossibleIngredientTag(name=tag.name.strip())
    db.add(obj)
    try:
        db.commit()
        db.refresh(obj)
        return obj
    except IntegrityError:
        db.rollback()
        # Return the existing tag with the same name
        statement = select(PossibleIngredientTag).where(
            PossibleIngredientTag.name == tag.name.strip()
        )
        existing = db.exec(statement).one()
        return existing


@router.get("/{ingredient_id}", response_model=IngredientRead)
def get_ingredient(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IngredientRead:
    """Retrieve a single ingredient by ID."""
    ingredient = _load_visible_ingredient(db, ingredient_id, current_user)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    return ingredient_to_read(ingredient, db, current_user)


@router.post("/", response_model=IngredientRead, status_code=201)
def add_ingredient(
    ingredient: IngredientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IngredientRead:
    """Create a new ingredient."""
    ingredient_obj = Ingredient.from_create(ingredient)
    ingredient_obj.user_id = current_user.id
    ensure_g_unit_present(ingredient_obj)
    ingredient_obj.tags = resolve_tags(db, ingredient.tags)
    db.add(ingredient_obj)
    try:
        db.flush()
        set_personal_preference(
            db, current_user, ingredient_obj, ingredient.shopping_unit_id, ingredient.shopping_unit
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "An ingredient with this name already exists, or a reference is invalid."
        ) from exc
    db.refresh(ingredient_obj)
    return ingredient_to_read(ingredient_obj, db, current_user)


@router.put("/{ingredient_id}", response_model=IngredientRead)
def update_ingredient(
    ingredient_id: int,
    ingredient_data: IngredientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IngredientRead:
    """Update an existing ingredient.

    Important: Avoid deleting existing units on update to preserve referential
    integrity for rows in food_ingredients that reference them. Instead,
    upsert provided units (update by id or insert new). Existing units not in
    the payload are left unchanged.
    """
    # Load ingredient with related collections for safe updates
    ingredient = _load_visible_ingredient(db, ingredient_id, current_user)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    _ensure_can_modify_ingredient(ingredient, current_user)

    payload_fields = ingredient_data.model_dump(exclude_unset=True)

    ingredient.name = ingredient_data.name
    # Upsert nutrition
    if ingredient_data.nutrition:
        ingredient.nutrition = Nutrition.model_validate(ingredient_data.nutrition.model_dump())
    else:
        ingredient.nutrition = None

    # Upsert units without deleting existing ones
    existing_units = list(ingredient.units or [])
    existing_by_id = {u.id: u for u in existing_units if u.id is not None}
    existing_by_name = {u.name.lower(): u for u in existing_units if u.name}

    for u_in in ingredient_data.units:
        # Materialize to ORM model (may include id if provided by schema)
        incoming = IngredientUnit.model_validate(u_in.model_dump())

        # Prefer ID-based update when present
        if incoming.id is not None and incoming.id not in existing_by_id:
            raise HTTPException(400, "Unit must belong to this ingredient.")
        if getattr(incoming, "id", None) and incoming.id in existing_by_id:
            ex = existing_by_id[incoming.id]
            if ex.grams != incoming.grams:
                raise HTTPException(409, "Existing unit conversions are immutable; add a new unit.")
            ex.name = incoming.name
            continue

        # Otherwise try name-based update (case-insensitive) to avoid duplicates
        key = (incoming.name or "").lower()
        if key in existing_by_name:
            ex = existing_by_name[key]
            # Preserve the conversion and existing name casing
            if ex.grams != incoming.grams:
                raise HTTPException(409, "Existing unit conversions are immutable; add a new unit.")
        else:
            # New unit
            ingredient.units.append(IngredientUnit(name=incoming.name, grams=incoming.grams))

    # Ensure base 'g' unit exists and is correct
    ensure_g_unit_present(ingredient)

    ingredient.tags = resolve_tags(db, ingredient_data.tags)

    try:
        db.add(ingredient)
        db.flush()
        if "shopping_unit_id" in payload_fields or "shopping_unit" in payload_fields:
            set_personal_preference(
                db,
                current_user,
                ingredient,
                ingredient_data.shopping_unit_id,
                ingredient_data.shopping_unit,
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Ingredient update conflicts with existing data."
        )

    # Re-load to include related fields
    statement = (
        select(Ingredient).options(*INGREDIENT_LOAD_OPTIONS).where(Ingredient.id == ingredient.id)
    )
    ingredient = db.exec(statement).one()
    return ingredient_to_read(ingredient, db, current_user)


@router.delete("/{ingredient_id}")
def delete_ingredient(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Delete an ingredient."""
    ingredient = _load_visible_ingredient(db, ingredient_id, current_user)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingredient not found")
    _ensure_can_modify_ingredient(ingredient, current_user)
    from Backend.services.references import ensure_unreferenced

    ensure_unreferenced(db, current_user.id, ingredient_id=ingredient.id)
    from Backend.models import UserIngredientPreference, IngredientProvenanceHistory
    from sqlalchemy import delete

    db.exec(
        delete(UserIngredientPreference).where(
            UserIngredientPreference.ingredient_id == ingredient.id
        )
    )
    db.exec(
        delete(IngredientProvenanceHistory).where(
            IngredientProvenanceHistory.ingredient_id == ingredient.id
        )
    )
    db.delete(ingredient)
    db.commit()
    return {"message": "Ingredient deleted successfully"}


__all__ = ["router"]


def resolve_tags(db, refs):
    result = []
    for ref in refs:
        tag = db.get(PossibleIngredientTag, ref.id)
        if tag is None:
            raise HTTPException(404, "Tag not found")
        if tag not in result:
            result.append(tag)
    return result


def set_personal_preference(db, user, ingredient, requested_id, payload=None):
    from Backend.models import UserIngredientPreference

    unit = _resolve_shopping_unit(ingredient, requested_id, payload)
    if payload is not None and unit is None:
        raise HTTPException(400, "Preferred shopping unit must belong to the ingredient.")
    existing = db.get(UserIngredientPreference, (user.id, ingredient.id))
    if unit is None:
        if existing:
            db.delete(existing)
    elif existing:
        existing.unit_id = unit.id
        db.add(existing)
    else:
        db.add(
            UserIngredientPreference(user_id=user.id, ingredient_id=ingredient.id, unit_id=unit.id)
        )


from pydantic import ConfigDict


class ShoppingPreference(SQLModel):
    model_config = ConfigDict(extra="forbid")
    unit_id: int | None


@router.put("/{ingredient_id}/shopping-preference", response_model=IngredientRead)
def shopping_preference(
    ingredient_id: int,
    payload: ShoppingPreference,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ingredient = _load_visible_ingredient(db, ingredient_id, current_user)
    if ingredient is None:
        raise HTTPException(404, "Ingredient not found")
    set_personal_preference(db, current_user, ingredient, payload.unit_id)
    db.commit()
    return ingredient_to_read(ingredient, db, current_user)


@router.post("/{ingredient_id}/copy", response_model=IngredientRead, status_code=201)
def copy_ingredient(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    original = _load_visible_ingredient(db, ingredient_id, current_user)
    if original is None:
        raise HTTPException(404, "Ingredient not found")
    names = set(db.exec(select(Ingredient.name).where(Ingredient.user_id == current_user.id)).all())
    name = original.name
    index = 1
    while name in names:
        suffix = f" (copy {index})"
        name = original.name[: 255 - len(suffix)] + suffix
        index += 1
    copied = Ingredient(name=name, user_id=current_user.id, tags=list(original.tags))
    if original.nutrition:
        copied.nutrition = Nutrition(
            **original.nutrition.model_dump(exclude={'id', 'ingredient_id'})
        )
    copied.units = [IngredientUnit(name=u.name, grams=u.grams) for u in original.units]
    db.add(copied)
    db.flush()
    from Backend.models import IngredientProvenanceHistory

    for source in original.sources:
        db.add(
            IngredientProvenanceHistory(
                ingredient_id=copied.id,
                source=source.source,
                source_id=source.source_id,
                reason='Explicit personal copy; no synchronization link',
                details={
                    'copied_from_ingredient_id': original.id,
                    'artifact_sha256': source.artifact_sha256,
                },
            )
        )
    selected = ingredient_to_read(original, db, current_user).shopping_unit_id
    for old, new in zip(original.units, copied.units):
        if old.id == selected:
            set_personal_preference(db, current_user, copied, new.id)
    db.commit()
    db.refresh(copied)
    return ingredient_to_read(copied, db, current_user)


@router.delete("/{ingredient_id}/selection", status_code=204)
def remove_selection(
    ingredient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from Backend.models import CatalogSelection, UserIngredientPreference
    from Backend.services.references import ensure_unreferenced

    ingredient = _load_visible_ingredient(db, ingredient_id, current_user)
    if ingredient is None or not ingredient.is_shared:
        raise HTTPException(404, "Catalog selection not found")
    ensure_unreferenced(db, current_user.id, ingredient_id=ingredient_id)
    preference = db.get(UserIngredientPreference, (current_user.id, ingredient_id))
    if preference:
        db.delete(preference)
    db.delete(db.get(CatalogSelection, (current_user.id, ingredient_id)))
    db.commit()
