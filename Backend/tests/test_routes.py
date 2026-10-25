from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.models import PossibleIngredientTag, PossibleFoodTag


def test_get_possible_ingredient_tags(user_a_client: TestClient, engine) -> None:
    with Session(engine) as session:
        session.add(PossibleIngredientTag(name="Spicy"))
        session.add(PossibleIngredientTag(name="Sweet"))
        session.commit()

    response = user_a_client.get("/api/ingredients/possible_tags")
    assert response.status_code == 200
    names = [tag["name"] for tag in response.json()]
    assert names == ["Spicy", "Sweet"]


def test_post_possible_ingredient_tag_reuses_existing_record(
    user_a_client: TestClient, engine
) -> None:
    payload = {"name": " Savory "}

    create_response = user_a_client.post("/api/ingredients/possible_tags", json=payload)
    assert create_response.status_code == 201
    created_tag = create_response.json()
    assert created_tag["name"] == "Savory"
    assert created_tag["id"] is not None

    duplicate_response = user_a_client.post(
        "/api/ingredients/possible_tags", json={"name": "Savory"}
    )
    assert duplicate_response.status_code in (200, 201)
    duplicate_tag = duplicate_response.json()
    assert duplicate_tag == created_tag

    with Session(engine) as session:
        tags = session.exec(select(PossibleIngredientTag)).all()
        assert len(tags) == 1
        assert tags[0].id == created_tag["id"]


def test_get_possible_food_tags(user_a_client: TestClient, engine) -> None:
    with Session(engine) as session:
        session.add(PossibleFoodTag(name="Breakfast"))
        session.add(PossibleFoodTag(name="Dinner"))
        session.commit()

    response = user_a_client.get("/api/foods/possible_tags")
    assert response.status_code == 200
    names = [tag["name"] for tag in response.json()]
    assert names == ["Breakfast", "Dinner"]


def test_post_possible_food_tag_reuses_existing_record(
    user_a_client: TestClient, engine
) -> None:
    payload = {"name": " Comfort "}

    create_response = user_a_client.post("/api/foods/possible_tags", json=payload)
    assert create_response.status_code == 201
    created_tag = create_response.json()
    assert created_tag["name"] == "Comfort"
    assert created_tag["id"] is not None

    duplicate_response = user_a_client.post(
        "/api/foods/possible_tags", json={"name": "Comfort"}
    )
    assert duplicate_response.status_code in (200, 201)
    duplicate_tag = duplicate_response.json()
    assert duplicate_tag == created_tag

    with Session(engine) as session:
        tags = session.exec(select(PossibleFoodTag)).all()
        assert len(tags) == 1
        assert tags[0].id == created_tag["id"]


def test_update_nonexistent_ingredient_returns_404(user_a_client: TestClient) -> None:
    response = user_a_client.put(
        "/api/ingredients/999",
        json={"id": 999, "name": "Ghost", "nutrition": None, "units": [], "tags": []},
    )
    assert response.status_code == 404


def test_delete_nonexistent_food_returns_404(user_a_client: TestClient) -> None:
    response = user_a_client.delete("/api/foods/999")
    assert response.status_code == 404
