"""A user's selection of an immutable external catalog ingredient."""

from sqlalchemy import Column, ForeignKey, String, Integer
from sqlmodel import SQLModel, Field


class CatalogSelection(SQLModel, table=True):
    __tablename__ = "catalog_selections"
    user_id: str = Field(sa_column=Column(String(36), ForeignKey("users.id"), primary_key=True))
    ingredient_id: int = Field(
        sa_column=Column(Integer, ForeignKey("ingredients.id"), primary_key=True)
    )


class LoginBudget(SQLModel, table=True):
    __tablename__ = "login_budgets"
    key: str = Field(sa_column=Column(String(64), primary_key=True))
    window: int = Field(sa_column=Column(Integer, nullable=False))
    attempts: int = Field(sa_column=Column(Integer, nullable=False))
