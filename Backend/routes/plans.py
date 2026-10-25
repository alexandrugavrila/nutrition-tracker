from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..auth.dependencies import get_current_user
from ..db import get_db
from ..services.references import validate_plan
from ..models import Plan, PlanCreate, PlanRead, PlanUpdate, User

router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("/", response_model=List[PlanRead])
def list_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[PlanRead]:
    """Return all saved plans ordered by last update descending."""
    statement = (
        select(Plan)
        .where(Plan.user_id == current_user.id)
        .order_by(Plan.updated_at.desc(), Plan.id.asc())
    )
    plans = db.exec(statement).all()
    return [PlanRead.model_validate(plan) for plan in plans]


@router.get("/{plan_id}", response_model=PlanRead)
def get_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlanRead:
    """Retrieve a single plan by ID."""
    plan = db.exec(
        select(Plan).where(Plan.id == plan_id).where(Plan.user_id == current_user.id)
    ).one_or_none()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found"
        )
    return PlanRead.model_validate(plan)


@router.post("/", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def create_plan(
    payload: PlanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlanRead:
    """Persist a new plan payload."""
    validate_plan(db, current_user.id, payload.payload)
    plan = Plan(
        label=payload.label.strip(),
        payload=payload.payload,
        user_id=current_user.id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return PlanRead.model_validate(plan)


@router.put("/{plan_id}", response_model=PlanRead)
def update_plan(
    plan_id: int,
    payload: PlanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlanRead:
    """Update an existing plan."""
    plan = db.exec(
        select(Plan).where(Plan.id == plan_id).where(Plan.user_id == current_user.id)
    ).one_or_none()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found"
        )

    if payload.label is not None:
        plan.label = payload.label.strip()
    if payload.payload is not None:
        validate_plan(db, current_user.id, payload.payload)
        plan.payload = payload.payload

    db.add(plan)
    db.commit()
    db.refresh(plan)
    return PlanRead.model_validate(plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an existing plan."""
    plan = db.exec(
        select(Plan).where(Plan.id == plan_id).where(Plan.user_id == current_user.id)
    ).one_or_none()
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found"
        )
    db.delete(plan)
    db.commit()
    return None


__all__ = ["router"]
