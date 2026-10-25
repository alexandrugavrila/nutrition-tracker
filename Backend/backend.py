"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from Backend.db import Base, engine
from Backend.routes import (
    ingredients_router,
    foods_router,
    plans_router,
    stored_food_router,
    logs_router,
    usda_router,
    health_router,
    auth_router,
)
from Backend.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup and shutdown logic for the application."""
    if settings.db_auto_create:
        Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(lifespan=lifespan)

from starlette.responses import JSONResponse
from Backend.auth.security import trusted_origin


@app.middleware("http")
async def validate_cookie_origin(request, call_next):
    if not trusted_origin(request, settings):
        return JSONResponse({"detail": "Untrusted or missing request origin."}, status_code=403)
    return await call_next(request)


# Credentialed cross-origin reads require explicit origins; wildcard is never trusted.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in settings.allow_origins if origin != "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Account-Mismatch"],
)

# Prefix all API routes with /api so the frontend can proxy requests.
app.include_router(ingredients_router, prefix="/api")
app.include_router(foods_router, prefix="/api")
app.include_router(plans_router, prefix="/api")
app.include_router(stored_food_router, prefix="/api")
app.include_router(logs_router, prefix="/api")
app.include_router(usda_router, prefix="/api")
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")


__all__ = ["app"]
