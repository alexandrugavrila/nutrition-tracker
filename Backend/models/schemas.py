import math
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import ConfigDict, model_validator
from sqlmodel import SQLModel, Field

from .ingredient_unit import IngredientUnit
from .nutrition import Nutrition
from .food_ingredient import FoodIngredient
from .possible_ingredient_tag import PossibleIngredientTag
from .possible_food_tag import PossibleFoodTag


class NutritionCreate(SQLModel):
    """Schema for creating nutrition data."""

    model_config = ConfigDict(allow_inf_nan=False)

    calories: float | None = Field(default=None, ge=0)
    fat: float | None = Field(default=None, ge=0)
    carbohydrates: float | None = Field(default=None, ge=0)
    protein: float | None = Field(default=None, ge=0)
    fiber: float | None = Field(default=None, ge=0)


class IngredientUnitCreate(SQLModel):
    """Schema for creating ingredient unit data."""

    name: str
    grams: float


class IngredientUnitUpdate(SQLModel):
    """Schema for updating ingredient unit data (allows id for upsert)."""

    id: Optional[int] = None
    name: str
    grams: float


class IngredientShoppingUnitSelection(SQLModel):
    """Payload for selecting a preferred shopping unit."""

    unit_id: Optional[int] = None
    name: Optional[str] = None
    grams: Optional[float] = None


class FoodIngredientCreate(SQLModel):
    """Schema for creating food ingredient linkage."""

    ingredient_id: int
    unit_id: Optional[int] = None
    unit_quantity: Optional[float] = None


class TagRef(SQLModel):
    """Reference to an existing tag by ID."""

    id: int


class IngredientCreate(SQLModel):
    """Schema for creating an ingredient."""

    @model_validator(mode="before")
    @classmethod
    def reject_catalog_claims(cls, value):
        if isinstance(value, dict):
            protected = {
                "is_shared",
                "verification_status",
                "provenance_status",
                "artifact_sha256",
                "import_run_id",
                "user_id",
                "sources",
                "verified_at",
                "normalization_version",
                "payload_hash",
                "last_synced_at",
                "is_stale",
                "owner_user_id",
            }
            if (
                protected.intersection(value)
                or value.get("source") not in (None, "", "manual")
                or value.get("source_id") not in (None, "")
            ):
                raise ValueError(
                    "Provider provenance and ownership are server-managed; use USDA import or a personal copy."
                )
        return value

    name: str
    source: Optional[str] = None
    source_id: Optional[str] = None
    nutrition: Optional[NutritionCreate] = None
    units: List[IngredientUnitCreate] = Field(default_factory=list)
    tags: List[TagRef] = Field(default_factory=list)
    shopping_unit_id: Optional[int] = None
    shopping_unit: Optional[IngredientShoppingUnitSelection] = None


class IngredientUpdate(SQLModel):
    """Schema for updating an ingredient."""

    @model_validator(mode="before")
    @classmethod
    def reject_catalog_claims(cls, value):
        if isinstance(value, dict):
            protected = {
                "is_shared",
                "verification_status",
                "provenance_status",
                "artifact_sha256",
                "import_run_id",
                "user_id",
                "sources",
                "verified_at",
                "normalization_version",
                "payload_hash",
                "last_synced_at",
                "is_stale",
                "owner_user_id",
            }
            if (
                protected.intersection(value)
                or value.get("source") not in (None, "", "manual")
                or value.get("source_id") not in (None, "")
            ):
                raise ValueError(
                    "Provider provenance and ownership are server-managed; use USDA import or a personal copy."
                )
        return value

    name: str
    source: Optional[str] = None
    source_id: Optional[str] = None
    nutrition: Optional[NutritionCreate] = None
    # Accept units with optional id for proper upsert behavior
    units: List[IngredientUnitUpdate] = Field(default_factory=list)
    tags: List[TagRef] = Field(default_factory=list)
    shopping_unit_id: Optional[int] = None
    shopping_unit: Optional[IngredientShoppingUnitSelection] = None


class IngredientRead(SQLModel):
    """Schema for reading ingredient data."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[str] = None
    is_shared: bool = False
    provenance_status: Literal["unverified", "verified", "rejected"] = "unverified"
    name: str
    source: Optional[str] = None
    source_id: Optional[str] = None
    nutrition: Optional[Nutrition] = None
    units: List[IngredientUnit] = Field(default_factory=list)
    tags: List[PossibleIngredientTag] = Field(default_factory=list)
    shopping_unit_id: Optional[int] = None
    shopping_unit: Optional[IngredientUnit] = None


class FoodCreate(SQLModel):
    """Schema for creating a food."""

    name: str
    ingredients: List[FoodIngredientCreate] = Field(default_factory=list)
    tags: List[TagRef] = Field(default_factory=list)


class FoodUpdate(FoodCreate):
    """Schema for updating a food."""

    pass


class FoodRead(SQLModel):
    """Schema for reading food data."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[str] = None
    name: str
    ingredients: List[FoodIngredient] = Field(default_factory=list)
    tags: List[PossibleFoodTag] = Field(default_factory=list)


