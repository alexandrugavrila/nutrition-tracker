import os
from uuid import uuid4

import httpx
import pytest

# Explicit E2E jobs must fail closed when their environment is missing.
_port = os.getenv("DEV_BACKEND_PORT")
if not _port:
    if os.getenv("E2E_REQUIRED") == "1":
        raise RuntimeError("DEV_BACKEND_PORT is required for the E2E job")
    pytest.skip("E2E stack not requested", allow_module_level=True)
BASE_URL = f"http://127.0.0.1:{_port}/api"


@pytest.fixture
def api_client():
    email = os.environ["E2E_EMAIL"]
    password = os.environ["E2E_PASSWORD"]
    with httpx.Client(follow_redirects=True, timeout=15, headers={"Origin":BASE_URL.removesuffix("/api")}) as client:
        client.get(f"{BASE_URL}/health/ready").raise_for_status()
        response = client.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200
        yield client
        assert client.post(f"{BASE_URL}/auth/logout").status_code == 204


def _ok(msg: str) -> None:
    """Lightweight step logger for explicit PASS messages.

    Shown when running pytest with `-s` (or with live logging enabled).
    """
    print(f"[E2E PASS] {msg}")


@pytest.mark.e2e
class TestIngredientRoutes:
    def test_crud_ingredient(self, api_client):
        print()
        unique_ing_name = f"_test_e2e_ingredient_{uuid4().hex[:8]}"
        create_payload = {
            "name": unique_ing_name,
            "nutrition": {
                "calories": 41,
                "fat": 0.2,
                "carbohydrates": 9.6,
                "protein": 0.9,
                "fiber": 2.8,
            },
            "units": [{"name": "100g", "grams": 100}],
        }

        ingredient_id: int | None = None
        try:
            # Create
            resp = api_client.post(f"{BASE_URL}/ingredients/", json=create_payload)
            assert (
                resp.status_code == 201
            ), f"create ingredient expected 201, got {resp.status_code}: {resp.text}"
            ingredient = resp.json()
            ingredient_id = ingredient["id"]
            assert (
                ingredient["name"] == unique_ing_name
            ), "created ingredient name should match request"
            _ok(f"Created ingredient '{unique_ing_name}' with id={ingredient_id}")

            # Read
            resp = api_client.get(f"{BASE_URL}/ingredients/{ingredient_id}")
            assert (
                resp.status_code == 200
            ), f"read ingredient expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["name"] == unique_ing_name
            ), "fetched ingredient name should equal created name"
            _ok("Fetched ingredient by id with expected name")

            # Update
            updated_ing_name = f"{unique_ing_name}_updated"
            update_payload = create_payload | {"name": updated_ing_name}
            resp = api_client.put(
                f"{BASE_URL}/ingredients/{ingredient_id}", json=update_payload
            )
            assert (
                resp.status_code == 200
            ), f"update ingredient expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["name"] == updated_ing_name
            ), "updated ingredient name should be persisted"
            _ok("Updated ingredient name persisted")

            # Delete
            resp = api_client.delete(f"{BASE_URL}/ingredients/{ingredient_id}")
            assert (
                resp.status_code == 200
            ), f"delete ingredient expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["message"] == "Ingredient deleted successfully"
            ), "delete response should include success message"
            _ok("Deleted ingredient successfully")

            resp = api_client.get(f"{BASE_URL}/ingredients/{ingredient_id}")
            assert (
                resp.status_code == 404
            ), f"fetch after delete expected 404, got {resp.status_code}: {resp.text}"
            _ok("Deleted ingredient no longer available by id")
            ingredient_id = None
        finally:
            if ingredient_id is not None:
                api_client.delete(f"{BASE_URL}/ingredients/{ingredient_id}")


