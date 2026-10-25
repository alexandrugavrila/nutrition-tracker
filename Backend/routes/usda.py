from __future__ import annotations

from typing import Any, Iterable, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from Backend.settings import settings

from Backend.auth.dependencies import get_current_user

router = APIRouter(prefix="/usda", tags=["usda"], dependencies=[Depends(get_current_user)])

_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
from Backend.services.usda_normalization import (
    UsdaSearchResponse,
    UsdaFoodSummary,
    USDADataType,
    _DEFAULT_USDA_DATA_TYPES,
    _trim_food_payload,
)


def _require_api_key():
    if not settings.usda_api_key:
        raise HTTPException(status_code=503, detail="USDA is unavailable.")
    return settings.usda_api_key


@router.get("/search", response_model=UsdaSearchResponse)
async def search_foods(
    query: str = Query(..., min_length=1),
    data_types: list[USDADataType] | None = Query(default=None),
) -> dict[str, Any]:
    api_key = _require_api_key()
    selected_data_types = data_types or _DEFAULT_USDA_DATA_TYPES
    params = {
        "query": query,
        "pageSize": 25,
        "dataType": selected_data_types,
        "api_key": api_key,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{_BASE_URL}/foods/search", params=params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail="USDA request failed. Please try again later."
            ) from exc

    try:
        payload = response.json()
        foods = [_trim_food_payload(food) for food in payload.get("foods", [])]
        return {"foods": foods}
    except (ValueError, TypeError, AttributeError, KeyError, OverflowError) as exc:
        raise HTTPException(502, "USDA returned invalid data.") from exc


@router.get("/foods/{fdc_id}", response_model=UsdaFoodSummary)
async def get_food_details(fdc_id: int) -> dict[str, Any]:
    api_key = _require_api_key()
    params = {"api_key": api_key}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{_BASE_URL}/food/{fdc_id}", params=params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail="USDA request failed. Please try again later."
            ) from exc

    try:
        return _trim_food_payload(response.json())
    except (ValueError, TypeError, AttributeError, KeyError, OverflowError) as exc:
        raise HTTPException(502, "USDA returned invalid data.") from exc


from fastapi import Body
from sqlmodel import Session
from Backend.db import get_db
from Backend.models import User
from Backend.models.schemas import IngredientRead


@router.post("/import/{fdc_id}", response_model=IngredientRead)
async def import_food(
    fdc_id: int,
    body: dict | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not 0 < fdc_id < 2147483648 or body not in (None, {}):
        raise HTTPException(422, "Provide only a valid USDA identifier in the URL.")
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(
                f"{_BASE_URL}/food/{fdc_id}", params={"api_key": _require_api_key()}
            )
            response.raise_for_status()
            raw = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, "USDA request failed. Please try again later.") from exc
    from Backend.services.catalog import import_verified
    from Backend.routes.ingredients import ingredient_to_read

    ingredient = import_verified(db, user, fdc_id, raw)
    db.commit()
    db.refresh(ingredient)
    return ingredient_to_read(ingredient, db, user)
