from datetime import date

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from Backend.models import DailyLogEntry, Food, Ingredient, StoredFood


def _create_ingredient(session: Session, name: str = "Ingredient") -> Ingredient:
    ingredient = Ingredient(name=name, user_id="test-user")
    session.add(ingredient)
    session.commit()
    session.refresh(ingredient)
    return ingredient


def _create_food(session: Session, name: str = "Food") -> Food:
    food = Food(name=name, user_id="test-user")
    session.add(food)
    session.commit()
    session.refresh(food)
    return food


def test_create_stored_food_entry(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Chicken Breast")

    payload = {
        "user_id": "user-1",
        "ingredient_id": ingredient.id,
        "prepared_portions": 4,
        "per_portion_calories": 250,
        "per_portion_protein": 30,
        "per_portion_carbohydrates": 5,
        "per_portion_fat": 8,
        "per_portion_fiber": 1,
    }

    response = admin_client.post("/api/stored_food/", json=payload)
    assert response.status_code == 201
    body = response.json()
    assert body["remaining_portions"] == 4
    assert body["is_finished"] is False
    assert body["ingredient_id"] == ingredient.id

    with Session(engine) as session:
        stored = session.get(StoredFood, body["id"])
        assert stored is not None
        assert stored.remaining_portions == 4
        assert stored.is_finished is False


def test_list_stored_food_filters(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Pulled Pork")

    base_payload = {
        "user_id": "user-2",
        "ingredient_id": ingredient.id,
        "prepared_portions": 6,
        "per_portion_calories": 200,
        "per_portion_protein": 20,
        "per_portion_carbohydrates": 10,
        "per_portion_fat": 7,
        "per_portion_fiber": 2,
    }

    first_response = admin_client.post(
        "/api/stored_food/",
        json={**base_payload, "prepared_at": "2024-01-01T12:00:00Z"},
    )
    assert first_response.status_code == 201
    first = first_response.json()
    second_response = admin_client.post(
        "/api/stored_food/",
        json={**base_payload, "remaining_portions": 0, "prepared_at": "2024-01-02T12:00:00Z"},
    )
    assert second_response.status_code == 201
    third_response = admin_client.post(
        "/api/stored_food/",
        json={**base_payload, "user_id": "other-user", "prepared_at": "2024-01-01T08:00:00Z"},
    )
    assert third_response.status_code == 201

    response = admin_client.get("/api/stored_food/", params={"user_id": "user-2", "only_available": True})
    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 2
    assert {entry["id"] for entry in entries} == {first["id"], third_response.json()["id"]}

    response = admin_client.get(
        "/api/stored_food/",
        params={"user_id": "user-2", "day": date(2024, 1, 1).isoformat()},
    )
    assert response.status_code == 200
    ids = {entry["id"] for entry in response.json()}
    assert ids == {first["id"], third_response.json()["id"]}


def test_consume_stored_food(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Roasted Veggies")

    payload = {
        "user_id": "user-3",
        "ingredient_id": ingredient.id,
        "prepared_portions": 3,
        "per_portion_calories": 150,
        "per_portion_protein": 5,
        "per_portion_carbohydrates": 20,
        "per_portion_fat": 6,
        "per_portion_fiber": 4,
    }

    stored = admin_client.post("/api/stored_food/", json=payload).json()

    consume_response = admin_client.post(
        f"/api/stored_food/{stored['id']}/consume", json={"portions": 1.5}
    )
    assert consume_response.status_code == 200
    consumed = consume_response.json()
    assert consumed["remaining_portions"] == 1.5
    assert consumed["is_finished"] is False

    finish_response = admin_client.post(
        f"/api/stored_food/{stored['id']}/consume", json={"portions": 1.5}
    )
    assert finish_response.status_code == 200
    finished = finish_response.json()
    assert finished["remaining_portions"] == 0
    assert finished["is_finished"] is True
    assert finished["completed_at"] is not None


def test_consume_stored_food_rejects_overconsumption(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Mashed Potatoes")

    payload = {
        "user_id": "user-4",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 120,
        "per_portion_protein": 4,
        "per_portion_carbohydrates": 18,
        "per_portion_fat": 3,
        "per_portion_fiber": 2,
    }

    stored = admin_client.post("/api/stored_food/", json=payload).json()

    response = admin_client.post(
        f"/api/stored_food/{stored['id']}/consume", json={"portions": 3}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot consume more portions than remain"


def test_create_stored_food_rejects_negative_macros(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Tempeh")

    payload = {
        "user_id": "user-5",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 200,
        "per_portion_protein": -5,
        "per_portion_carbohydrates": 10,
        "per_portion_fat": 8,
        "per_portion_fiber": 3,
    }

    response = admin_client.post("/api/stored_food/", json=payload)
    assert response.status_code == 422


def test_list_stored_food_handles_missing_table(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Quinoa")

    # Drop the stored_food table to emulate an out-of-date database schema.
    DailyLogEntry.__table__.drop(engine, checkfirst=True)
    StoredFood.__table__.drop(engine)

    try:
        response = admin_client.get("/api/stored_food/")
        assert response.status_code == 200
        assert response.json() == []
    finally:
        # Recreate the tables so other operations in this test can verify behavior.
        StoredFood.__table__.create(engine, checkfirst=True)
        DailyLogEntry.__table__.create(engine, checkfirst=True)

    payload = {
        "user_id": "user-migration",
        "ingredient_id": ingredient.id,
        "prepared_portions": 1,
        "per_portion_calories": 100,
        "per_portion_protein": 10,
        "per_portion_carbohydrates": 5,
        "per_portion_fat": 2,
        "per_portion_fiber": 1,
    }

    response = admin_client.post("/api/stored_food/", json=payload)
    assert response.status_code == 201


def test_create_stored_food_reports_missing_table(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Tofu")

    DailyLogEntry.__table__.drop(engine, checkfirst=True)
    StoredFood.__table__.drop(engine)

    payload = {
        "user_id": "user-missing",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 150,
        "per_portion_protein": 12,
        "per_portion_carbohydrates": 6,
        "per_portion_fat": 3,
        "per_portion_fiber": 4,
    }

    try:
        response = admin_client.post("/api/stored_food/", json=payload)
        assert response.status_code == 503
        assert "Run the latest database migrations" in response.json()["detail"]
    finally:
        StoredFood.__table__.create(engine, checkfirst=True)
        DailyLogEntry.__table__.create(engine, checkfirst=True)


def test_consume_stored_food_reports_missing_table(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Beans")

    payload = {
        "user_id": "user-consume",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 150,
        "per_portion_protein": 9,
        "per_portion_carbohydrates": 12,
        "per_portion_fat": 4,
        "per_portion_fiber": 6,
    }

    created = admin_client.post("/api/stored_food/", json=payload)
    assert created.status_code == 201
    stored_id = created.json()["id"]

    DailyLogEntry.__table__.drop(engine, checkfirst=True)
    StoredFood.__table__.drop(engine)

    try:
        response = admin_client.post(
            f"/api/stored_food/{stored_id}/consume", json={"portions": 1}
        )
        assert response.status_code == 503
        assert "Run the latest database migrations" in response.json()["detail"]
    finally:
        StoredFood.__table__.create(engine, checkfirst=True)
        DailyLogEntry.__table__.create(engine, checkfirst=True)


def test_delete_stored_food_entry(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Black Beans")

    payload = {
        "user_id": "user-delete-stored",
        "ingredient_id": ingredient.id,
        "prepared_portions": 3,
        "per_portion_calories": 180,
        "per_portion_protein": 10,
        "per_portion_carbohydrates": 20,
        "per_portion_fat": 4,
        "per_portion_fiber": 8,
    }

    stored_response = admin_client.post("/api/stored_food/", json=payload)
    assert stored_response.status_code == 201
    stored_id = stored_response.json()["id"]

    other_response = admin_client.post(
        "/api/stored_food/",
        json={**payload, "user_id": "other-user"},
    )
    assert other_response.status_code == 201

    delete_response = admin_client.delete(f"/api/stored_food/{stored_id}")
    assert delete_response.status_code == 204

    with Session(engine) as session:
        removed = session.get(StoredFood, stored_id)
        assert removed is None
        remaining = session.exec(
            select(StoredFood).where(StoredFood.user_id == "other-user")
        ).all()
        assert remaining == []


def test_delete_stored_food_preserves_daily_logs(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Chili")

    stored_payload = {
        "user_id": "user-log-retain",
        "ingredient_id": ingredient.id,
        "prepared_portions": 5,
        "per_portion_calories": 300,
        "per_portion_protein": 20,
        "per_portion_carbohydrates": 25,
        "per_portion_fat": 12,
        "per_portion_fiber": 9,
    }

    stored_response = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_response.status_code == 201
    stored_id = stored_response.json()["id"]

    log_payload = {
        "user_id": stored_payload["user_id"],
        "log_date": "2024-01-15",
        "stored_food_id": stored_id,
        "portions_consumed": 1,
        "calories": stored_payload["per_portion_calories"],
        "protein": stored_payload["per_portion_protein"],
        "carbohydrates": stored_payload["per_portion_carbohydrates"],
        "fat": stored_payload["per_portion_fat"],
        "fiber": stored_payload["per_portion_fiber"],
    }

    log_response = admin_client.post("/api/logs/", json=log_payload)
    assert log_response.status_code == 201
    log_id = log_response.json()["id"]

    delete_response = admin_client.delete(f"/api/stored_food/{stored_id}")
    assert delete_response.status_code == 204

    with Session(engine) as session:
        entry = session.get(DailyLogEntry, log_id)
        assert entry is not None
        assert entry.stored_food_id is None
        assert entry.ingredient_id == ingredient.id
        assert entry.food_id is None


def test_delete_stored_food_preserves_daily_logs_for_food(
    admin_client: TestClient, engine
) -> None:
    with Session(engine) as session:
        food = _create_food(session, "Chicken Stir Fry")

    stored_payload = {
        "user_id": "user-log-retain-food",
        "food_id": food.id,
        "prepared_portions": 4,
        "per_portion_calories": 420,
        "per_portion_protein": 28,
        "per_portion_carbohydrates": 35,
        "per_portion_fat": 14,
        "per_portion_fiber": 6,
    }

    stored_response = admin_client.post("/api/stored_food/", json=stored_payload)
    assert stored_response.status_code == 201
    stored_id = stored_response.json()["id"]

    log_payload = {
        "user_id": stored_payload["user_id"],
        "log_date": "2024-01-16",
        "stored_food_id": stored_id,
        "portions_consumed": 1,
        "calories": stored_payload["per_portion_calories"],
        "protein": stored_payload["per_portion_protein"],
        "carbohydrates": stored_payload["per_portion_carbohydrates"],
        "fat": stored_payload["per_portion_fat"],
        "fiber": stored_payload["per_portion_fiber"],
    }

    log_response = admin_client.post("/api/logs/", json=log_payload)
    assert log_response.status_code == 201
    log_id = log_response.json()["id"]

    delete_response = admin_client.delete(f"/api/stored_food/{stored_id}")
    assert delete_response.status_code == 204

    with Session(engine) as session:
        entry = session.get(DailyLogEntry, log_id)
        assert entry is not None
        assert entry.stored_food_id is None
        assert entry.food_id == food.id
        assert entry.ingredient_id is None


def test_clear_stored_food(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Tomato Soup")

    payload = {
        "user_id": "user-clear-stored",
        "ingredient_id": ingredient.id,
        "prepared_portions": 4,
        "per_portion_calories": 120,
        "per_portion_protein": 6,
        "per_portion_carbohydrates": 14,
        "per_portion_fat": 3,
        "per_portion_fiber": 5,
    }

    first_response = admin_client.post("/api/stored_food/", json=payload)
    assert first_response.status_code == 201

    second_response = admin_client.post(
        "/api/stored_food/", json={**payload, "label": "Leftovers"}
    )
    assert second_response.status_code == 201

    other_response = admin_client.post(
        "/api/stored_food/", json={**payload, "user_id": "other-user"}
    )
    assert other_response.status_code == 201

    clear_response = admin_client.delete(
        "/api/stored_food/", params={"user_id": payload["user_id"]}
    )
    assert clear_response.status_code == 204

    with Session(engine) as session:
        remaining = session.exec(
            select(StoredFood).where(StoredFood.user_id == payload["user_id"])
        ).all()
        assert remaining == []

        others = session.exec(
            select(StoredFood).where(StoredFood.user_id == "other-user")
        ).all()
        assert others == []


def test_clear_stored_food_preserves_daily_logs(admin_client: TestClient, engine) -> None:
    with Session(engine) as session:
        ingredient = _create_ingredient(session, "Lentil Soup")

    payload = {
        "user_id": "user-clear-stored-logs",
        "ingredient_id": ingredient.id,
        "prepared_portions": 2,
        "per_portion_calories": 190,
        "per_portion_protein": 11,
        "per_portion_carbohydrates": 24,
        "per_portion_fat": 5,
        "per_portion_fiber": 7,
    }

    stored_response = admin_client.post("/api/stored_food/", json=payload)
    assert stored_response.status_code == 201
    stored_id = stored_response.json()["id"]

    log_response = admin_client.post(
        "/api/logs/",
        json={
            "user_id": payload["user_id"],
            "log_date": "2024-02-03",
            "stored_food_id": stored_id,
            "portions_consumed": 1,
            "calories": payload["per_portion_calories"],
            "protein": payload["per_portion_protein"],
            "carbohydrates": payload["per_portion_carbohydrates"],
            "fat": payload["per_portion_fat"],
            "fiber": payload["per_portion_fiber"],
        },
    )
    assert log_response.status_code == 201
    log_id = log_response.json()["id"]

    clear_response = admin_client.delete(
        "/api/stored_food/", params={"user_id": payload["user_id"]}
    )
    assert clear_response.status_code == 204

    with Session(engine) as session:
        entry = session.get(DailyLogEntry, log_id)
        assert entry is not None
        assert entry.stored_food_id is None
        assert entry.ingredient_id == ingredient.id
        assert entry.food_id is None
