"""Routes for managing daily consumption logs."""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete
from sqlmodel import Session, select

from ..auth.dependencies import get_current_user
from ..services.visibility import visible_ingredient_clause
from ..db import get_db
from ..models import (
    DailyLogEntry,
    DailyLogEntryCreate,
    DailyLogEntryRead,
    Food,
    Ingredient,
    StoredFood,
    User,
)

router = APIRouter(prefix="/logs", tags=["logs"])


def _ingredient_available(db: Session, ingredient_id: int, current_user: User) -> bool:
    statement = select(Ingredient).where(Ingredient.id == ingredient_id).where(
        visible_ingredient_clause(current_user.id)
    )
    return db.exec(statement).one_or_none() is not None


def _food_available(db: Session, food_id: int, current_user: User) -> bool:
    visibility = Food.user_id == current_user.id
    statement = select(Food).where(Food.id == food_id).where(visibility)
    return db.exec(statement).one_or_none() is not None


def _stored_food_available(db: Session, stored_food_id: int, current_user: User) -> bool:
    statement = (
        select(StoredFood)
        .where(StoredFood.id == stored_food_id)
        .where(StoredFood.owner_user_id == current_user.id)
    )
    return db.exec(statement).one_or_none() is not None


@router.get("/{log_date}", response_model=List[DailyLogEntryRead])
def list_daily_logs(
    log_date: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[DailyLogEntryRead]:
    """Return all log entries for a specific day."""

    statement = (
        select(DailyLogEntry)
        .where(DailyLogEntry.log_date == log_date)
        .where(DailyLogEntry.owner_user_id == current_user.id)
    )
    statement = statement.order_by(DailyLogEntry.created_at, DailyLogEntry.id)
    results = db.exec(statement).all()
    return [DailyLogEntryRead.model_validate(entry) for entry in results]


@router.post("/", response_model=DailyLogEntryRead, status_code=201)
def create_daily_log(
    payload: DailyLogEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DailyLogEntryRead:
    """Persist a new daily log entry."""

    if payload.stored_food_id is not None:
        if not _stored_food_available(db, payload.stored_food_id, current_user):
            raise HTTPException(status_code=404, detail="Stored food not found")
    if payload.ingredient_id is not None:
        if not _ingredient_available(db, payload.ingredient_id, current_user):
            raise HTTPException(status_code=404, detail="Ingredient not found")
    if payload.food_id is not None:
        if not _food_available(db, payload.food_id, current_user):
            raise HTTPException(status_code=404, detail="Food not found")

    entry = DailyLogEntry(**payload.model_dump(), user_id=current_user.id, owner_user_id=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return DailyLogEntryRead.model_validate(entry)


@router.delete(
    "/{entry_id}", status_code=204, response_class=Response, response_model=None
)
def delete_daily_log(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a single daily log entry."""

    entry = db.exec(
        select(DailyLogEntry)
        .where(DailyLogEntry.id == entry_id)
        .where(DailyLogEntry.owner_user_id == current_user.id)
    ).one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Daily log entry not found")

    db.delete(entry)
    db.commit()


@router.delete("/", status_code=204, response_class=Response, response_model=None)
def clear_daily_logs(
    log_date: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove daily log entries for a user, optionally filtered by day."""

    statement = delete(DailyLogEntry).where(DailyLogEntry.owner_user_id == current_user.id)
    if log_date is not None:
        statement = statement.where(DailyLogEntry.log_date == log_date)

    db.exec(statement)
    db.commit()
