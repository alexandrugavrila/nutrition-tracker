import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.models import (
    Ingredient,
    IngredientUnit,
    Food,
    FoodIngredient,
    PossibleIngredientTag,
    PossibleFoodTag,
)


@pytest.mark.parametrize(
    "case",
    [
        "list",
        "get",
        "post",
        "put",
        "delete",
        "possible_tags",
    ],
)
def test_ingredient_endpoints(admin_client: TestClient, engine, case: str) -> None:
    """Test ingredient API endpoints for various cases."""
    with Session(engine) as session:
        if case in {"list", "get", "put", "delete"}:
            tag = PossibleIngredientTag(name="Spicy")
            ingredient = Ingredient(user_id="test-user", name="Pepper", units=[], tags=[tag])
            session.add(tag)
            session.add(ingredient)
            session.commit()
            ingredient_id = ingredient.id
        elif case == "post":
            tag = PossibleIngredientTag(name="Sweet")
            session.add(tag)
            session.commit()
            tag_id = tag.id
        elif case == "possible_tags":
            session.add(PossibleIngredientTag(name="Savory"))
            session.commit()

    if case == "list":
        response = admin_client.get("/api/ingredients/")
        assert response.status_code == 200
        assert any(item["name"] == "Pepper" for item in response.json())
    elif case == "get":
        response = admin_client.get(f"/api/ingredients/{ingredient_id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Pepper"
    elif case == "post":
        payload = {
            "name": "Onion",
            "nutrition": None,
            "units": [{"name": "g", "grams": 1}],
            "tags": [{"id": tag_id}],
        }
        response = admin_client.post("/api/ingredients/", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Onion"
        assert any(t["id"] == tag_id for t in data["tags"])
    elif case == "put":
        payload = {
            "name": "Pepper Updated",
            "nutrition": None,
            "units": [],
            "tags": [],
        }
        response = admin_client.put(f"/api/ingredients/{ingredient_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["name"] == "Pepper Updated"
    elif case == "delete":
        response = admin_client.delete(f"/api/ingredients/{ingredient_id}")
        assert response.status_code == 200
        assert response.json()["message"] == "Ingredient deleted successfully"
    elif case == "possible_tags":
        response = admin_client.get("/api/ingredients/possible_tags")
        assert response.status_code == 200
        assert any(tag["name"] == "Savory" for tag in response.json())


@pytest.mark.parametrize(
    "case",
    [
        "list",
        "get",
        "post",
        "put",
        "delete",
        "possible_tags",
    ],
)
def test_food_endpoints(admin_client: TestClient, engine, case: str) -> None:
    """Test food API endpoints for various cases."""
    with Session(engine) as session:
        if case in {"list", "get", "put", "delete"}:
            ingredient = Ingredient(
                user_id="test-user",
                name="Rice",
                units=[IngredientUnit(name="g", grams=1)],
            )
            tag = PossibleFoodTag(name="Dinner")
            session.add_all([ingredient, tag])
            session.commit()
            ingredient_id = ingredient.id
            unit_id = ingredient.units[0].id
            food = Food(
                user_id="test-user",
                name="Rice Bowl",
                ingredients=[
                    FoodIngredient(
            user_id="test-user",
                        ingredient_id=ingredient_id,
                        unit_id=unit_id,
                        unit_quantity=100,
                    )
                ],
                tags=[tag],
            )
            session.add(food)
            session.commit()
            food_id = food.id
        elif case == "post":
            ingredient = Ingredient(
                user_id="test-user",
                name="Beans",
                units=[IngredientUnit(name="g", grams=1)],
            )
            tag = PossibleFoodTag(name="Lunch")
            session.add_all([ingredient, tag])
            session.commit()
            ingredient_id = ingredient.id
            unit_id = ingredient.units[0].id
            tag_id = tag.id
        elif case == "possible_tags":
            session.add(PossibleFoodTag(name="Snack"))
            session.commit()

    if case == "list":
        response = admin_client.get("/api/foods/")
        assert response.status_code == 200
        assert any(item["name"] == "Rice Bowl" for item in response.json())
    elif case == "get":
        response = admin_client.get(f"/api/foods/{food_id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Rice Bowl"
    elif case == "post":
        payload = {
            "name": "Bean Salad",
            "ingredients": [
                {
                    "ingredient_id": ingredient_id,
                    "unit_id": unit_id,
                    "unit_quantity": 50,
                }
            ],
            "tags": [{"id": tag_id}],
        }
        response = admin_client.post("/api/foods/", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Bean Salad"
        assert data["ingredients"][0]["ingredient_id"] == ingredient_id
        assert any(t["id"] == tag_id for t in data["tags"])
    elif case == "put":
        payload = {
            "name": "Rice Bowl Updated",
            "ingredients": [
                {
                    "ingredient_id": ingredient_id,
                    "unit_id": unit_id,
                    "unit_quantity": 150,
                }
            ],
            "tags": [],
        }
        response = admin_client.put(f"/api/foods/{food_id}", json=payload)
        assert response.status_code == 200
        assert response.json()["name"] == "Rice Bowl Updated"
    elif case == "delete":
        response = admin_client.delete(f"/api/foods/{food_id}")
        assert response.status_code == 200
        assert response.json()["message"] == "Food deleted successfully"
    elif case == "possible_tags":
        response = admin_client.get("/api/foods/possible_tags")
        assert response.status_code == 200
        assert any(tag["name"] == "Snack" for tag in response.json())


def test_food_create_with_synthetic_unit_id_resolves_to_real_unit(
    admin_client: TestClient, engine
) -> None:
    """Creating a food with ``unit_id`` 0 should link to the ingredient's real unit."""

    with Session(engine) as session:
        ingredient = Ingredient(
            user_id="test-user",
            name="Synthetic Unit Ingredient",
            units=[
                IngredientUnit(name="g", grams=1),
                IngredientUnit(name="cup", grams=120),
            ],
        )
        session.add(ingredient)
        session.commit()
        session.refresh(ingredient)
        ingredient_id = ingredient.id
        canonical_unit_id = next(u.id for u in ingredient.units if u.name == "g")

    payload = {
        "name": "Synthetic Salad",
        "ingredients": [
            {
                "ingredient_id": ingredient_id,
                "unit_id": 0,
                "unit_quantity": 2.5,
            }
        ],
        "tags": [],
    }

    response = admin_client.post("/api/foods/", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["name"] == "Synthetic Salad"
    assert len(data["ingredients"]) == 1
    ingredient_payload = data["ingredients"][0]
    assert ingredient_payload["unit_id"] == canonical_unit_id
    assert ingredient_payload["ingredient_id"] == ingredient_id
    assert ingredient_payload["unit_quantity"] == pytest.approx(2.5)

    with Session(engine) as session:
        rows = session.exec(select(FoodIngredient)).all()
        assert len(rows) == 1
        fi = rows[0]
        assert fi.food_id == data["id"]
        assert fi.ingredient_id == ingredient_id
        assert fi.unit_id == canonical_unit_id
        assert fi.unit_quantity == pytest.approx(2.5)


def test_food_update_with_synthetic_unit_id_preserves_other_fields(
    admin_client: TestClient, engine
) -> None:
    """Updating with ``unit_id`` 0 should resolve to the real unit without side effects."""

    with Session(engine) as session:
        ingredient = Ingredient(
            user_id="test-user",
            name="Existing Ingredient",
            units=[IngredientUnit(name="g", grams=1)],
        )
        session.add(ingredient)
        session.commit()
        session.refresh(ingredient)
        ingredient_id = ingredient.id
        canonical_unit_id = ingredient.units[0].id

        food = Food(
            user_id="test-user",
            name="Original Food",
            ingredients=[
                FoodIngredient(
            user_id="test-user",
                    ingredient_id=ingredient_id,
                    unit_id=canonical_unit_id,
                    unit_quantity=1.0,
                )
            ],
        )
        session.add(food)
        session.commit()
        session.refresh(food)
        food_id = food.id

    update_payload = {
        "name": "Updated Food",
        "ingredients": [
            {
                "ingredient_id": ingredient_id,
                "unit_id": 0,
                "unit_quantity": 3.75,
            }
        ],
        "tags": [],
    }

    response = admin_client.put(f"/api/foods/{food_id}", json=update_payload)
    assert response.status_code == 200
    updated = response.json()

    assert updated["id"] == food_id
    assert updated["name"] == "Updated Food"
    assert updated["tags"] == []
    assert len(updated["ingredients"]) == 1
    updated_ingredient = updated["ingredients"][0]
    assert updated_ingredient["ingredient_id"] == ingredient_id
    assert updated_ingredient["unit_id"] == canonical_unit_id
    assert updated_ingredient["unit_quantity"] == pytest.approx(3.75)

    with Session(engine) as session:
        rows = session.exec(select(FoodIngredient)).all()
        assert len(rows) == 1
        fi = rows[0]
        assert fi.food_id == food_id
        assert fi.ingredient_id == ingredient_id
        assert fi.unit_id == canonical_unit_id
        assert fi.unit_quantity == pytest.approx(3.75)
