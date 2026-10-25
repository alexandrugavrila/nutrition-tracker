"""Routes for managing stored food entries."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, select
from sqlalchemy import delete, func, inspect
from sqlalchemy.exc import SQLAlchemyError

from ..services.visibility import visible_ingredient_clause
from ..db import get_db
from ..auth.dependencies import get_current_user
from ..models import (
    DailyLogEntry,
    Food,
    Ingredient,
    StoredFood,
    StoredFoodConsume,
    StoredFoodCreate,
    StoredFoodRead,
    User,
)

router = APIRouter(prefix="/stored_food", tags=["stored_food"])


_UNAVAILABLE_DETAIL = (
    "Stored food storage is unavailable because the database schema is out of date. "
    "Run the latest database migrations and try again."
)


def _apply_filters(
    statement,
    user_id: str,
    only_available: bool,
    day: Optional[date],
):
    """Apply list filters to the stored food select statement."""

    statement = statement.where(StoredFood.owner_user_id == user_id)
    if only_available:
        statement = statement.where(StoredFood.remaining_portions > 0)
    if day:
        statement = statement.where(func.date(StoredFood.prepared_at) == day)
    return statement


def _stored_food_table_available(db: Session) -> bool:
    """Return ``True`` when the stored_food table exists in the database."""

    try:
        bind = db.get_bind()
    except SQLAlchemyError:
        return False

    try:
        inspector = inspect(bind)
    except SQLAlchemyError:
        return False

    try:
        return inspector.has_table(StoredFood.__tablename__)
    except SQLAlchemyError:
        return False


def _ingredient_available(db: Session, ingredient_id: int, current_user: User) -> bool:
    statement = select(Ingredient).where(Ingredient.id == ingredient_id).where(
        visible_ingredient_clause(current_user.id)
    )
    return db.exec(statement).one_or_none() is not None


def _food_available(db: Session, food_id: int, current_user: User) -> bool:
    visibility = Food.user_id == current_user.id
    statement = select(Food).where(Food.id == food_id).where(visibility)
    return db.exec(statement).one_or_none() is not None


def _get_owned_stored_food(
    db: Session, stored_food_id: int, current_user: User
) -> Optional[StoredFood]:
    statement = (
        select(StoredFood)
        .where(StoredFood.id == stored_food_id)
        .where(StoredFood.owner_user_id == current_user.id)
    )
    return db.exec(statement).one_or_none()


@router.post("/", response_model=StoredFoodRead, status_code=201)
def create_stored_food(
    payload: StoredFoodCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoredFoodRead:
    """Persist a new stored food entry."""

    if not _stored_food_table_available(db):
        raise HTTPException(
            status_code=503,
            detail=_UNAVAILABLE_DETAIL,
        )

    data = payload.model_dump(exclude_unset=True)
    remaining = data.pop("remaining_portions", None)
    prepared_at = data.pop("prepared_at", None)

    if data.get("food_id") is not None and not _food_available(
        db, data["food_id"], current_user
    ):
        raise HTTPException(status_code=404, detail="Food not found")
    if data.get("ingredient_id") is not None and not _ingredient_available(
        db, data["ingredient_id"], current_user
    ):
        raise HTTPException(status_code=404, detail="Ingredient not found")

    if prepared_at is None:
        prepared_at = datetime.now(timezone.utc)

    if remaining is None:
        remaining = data["prepared_portions"]

    stored_food = StoredFood(
        **data,
        user_id=current_user.id,
        owner_user_id=current_user.id,
        prepared_at=prepared_at,
        remaining_portions=max(0.0, float(remaining)),
    )
    stored_food.is_finished = stored_food.remaining_portions <= 0
    if stored_food.is_finished:
        stored_food.completed_at = datetime.now(timezone.utc)

    db.add(stored_food)
    db.commit()
    db.refresh(stored_food)
    return StoredFoodRead.model_validate(stored_food)


@router.get("/", response_model=List[StoredFoodRead])
def list_stored_food(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    only_available: bool = Query(default=False),
    day: Optional[date] = Query(default=None),
) -> List[StoredFoodRead]:
    """Retrieve stored food entries with optional filters."""

    if not _stored_food_table_available(db):
        return []

    statement = select(StoredFood).order_by(StoredFood.prepared_at.desc())
    statement = _apply_filters(statement, current_user.id, only_available, day)
    results = db.exec(statement).all()
    return [StoredFoodRead.model_validate(item) for item in results]


@router.post("/{stored_food_id}/consume", response_model=StoredFoodRead)
def consume_stored_food(
    stored_food_id: int,
    payload: StoredFoodConsume,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoredFoodRead:
    """Consume portions from a stored food entry."""

    if not _stored_food_table_available(db):
        raise HTTPException(
            status_code=503,
            detail=_UNAVAILABLE_DETAIL,
        )

    stored_food = _get_owned_stored_food(db, stored_food_id, current_user)
    if not stored_food:
        raise HTTPException(status_code=404, detail="Stored food not found")

    if payload.portions <= 0:
        raise HTTPException(status_code=400, detail="Portions must be greater than zero")

    if stored_food.remaining_portions <= 0:
        raise HTTPException(status_code=400, detail="No portions remaining")

    if payload.portions > stored_food.remaining_portions:
        raise HTTPException(
            status_code=400, detail="Cannot consume more portions than remain"
        )

    stored_food.remaining_portions = max(0.0, stored_food.remaining_portions - payload.portions)
    stored_food.is_finished = stored_food.remaining_portions <= 0
    if stored_food.is_finished:
        stored_food.completed_at = datetime.now(timezone.utc)
    db.add(stored_food)
    db.commit()
    db.refresh(stored_food)
    return StoredFoodRead.model_validate(stored_food)


@router.delete(
    "/{stored_food_id}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
def delete_stored_food(
    stored_food_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a stored food entry."""

    if not _stored_food_table_available(db):
        raise HTTPException(status_code=503, detail=_UNAVAILABLE_DETAIL)

    stored_food = _get_owned_stored_food(db, stored_food_id, current_user)
    if stored_food is None:
        raise HTTPException(status_code=404, detail="Stored food not found")

    entries = db.exec(
        select(DailyLogEntry).where(DailyLogEntry.stored_food_id == stored_food_id)
    ).all()
    for entry in entries:
        entry.stored_food_id = None
        if stored_food.food_id is not None:
            entry.food_id = stored_food.food_id
            entry.ingredient_id = None
        elif stored_food.ingredient_id is not None:
            entry.ingredient_id = stored_food.ingredient_id
            entry.food_id = None

    db.delete(stored_food)
    db.commit()


@router.delete(
    "/",
    status_code=204,
    response_class=Response,
    response_model=None,
)
def clear_stored_food(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove all stored food entries for a user."""

    if not _stored_food_table_available(db):
        return

    stored_food_items = db.exec(
        select(StoredFood).where(StoredFood.owner_user_id == current_user.id)
    ).all()

    for stored_food in stored_food_items:
        entries = db.exec(
            select(DailyLogEntry).where(DailyLogEntry.stored_food_id == stored_food.id)
        ).all()
        for entry in entries:
            entry.stored_food_id = None
            if stored_food.food_id is not None:
                entry.food_id = stored_food.food_id
                entry.ingredient_id = None
            elif stored_food.ingredient_id is not None:
                entry.ingredient_id = stored_food.ingredient_id
                entry.food_id = None

    statement = delete(StoredFood).where(StoredFood.owner_user_id == current_user.id)
    db.exec(statement)
    db.commit()