class PlanCreate(SQLModel):
    """Payload required to persist a plan."""

    label: str
    payload: Dict[str, Any]


class PlanUpdate(SQLModel):
    """Fields allowed when updating a persisted plan."""

    label: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class PlanRead(SQLModel):
    """Representation of a saved plan returned from the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[str] = None
    label: str
    payload: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class LoginRequest(SQLModel):
    """Credentials required to create a session."""

    email: str = Field(max_length=255)
    password: str = Field(min_length=1, max_length=1024)


class UserCreate(SQLModel):
    """Payload for an admin-created user account."""

    email: str
    password: str = Field(min_length=1, max_length=1024)
    display_name: str
    is_admin: bool = False


class UserRead(SQLModel):
    """Safe user representation returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str
    is_active: bool
    is_admin: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ChangePasswordRequest(SQLModel):
    """Payload for changing the current user's password."""

    current_password: str
    new_password: str = Field(min_length=1, max_length=1024)


class AuthStatus(SQLModel):
    """Current authentication state returned by auth endpoints."""

    authenticated: bool
    user: Optional[UserRead] = None


class StoredFoodBase(SQLModel):
    """Common fields shared by stored food payloads."""

    label: Optional[str] = None
    food_id: Optional[int] = None
    ingredient_id: Optional[int] = None
    prepared_portions: float
    per_portion_calories: float | None = Field(default=None, ge=0)
    per_portion_protein: float | None = Field(default=None, ge=0)
    per_portion_carbohydrates: float | None = Field(default=None, ge=0)
    per_portion_fat: float | None = Field(default=None, ge=0)
    per_portion_fiber: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _validate_source(self) -> "StoredFoodBase":
        """Ensure exactly one of food_id or ingredient_id is provided."""

        if bool(self.food_id) == bool(self.ingredient_id):
            raise ValueError("Provide either food_id or ingredient_id, but not both.")

        numeric_fields = {
            "prepared_portions": self.prepared_portions,
            "per_portion_calories": self.per_portion_calories,
            "per_portion_protein": self.per_portion_protein,
            "per_portion_carbohydrates": self.per_portion_carbohydrates,
            "per_portion_fat": self.per_portion_fat,
            "per_portion_fiber": self.per_portion_fiber,
        }
        for field, value in numeric_fields.items():
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"{field} cannot be negative")
        return self


class StoredFoodCreate(StoredFoodBase):
    """Schema for creating stored food entries."""

    remaining_portions: Optional[float] = None
    prepared_at: Optional[datetime] = None


class StoredFoodRead(StoredFoodBase):
    """Schema returned when reading stored food entries."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_user_id: Optional[str] = None
    user_id: str
    remaining_portions: float
    is_finished: bool
    prepared_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class StoredFoodConsume(SQLModel):
    """Payload for consuming stored food portions."""

    portions: float


class DailyLogEntryBase(SQLModel):
    """Shared fields for daily log entry payloads."""

    log_date: date
    stored_food_id: Optional[int] = None
    ingredient_id: Optional[int] = None
    food_id: Optional[int] = None
    portions_consumed: float
    calories: float | None = Field(default=None, ge=0)
    protein: float | None = Field(default=None, ge=0)
    carbohydrates: float | None = Field(default=None, ge=0)
    fat: float | None = Field(default=None, ge=0)
    fiber: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _validate_source(self) -> "DailyLogEntryBase":
        """Ensure exactly one source reference is provided."""

        provided = [
            self.stored_food_id is not None,
            self.ingredient_id is not None,
            self.food_id is not None,
        ]
        if sum(provided) != 1:
            raise ValueError(
                "Provide exactly one of stored_food_id, ingredient_id, or food_id.",
            )
        if self.portions_consumed <= 0:
            raise ValueError("portions_consumed must be greater than zero")

        macro_fields = {
            "calories": self.calories,
            "protein": self.protein,
            "carbohydrates": self.carbohydrates,
            "fat": self.fat,
            "fiber": self.fiber,
        }
        for field, value in macro_fields.items():
            if value is not None and (not math.isfinite(value) or value < 0):
                raise ValueError(f"{field} cannot be negative")
        return self


class DailyLogEntryCreate(DailyLogEntryBase):
    """Schema for creating a new daily log entry."""

    pass


class DailyLogEntryRead(DailyLogEntryBase):
    """Schema returned when reading daily log entries."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_user_id: Optional[str] = None
    user_id: str
    created_at: datetime


__all__ = [
    "NutritionCreate",
    "IngredientUnitCreate",
    "IngredientShoppingUnitSelection",
    "FoodIngredientCreate",
    "TagRef",
    "IngredientCreate",
    "IngredientUpdate",
    "IngredientRead",
    "FoodCreate",
    "FoodUpdate",
    "FoodRead",
    "PlanCreate",
    "PlanUpdate",
    "PlanRead",
    "LoginRequest",
    "UserCreate",
    "UserRead",
    "ChangePasswordRequest",
    "AuthStatus",
    "StoredFoodCreate",
    "StoredFoodRead",
    "StoredFoodConsume",
    "DailyLogEntryCreate",
    "DailyLogEntryRead",
]
