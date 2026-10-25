from typing import Any, Dict
import pytest

@pytest.fixture
def plan_food(user_a_client):
    response = user_a_client.post("/api/foods/", json={"name":"Plan recipe"})
    assert response.status_code == 201
    return str(response.json()["id"])


def sample_payload(food_id) -> Dict[str, Any]:
    return {
        "days": 2,
        "targetMacros": {
            "calories": 2000,
            "protein": 150,
            "carbs": 250,
            "fat": 70,
            "fiber": 30,
        },
        "plan": [
            {
                "type": "food",
                "foodId": food_id,
                "portions": 2,
                "overrides": {},
            }
        ],
    }


def test_create_and_get_plan(user_a_client, plan_food):
    payload = {"label": "Weekday", "payload": sample_payload(plan_food)}

    create_response = user_a_client.post("/api/plans/", json=payload)
    assert create_response.status_code == 201
    created = create_response.json()

    assert created["label"] == "Weekday"
    assert created["payload"]["days"] == 2
    plan_id = created["id"]

    get_response = user_a_client.get(f"/api/plans/{plan_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["label"] == "Weekday"
    assert fetched["payload"] == created["payload"]


def test_update_plan(user_a_client, plan_food):
    create_response = user_a_client.post(
        "/api/plans/", json={"label": "Original", "payload": sample_payload(plan_food)}
    )
    plan_id = create_response.json()["id"]

    updated_payload = sample_payload(plan_food)
    updated_payload["days"] = 3
    update_response = user_a_client.put(
        f"/api/plans/{plan_id}", json={"label": "Updated", "payload": updated_payload}
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["label"] == "Updated"
    assert updated["payload"]["days"] == 3


def test_delete_plan(user_a_client, plan_food):
    create_response = user_a_client.post(
        "/api/plans/", json={"label": "To Delete", "payload": sample_payload(plan_food)}
    )
    plan_id = create_response.json()["id"]

    delete_response = user_a_client.delete(f"/api/plans/{plan_id}")
    assert delete_response.status_code == 204

    get_response = user_a_client.get(f"/api/plans/{plan_id}")
    assert get_response.status_code == 404


def test_list_plans(user_a_client, plan_food):
    plan_a = user_a_client.post("/api/plans/", json={"label": "Plan A", "payload": sample_payload(plan_food)})
    plan_b = user_a_client.post("/api/plans/", json={"label": "Plan B", "payload": sample_payload(plan_food)})

    plan_a_id = plan_a.json()["id"]
    plan_b_id = plan_b.json()["id"]

    updated_payload = sample_payload(plan_food)
    updated_payload["days"] = 3
    update_response = user_a_client.put(
        f"/api/plans/{plan_a_id}",
        json={"label": "Plan A Updated", "payload": updated_payload},
    )
    assert update_response.status_code == 200

    list_response = user_a_client.get("/api/plans/")
    assert list_response.status_code == 200
    data = list_response.json()
    assert len(data) == 2

    assert [item["id"] for item in data] == [plan_a_id, plan_b_id]
    assert data[0]["updated_at"] >= data[1]["updated_at"]

    labels = [item["label"] for item in data]
    assert labels[0] == "Plan A Updated"
    assert "Plan B" in labels
