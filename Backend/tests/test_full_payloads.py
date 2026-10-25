import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from Backend.models import PossibleIngredientTag, PossibleFoodTag


def test_full_ingredient_crud(user_a_client: TestClient, engine) -> None:
    with Session(engine) as session:
        spicy = PossibleIngredientTag(name="Spicy")
        sweet = PossibleIngredientTag(name="Sweet")
        session.add(spicy)
        session.add(sweet)
        session.commit()
        spicy_id = spicy.id
        sweet_id = sweet.id

    payload = {
        "name": "Carrot",
        "nutrition": {
            "calories": 41.0,
            "fat": 0.2,
            "carbohydrates": 9.6,
            "protein": 0.9,
            "fiber": 2.8,
        },
        "units": [
            {"name": "gram", "grams": 1.0},
            {"name": "cup", "grams": 128.0},
        ],
        "tags": [{"id": spicy_id}, {"id": sweet_id}],
    }

    response = user_a_client.post("/api/ingredients/", json=payload)
    assert response.status_code == 201
    ingredient = response.json()
    ingredient_id = ingredient["id"]
    assert ingredient["nutrition"]["calories"] == pytest.approx(41.0)
    assert len(ingredient["units"]) == 3
    assert {t["name"] for t in ingredient["tags"]} == {"Spicy", "Sweet"}

    response = user_a_client.get(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 200
    fetched = response.json()
    nutrition_id = fetched["nutrition"]["id"]
    unit_ids = [u["id"] for u in fetched["units"]]

    update_payload = {
        "id": ingredient_id,
        "name": "Carrot Updated",
        "nutrition": {
            "id": nutrition_id,
            "ingredient_id": ingredient_id,
            "calories": 50.0,
            "fat": 0.3,
            "carbohydrates": 10.0,
            "protein": 1.0,
            "fiber": 3.0,
        },
        "units": [
            {
                "id": unit_ids[0],
                "ingredient_id": ingredient_id,
                "name": "gram",
                "grams": 1.0,
            },
            {
                "id": unit_ids[1],
                "ingredient_id": ingredient_id,
                "name": "cup",
                "grams": 128.0,
            },
        ],
        "tags": [{"id": spicy_id}],
    }

    response = user_a_client.put(f"/api/ingredients/{ingredient_id}", json=update_payload)
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Carrot Updated"
    assert updated["nutrition"]["calories"] == pytest.approx(50.0)
    assert len(updated["tags"]) == 1 and updated["tags"][0]["name"] == "Spicy"

    response = user_a_client.delete(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 200
    response = user_a_client.get(f"/api/ingredients/{ingredient_id}")
    assert response.status_code == 404


def test_full_food_crud(user_a_client: TestClient, engine) -> None:
    with Session(engine) as session:
        food_tag1 = PossibleFoodTag(name="Breakfast")
        food_tag2 = PossibleFoodTag(name="Healthy")
        ing_tag = PossibleIngredientTag(name="Vegetable")
        session.add_all([food_tag1, food_tag2, ing_tag])
        session.commit()
        food_tag1_id = food_tag1.id
        food_tag2_id = food_tag2.id
        ing_tag_id = ing_tag.id

    ingredient_payload = {
        "name": "Onion",
        "nutrition": {
            "calories": 40.0,
            "fat": 0.1,
            "carbohydrates": 9.0,
            "protein": 1.1,
            "fiber": 1.7,
        },
        "units": [{"name": "gram", "grams": 1.0}],
        "tags": [{"id": ing_tag_id}],
    }

    response = user_a_client.post("/api/ingredients/", json=ingredient_payload)
    assert response.status_code == 201
    ingredient = response.json()
    ingredient_id = ingredient["id"]
    unit_id = ingredient["units"][0]["id"]

    food_payload = {
        "name": "Onion Omelette",
        "ingredients": [
            {
                "ingredient_id": ingredient_id,
                "unit_id": unit_id,
                "unit_quantity": 2.0,
            }
        ],
        "tags": [{"id": food_tag1_id}, {"id": food_tag2_id}],
    }

    response = user_a_client.post("/api/foods", json=food_payload)
    assert response.status_code == 201
    food = response.json()
    food_id = food["id"]
    assert food["ingredients"][0]["unit_quantity"] == pytest.approx(2.0)
    assert {t["name"] for t in food["tags"]} == {"Breakfast", "Healthy"}

    response = user_a_client.get(f"/api/foods/{food_id}")
    assert response.status_code == 200
    fetched = response.json()

    update_payload = {
        "id": food_id,
        "name": "Onion Omelette Deluxe",
        "ingredients": [
            {
                "ingredient_id": ingredient_id,
                "food_id": food_id,
                "unit_id": unit_id,
                "unit_quantity": 3.0,
            }
        ],
        "tags": [{"id": food_tag1_id}],
    }

    response = user_a_client.put(f"/api/foods/{food_id}", json=update_payload)
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Onion Omelette Deluxe"
    assert updated["ingredients"][0]["unit_quantity"] == pytest.approx(3.0)
    assert len(updated["tags"]) == 1 and updated["tags"][0]["name"] == "Breakfast"

    response = user_a_client.delete(f"/api/foods/{food_id}")
    assert response.status_code == 200
    response = user_a_client.get(f"/api/foods/{food_id}")
    assert response.status_code == 404
