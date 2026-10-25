from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.models.ingredient import Ingredient
from Backend.models.ingredient_unit import IngredientUnit


def test_ingredient_crud(user_a_client: TestClient) -> None:
    response = user_a_client.post(
        "/api/ingredients/",
        json={"name": "Carrot", "nutrition": None, "units": [], "tags": []},
    )
    assert response.status_code == 201
    ingredient = response.json()
    ingredient_id = ingredient["id"]
    assert ingredient["name"] == "Carrot"

    response = user_a_client.get("/api/ingredients/")
    assert response.status_code == 200
    assert any(item["id"] == ingredient_id for item in response.json())

    response = user_a_client.get(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Carrot"

    response = user_a_client.put(
        f"/api/ingredients/{ingredient_id}",
        json={
            "id": ingredient_id,
            "name": "Carrot Updated",
            "nutrition": None,
            "units": [],
            "tags": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Carrot Updated"

    response = user_a_client.delete(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 200
    response = user_a_client.get(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 404


def test_ingredient_update_with_shopping_unit_id_only(user_a_client: TestClient) -> None:
    """Selecting a preferred unit by id should not require the relationship to be loaded."""

    create_payload = {
        "name": "Rolled Oats",
        "nutrition": None,
        "units": [
            {"name": "cup", "grams": 85},
            {"name": "g", "grams": 1},
        ],
        "tags": [],
    }
    response = user_a_client.post("/api/ingredients/", json=create_payload)
    assert response.status_code == 201
    ingredient = response.json()

    gram_unit = next(unit for unit in ingredient["units"] if unit["name"] == "g")
    update_payload = {
        "name": ingredient["name"],
        "nutrition": None,
        "units": [
            {
                "id": unit["id"],
                "name": unit["name"],
                "grams": unit["grams"],
            }
            for unit in ingredient["units"]
            if unit["name"] != "g"
        ],
        "tags": [],
        "shopping_unit": {
            "unit_id": gram_unit["id"],
            "name": gram_unit["name"],
            "grams": gram_unit["grams"],
        },
    }

    response = user_a_client.put(f"/api/ingredients/{ingredient['id']}", json=update_payload)
    assert response.status_code == 200
    updated = response.json()
    assert updated["shopping_unit_id"] == gram_unit["id"]
    assert updated["shopping_unit"]["name"] == "g"

    response = user_a_client.get("/api/ingredients/")
    assert response.status_code == 200
    fetched = next(item for item in response.json() if item["id"] == ingredient["id"])
    assert fetched["shopping_unit_id"] == gram_unit["id"]
    assert fetched["shopping_unit"]["name"] == "g"


def test_update_ingredient_rejects_invalid_shopping_units(
    admin_client: TestClient, engine
) -> None:
    """Ensure shopping unit updates validate ownership before applying changes."""

    with Session(engine) as session:
        ingredient = Ingredient(
            user_id="test-user",
            name="Bulk Sugar",
            units=[
                IngredientUnit(name="cup", grams=200.0),
                IngredientUnit(name="g", grams=1.0),
            ],
        )
        session.add(ingredient)
        session.commit()
        session.refresh(ingredient)
        units = session.exec(
            select(IngredientUnit).where(IngredientUnit.ingredient_id == ingredient.id)
        ).all()

    ingredient_id = ingredient.id
    unit_payloads = [
        {"id": unit.id, "name": unit.name, "grams": unit.grams} for unit in units
    ]
    valid_unit_id = next(unit["id"] for unit in unit_payloads if unit["name"] == "g")
    invalid_unit_id = max(unit["id"] for unit in unit_payloads) + 999

    base_payload = {
        "name": ingredient.name,
        "nutrition": None,
        "units": unit_payloads,
        "tags": [],
    }

    response = admin_client.put(
        f"/api/ingredients/{ingredient_id}",
        json={**base_payload, "shopping_unit_id": invalid_unit_id},
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Preferred shopping unit must belong to the ingredient."
    }

    response = admin_client.put(
        f"/api/ingredients/{ingredient_id}",
        json={**base_payload, "shopping_unit": {"unit_id": invalid_unit_id}},
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Preferred shopping unit must belong to the ingredient."
    }

    response = admin_client.put(
        f"/api/ingredients/{ingredient_id}",
        json={**base_payload, "shopping_unit_id": valid_unit_id},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["shopping_unit_id"] == valid_unit_id
    assert payload["shopping_unit"]["name"] == "g"


def test_food_crud(user_a_client: TestClient) -> None:
    response = user_a_client.post(
        "/api/foods",
        json={"name": "Test Food", "ingredients": [], "tags": []},
    )
    assert response.status_code == 201
    food = response.json()
    food_id = food["id"]
    assert food["name"] == "Test Food"

    response = user_a_client.get("/api/foods")
    assert response.status_code == 200
    assert any(item["id"] == food_id for item in response.json())

    response = user_a_client.get(f"/api/foods/{food_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Test Food"

    response = user_a_client.put(
        f"/api/foods/{food_id}",
        json={
            "id": food_id,
            "name": "Updated Food",
            "ingredients": [],
            "tags": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Food"

    response = user_a_client.delete(f"/api/foods/{food_id}")
    assert response.status_code == 200
    response = user_a_client.get(f"/api/foods/{food_id}")
    assert response.status_code == 404