@pytest.mark.e2e
class TestFoodRoutes:
    def test_crud_food(self, api_client):
        print()
        # First create an ingredient to reference
        unique_ing_name = f"_test_e2e_ingredient_{uuid4().hex[:8]}"
        ingredient_payload = {
            "name": unique_ing_name,
            "units": [{"name": "1 cup", "grams": 100}],
        }
        ingredient_id: int | None = None
        food_id: int | None = None
        try:
            resp = api_client.post(f"{BASE_URL}/ingredients/", json=ingredient_payload)
            assert (
                resp.status_code == 201
            ), f"seed ingredient expected 201, got {resp.status_code}: {resp.text}"
            ingredient_id = resp.json()["id"]
            _ok(f"Seeded ingredient '{unique_ing_name}' id={ingredient_id}")

            unique_food_name = f"_test_e2e_food_{uuid4().hex[:8]}"
            food_payload = {
                "name": unique_food_name,
                "ingredients": [{"ingredient_id": ingredient_id, "unit_quantity": 1}],
            }

            # Create
            resp = api_client.post(f"{BASE_URL}/foods/", json=food_payload)
            assert (
                resp.status_code == 201
            ), f"create food expected 201, got {resp.status_code}: {resp.text}"
            food = resp.json()
            food_id = food["id"]
            assert (
                food["name"] == unique_food_name
            ), "created food name should match request"
            _ok(f"Created food '{unique_food_name}' with id={food_id}")

            # Read
            resp = api_client.get(f"{BASE_URL}/foods/{food_id}")
            assert (
                resp.status_code == 200
            ), f"read food expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["name"] == unique_food_name
            ), "fetched food name should equal created name"
            _ok("Fetched food by id with expected name")

            # Update
            updated_food_name = f"{unique_food_name}_updated"
            update_payload = food_payload | {"name": updated_food_name}
            resp = api_client.put(f"{BASE_URL}/foods/{food_id}", json=update_payload)
            assert (
                resp.status_code == 200
            ), f"update food expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["name"] == updated_food_name
            ), "updated food name should be persisted"
            _ok("Updated food name persisted")

            # Delete
            resp = api_client.delete(f"{BASE_URL}/foods/{food_id}")
            assert (
                resp.status_code == 200
            ), f"delete food expected 200, got {resp.status_code}: {resp.text}"
            assert (
                resp.json()["message"] == "Food deleted successfully"
            ), "delete response should include success message"
            _ok("Deleted food successfully")

            resp = api_client.get(f"{BASE_URL}/foods/{food_id}")
            assert (
                resp.status_code == 404
            ), f"fetch after delete expected 404, got {resp.status_code}: {resp.text}"
            _ok("Deleted food no longer available by id")
            food_id = None
        finally:
            if food_id is not None:
                api_client.delete(f"{BASE_URL}/foods/{food_id}")
            if ingredient_id is not None:
                resp = api_client.delete(f"{BASE_URL}/ingredients/{ingredient_id}")
                assert (
                    resp.status_code in (200, 404)
                ), f"cleanup ingredient delete expected 200/404, got {resp.status_code}: {resp.text}"
                _ok("Cleaned up seed ingredient")


@pytest.mark.e2e
def test_live_login_isolation_and_logout(api_client):
    with httpx.Client(follow_redirects=True, timeout=15, headers={"Origin":BASE_URL.removesuffix("/api")}) as other:
        assert other.get(f"{BASE_URL}/plans/").status_code == 401
        assert other.post(f"{BASE_URL}/auth/login", json={
            "email": os.environ["E2E_OTHER_EMAIL"], "password": os.environ["E2E_PASSWORD"]
        }).status_code == 200
        response = api_client.post(f"{BASE_URL}/plans/", json={"label": "Private E2E", "payload": {}})
        assert response.status_code == 201
        plan_id = response.json()["id"]
        try:
            assert other.get(f"{BASE_URL}/plans/{plan_id}").status_code == 404
            assert other.delete(f"{BASE_URL}/plans/{plan_id}").status_code == 404
        finally:
            assert api_client.delete(f"{BASE_URL}/plans/{plan_id}").status_code == 204
        assert other.post(f"{BASE_URL}/auth/logout").status_code == 204
        assert other.get(f"{BASE_URL}/auth/me").status_code == 401
