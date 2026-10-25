from datetime import date

from fastapi.testclient import TestClient
from sqlmodel import Session

from Backend.models import DailyLogEntry, Ingredient, StoredFood


def _create_ingredient(session: Session, name: str = "Ingredient") -> Ingredient:
    ingredient = Ingredient(name=name, user_id="test-user")
    session.add(ingredient)
    session.commit()
    session.refresh(ingredient)
    return ingredient


def test_create_and_list_daily_logs(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Shredded Chicken")

    stored_payload = {
        "user_id": "user-logs",
        "ingredient_id": ingredient.id,
        "prepared_portions": 5,
        "per_portion_calories": 200,
        "per_portion_protein": 30,
        "per_portion_carbohydrates": 8,
        "per_portion_fat": 5,
        "per_portion_fiber": 2,
    }

    stored_response = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_response.status_code == 201
    stored_data = stored_response.json()

    consume_response = admin_client.post(
        f"/api/stored_food/{stored_data['id']}/consume", json={"portions": 2}
    )
    assert consume_response.status_code == 200
    consumed = consume_response.json()
    assert consumed["remaining_portions"] == 3

    log_date = date(2024, 1, 20)
    log_payload = {
        "user_id": stored_payload["user_id"],
        "log_date": log_date.isoformat(),
        "stored_food_id": stored_data["id"],
        "portions_consumed": 2,
        "calories": 400,
        "protein": 60,
        "carbohydrates": 16,
        "fat": 10,
        "fiber": 4,
    }

    log_response = admin_client.post("/api/logs/", json=log_payload)
    assert log_response.status_code == 201
    log_entry = log_response.json()
    assert log_entry["id"] is not None
    assert log_entry["stored_food_id"] == stored_data["id"]
    assert log_entry["portions_consumed"] == 2
    assert log_entry["calories"] == 400

    list_response = admin_client.get(
        f"/api/logs/{log_date.isoformat()}", params={"user_id": stored_payload["user_id"]}
    )
    assert list_response.status_code == 200
    entries = list_response.json()
    assert len(entries) == 1
    assert entries[0]["id"] == log_entry["id"]
    assert entries[0]["fiber"] == 4

    with Session(engine) as session:
        stored_instance = session.get(StoredFood, stored_data["id"])
        assert stored_instance is not None
        assert stored_instance.remaining_portions == 3

        persisted_log = session.get(DailyLogEntry, log_entry["id"])
        assert persisted_log is not None
        assert persisted_log.calories == 400


def test_daily_log_rejects_negative_macros(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Steamed Greens")

    stored_payload = {
        "user_id": "user-neg-macros",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 80,
        "per_portion_protein": 3,
        "per_portion_carbohydrates": 10,
        "per_portion_fat": 1,
        "per_portion_fiber": 4,
    }

    stored_response = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_response.status_code == 201
    stored_data = stored_response.json()

    consume_response = admin_client.post(
        f"/api/stored_food/{stored_data['id']}/consume", json={"portions": 1}
    )
    assert consume_response.status_code == 200

    log_payload = {
        "user_id": stored_payload["user_id"],
        "log_date": date(2024, 2, 1).isoformat(),
        "stored_food_id": stored_data["id"],
        "portions_consumed": 1,
        "calories": -50,
        "protein": 3,
        "carbohydrates": 10,
        "fat": 1,
        "fiber": 4,
    }

    response = admin_client.post("/api/logs/", json=log_payload)
    assert response.status_code == 422


def test_delete_daily_log_entry(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Tofu Scramble")

    stored_payload = {
        "user_id": "user-delete-log",
        "ingredient_id": ingredient.id,
        "prepared_portions": 4,
        "per_portion_calories": 150,
        "per_portion_protein": 12,
        "per_portion_carbohydrates": 8,
        "per_portion_fat": 6,
        "per_portion_fiber": 3,
    }

    stored_response = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_response.status_code == 201
    stored_id = stored_response.json()["id"]

    log_date = date(2024, 3, 1)
    log_payload = {
        "user_id": stored_payload["user_id"],
        "log_date": log_date.isoformat(),
        "stored_food_id": stored_id,
        "portions_consumed": 1,
        "calories": 150,
        "protein": 12,
        "carbohydrates": 8,
        "fat": 6,
        "fiber": 3,
    }

    first_response = admin_client.post("/api/logs/", json=log_payload)
    assert first_response.status_code == 201
    first_entry = first_response.json()

    second_response = admin_client.post(
        "/api/logs/",
        json={**log_payload, "portions_consumed": 0.5, "calories": 75},
    )
    assert second_response.status_code == 201
    second_entry = second_response.json()

    delete_response = admin_client.delete(f"/api/logs/{first_entry['id']}")
    assert delete_response.status_code == 204

    with Session(engine) as session:
        removed = session.get(DailyLogEntry, first_entry["id"])
        assert removed is None
        remaining = session.get(DailyLogEntry, second_entry["id"])
        assert remaining is not None


def test_clear_daily_logs(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Overnight Oats")

    stored_payload = {
        "user_id": "user-clear-log",
        "ingredient_id": ingredient.id,
        "prepared_portions": 6,
        "per_portion_calories": 100,
        "per_portion_protein": 5,
        "per_portion_carbohydrates": 15,
        "per_portion_fat": 3,
        "per_portion_fiber": 4,
    }

    stored_creation = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_creation.status_code == 201
    stored_id = stored_creation.json()["id"]

    first_date = date(2024, 4, 1)
    second_date = date(2024, 4, 2)

    for log_date in (first_date, second_date):
        response = admin_client.post(
            "/api/logs/",
            json={
                "user_id": stored_payload["user_id"],
                "log_date": log_date.isoformat(),
                "stored_food_id": stored_id,
                "portions_consumed": 1,
                "calories": 100,
                "protein": 5,
                "carbohydrates": 15,
                "fat": 3,
                "fiber": 4,
            },
        )
        assert response.status_code == 201

    clear_response = admin_client.delete(
        "/api/logs/",
        params={"user_id": stored_payload["user_id"], "log_date": first_date.isoformat()},
    )
    assert clear_response.status_code == 204

    list_first = admin_client.get(
        f"/api/logs/{first_date.isoformat()}", params={"user_id": stored_payload["user_id"]}
    )
    assert list_first.status_code == 200
    assert list_first.json() == []

    list_second = admin_client.get(
        f"/api/logs/{second_date.isoformat()}",
        params={"user_id": stored_payload["user_id"]},
    )
    assert list_second.status_code == 200
    assert len(list_second.json()) == 1

    clear_all_response = admin_client.delete(
        "/api/logs/", params={"user_id": stored_payload["user_id"]}
    )
    assert clear_all_response.status_code == 204

    list_second_after = admin_client.get(
        f"/api/logs/{second_date.isoformat()}",
        params={"user_id": stored_payload["user_id"]},
    )
    assert list_second_after.status_code == 200
    assert list_second_after.json() == []
