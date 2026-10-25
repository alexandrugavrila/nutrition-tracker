"""Router exports for the Backend routes package."""

from .ingredients import router as ingredients_router
from .foods import router as foods_router
from .plans import router as plans_router
from .stored_food import router as stored_food_router
from .logs import router as logs_router
from .usda import router as usda_router
from .health import router as health_router
from .auth import router as auth_router

__all__ = [
    "ingredients_router",
    "foods_router",
    "plans_router",
    "stored_food_router",
    "logs_router",
    "usda_router",
    "health_router",
    "auth_router",
]
