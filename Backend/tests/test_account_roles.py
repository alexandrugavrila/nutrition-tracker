def test_anonymous_cannot_read_personal_collections(anonymous_client):
    for path in ("ingredients/", "foods/", "plans/", "stored_food/", "logs/2026-10-11"):
        assert anonymous_client.get(f"/api/{path}").status_code == 401


def test_accounts_have_independent_sessions_and_personal_data(user_a_client, user_b_client):
    assert not user_a_client.get("/api/auth/me").json()["user"]["is_admin"]
    assert not user_b_client.get("/api/auth/me").json()["user"]["is_admin"]
    created = user_a_client.post("/api/ingredients/", json={"name": "A private ingredient"})
    assert created.status_code == 201
    ingredient_id = created.json()["id"]
    assert user_b_client.get(f"/api/ingredients/{ingredient_id}").status_code == 404
    assert user_b_client.delete(f"/api/ingredients/{ingredient_id}").status_code == 404
    assert user_a_client.get(f"/api/ingredients/{ingredient_id}").status_code == 200
    assert user_a_client.post("/api/auth/logout").status_code == 204
    assert user_a_client.get("/api/auth/me").status_code == 401
    assert user_b_client.get("/api/auth/me").status_code == 200


def test_ordinary_account_cannot_create_accounts(user_a_client):
    assert user_a_client.post("/api/auth/users", json={
        "email": "new@example.com", "password": "Password123!", "display_name": "New"
    }).status_code == 403


def test_admin_fixture_is_explicit(admin_client):
    assert admin_client.get("/api/auth/me").json()["user"]["is_admin"] is True
