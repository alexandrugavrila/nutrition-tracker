from datetime import date, datetime, timezone
import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from Backend.models import (Ingredient, IngredientSource, IngredientUnit, Food, Plan,
    StoredFood, DailyLogEntry, UserIngredientPreference)


def verified_source(source_id):
    return IngredientSource(source="usda", source_id=source_id, verification_status="verified",
        verified_at=datetime.now(timezone.utc), artifact_sha256="a" * 64, normalization_version="fixture-v1")


def test_final_owner_constraint_and_catalog_visibility(engine, user_a_client, user_b_client, admin_client):
    with Session(engine) as session:
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(Ingredient(name="Unassigned")); session.flush()
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(Food(name="Unassigned")); session.flush()
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(Plan(label="Unassigned", payload={})); session.flush()
        flagged = Ingredient(name="Unverified flag", is_shared=True)
        shared = Ingredient(name="Verified shared", is_shared=True, sources=[verified_source("shared")])
        personal = Ingredient(name="Private", user_id="user-a")
        session.add_all([flagged, shared, personal]); session.commit()
        from Backend.models import CatalogSelection
        session.add_all([CatalogSelection(user_id=user, ingredient_id=shared.id) for user in ("user-a", "user-b", "test-user")]); session.commit()
        shared_id, private_id = shared.id, personal.id
    for client in (user_a_client, user_b_client, admin_client):
        rows = client.get("/api/ingredients/").json()
        assert all(row["name"] != "Unverified flag" for row in rows)
        body = client.get(f"/api/ingredients/{shared_id}").json()
        assert body["is_shared"] is True and body["user_id"] is None
        assert body["provenance_status"] == "verified"
    body = user_a_client.get(f"/api/ingredients/{private_id}").json()
    assert body["user_id"] == "user-a" and body["is_shared"] is False
    assert user_b_client.get(f"/api/ingredients/{private_id}").status_code == 404
    assert admin_client.get(f"/api/ingredients/{private_id}").status_code == 404


def test_client_source_does_not_publish_or_assert_verification(user_a_client, user_b_client):
    response = user_a_client.post("/api/ingredients/", json={"name":"Claimed", "source":"usda",
        "source_id":"untrusted", "is_shared":True, "verification_status":"verified"})
    assert response.status_code == 422
    assert user_a_client.get("/api/ingredients/").json() == []


def test_preference_matching_constraint_and_account_keys(engine, user_a_client, user_b_client):
    if engine.dialect.name != "postgresql":
        pytest.skip("Composite foreign keys validated on required PostgreSQL run")
    with Session(engine) as session:
        first = Ingredient(name="First", user_id="user-a", units=[IngredientUnit(name="g", grams=1), IngredientUnit(name="cup", grams=100)])
        other = Ingredient(name="Other", user_id="user-b", units=[IngredientUnit(name="g", grams=1)])
        session.add_all([first, other]); session.commit()
        for user, unit in zip(("user-a", "user-b"), first.units):
            session.add(UserIngredientPreference(user_id=user, ingredient_id=first.id, unit_id=unit.id))
        session.commit()
        assert len(session.exec(select(UserIngredientPreference)).all()) == 2
        with pytest.raises(IntegrityError), session.begin_nested():
            preference = session.get(UserIngredientPreference, ("user-a", first.id))
            preference.unit_id = other.units[0].id
            session.add(preference); session.flush()
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(Ingredient(name="Invalid shared owner", user_id="user-a", is_shared=True)); session.flush()
        with pytest.raises(IntegrityError), session.begin_nested():
            session.add(IngredientSource(ingredient_id=first.id, source="usda", source_id="fake", verification_status="verified")); session.flush()
