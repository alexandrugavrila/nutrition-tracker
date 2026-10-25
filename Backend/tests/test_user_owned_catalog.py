from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.auth.passwords import hash_password
from Backend.models import (
    Food,
    Ingredient,
    IngredientSource,
    IngredientUnit,
    Plan,
    StoredFood,
    User,
)
from Backend.services.onboarding import seed_user_starter_data


def _create_user(session: Session, email: str, user_id: str) -> User:
    user = User(
        id=user_id,
        email=email,
        password_hash=hash_password("Password123!"),
        display_name=email,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _login(client: TestClient, email: str) -> None:
    client.cookies.clear()
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "Password123!"},
    )
    assert response.status_code == 200


def test_global_and_private_ingredients_are_scoped(anonymous_client: TestClient, engine) -> None:
    with Session(engine) as session:
        user_a = _create_user(session, "a@example.com", "user-a")
        user_b = _create_user(session, "b@example.com", "user-b")
        global_ing = Ingredient(name="USDA Banana", user_id=None, is_shared=True)
        global_ing.sources.append(IngredientSource(source="usda", source_id="123", verification_status="verified", verified_at=datetime.now(timezone.utc), artifact_sha256="a" * 64, normalization_version="test-v1"))
        private_a = Ingredient(name="Private Spice", user_id=user_a.id)
        private_b = Ingredient(name="Private Spice", user_id=user_b.id)
        session.add_all([global_ing, private_a, private_b])
        session.flush()
        from Backend.models import CatalogSelection
        session.add(CatalogSelection(user_id=user_a.id, ingredient_id=global_ing.id))
        session.commit()

    _login(anonymous_client, "a@example.com")
    response = anonymous_client.get("/api/ingredients/")
    assert response.status_code == 200
    names = [item["name"] for item in response.json()]
    assert "USDA Banana" in names
    assert names.count("Private Spice") == 1

    create_response = anonymous_client.post(
        "/api/ingredients/",
        json={"name": "Private Spice", "nutrition": None, "units": [], "tags": []},
    )
    assert create_response.status_code == 409


def test_foods_can_reference_global_and_owner_private_ingredients(
    anonymous_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        user_a = _create_user(session, "food-a@example.com", "food-user-a")
        user_b = _create_user(session, "food-b@example.com", "food-user-b")
        global_ing = Ingredient(
            name="Global Rice",
            user_id=None, is_shared=True,
            sources=[IngredientSource(source="usda", source_id="rice", verification_status="verified", verified_at=datetime.now(timezone.utc), artifact_sha256="a" * 64, normalization_version="test-v1")],
            units=[IngredientUnit(name="g", grams=1)],
        )
        private_a = Ingredient(
            name="User A Sauce",
            user_id=user_a.id,
            units=[IngredientUnit(name="g", grams=1)],
        )
        private_b = Ingredient(
            name="User B Sauce",
            user_id=user_b.id,
            units=[IngredientUnit(name="g", grams=1)],
        )
        session.add_all([global_ing, private_a, private_b])
        session.flush()
        from Backend.models import CatalogSelection
        session.add(CatalogSelection(user_id=user_a.id, ingredient_id=global_ing.id))
        session.commit()
        global_id = global_ing.id
        global_unit_id = global_ing.units[0].id
        private_a_id = private_a.id
        private_a_unit_id = private_a.units[0].id
        private_b_id = private_b.id
        private_b_unit_id = private_b.units[0].id

    _login(anonymous_client, "food-a@example.com")
    response = anonymous_client.post(
        "/api/foods/",
        json={
            "name": "Rice Bowl",
            "ingredients": [
                {"ingredient_id": global_id, "unit_id": global_unit_id, "unit_quantity": 100},
                {
                    "ingredient_id": private_a_id,
                    "unit_id": private_a_unit_id,
                    "unit_quantity": 10,
                },
            ],
            "tags": [],
        },
    )
    assert response.status_code == 201

    forbidden = anonymous_client.post(
        "/api/foods/",
        json={
            "name": "Other Sauce Bowl",
            "ingredients": [
                {
                    "ingredient_id": private_b_id,
                    "unit_id": private_b_unit_id,
                    "unit_quantity": 10,
                }
            ],
            "tags": [],
        },
    )
    assert forbidden.status_code == 404


def test_admin_created_user_starts_empty(admin_client: TestClient, engine) -> None:
    response = admin_client.post(
        "/api/auth/users",
        json={
            "email": "starter@example.com",
            "password": "Password123!",
            "display_name": "Starter User",
            "is_admin": False,
        },
    )
    assert response.status_code == 201
    user_id = response.json()["id"]

    with Session(engine) as session:
        ingredients = session.exec(select(Ingredient).where(Ingredient.user_id == user_id)).all()
        foods = session.exec(select(Food).where(Food.user_id == user_id)).all()
        plans = session.exec(select(Plan).where(Plan.user_id == user_id)).all()
        assert [item.name for item in ingredients] == []
        assert [item.name for item in foods] == []
        assert [item.label for item in plans] == []


def test_admin_created_admin_starts_empty(admin_client: TestClient, engine) -> None:
    response = admin_client.post(
        "/api/auth/users",
        json={
            "email": "starter-admin@example.com",
            "password": "Password123!",
            "display_name": "Starter Admin",
            "is_admin": True,
        },
    )
    assert response.status_code == 201
    user_id = response.json()["id"]

    with Session(engine) as session:
        ingredients = session.exec(select(Ingredient).where(Ingredient.user_id == user_id)).all()
        foods = session.exec(select(Food).where(Food.user_id == user_id)).all()
        plans = session.exec(select(Plan).where(Plan.user_id == user_id)).all()
        assert [item.name for item in ingredients] == []
        assert [item.name for item in foods] == []
        assert [item.label for item in plans] == []


def test_stored_food_ignores_client_supplied_user_id(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = Ingredient(
            name="Personal Lentils",
            user_id="test-user",
            units=[IngredientUnit(name="g", grams=1)],
        )
        session.add(ingredient)
        session.commit()
        ingredient_id = ingredient.id

    response = admin_client.post(
        "/api/stored_food/",
        json={
            "user_id": "spoofed-user",
            "ingredient_id": ingredient_id,
            "prepared_portions": 1,
            "per_portion_calories": 100,
            "per_portion_protein": 10,
            "per_portion_carbohydrates": 10,
            "per_portion_fat": 1,
            "per_portion_fiber": 5,
        },
    )
    assert response.status_code == 201
    stored_id = response.json()["id"]

    with Session(engine) as session:
        stored = session.get(StoredFood, stored_id)
        assert stored is not None
        assert stored.user_id == "test-user"


def test_seed_user_starter_data_is_idempotent(engine) -> None:
    with Session(engine) as session:
        user = _create_user(session, "idempotent@example.com", "idempotent-user")
        first = seed_user_starter_data(session, user)
        second = seed_user_starter_data(session, user)
        session.commit()
        assert first == {"ingredients": 1, "foods": 1, "plans": 1}
        assert second == {"ingredients": 0, "foods": 0, "plans": 0}
