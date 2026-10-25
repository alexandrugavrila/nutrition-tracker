"""Missing nutrients stay unknown across provider imports and historical snapshots."""

import pytest
from sqlmodel import Session
from Backend.models import StoredFood, DailyLogEntry
from Backend.services.usda_normalization import _trim_food_payload
from Backend.tests.test_authorization_boundaries import provider, imported


def test_nullable_snapshots_and_canonical_refresh(user_a_client, provider, engine):
    original = imported(user_a_client)
    ingredient_id = original['id']
    copied = user_a_client.post(f'/api/ingredients/{ingredient_id}/copy').json()
    stored = user_a_client.post(
        '/api/stored_food/',
        json={
            'ingredient_id': ingredient_id,
            'prepared_portions': 2,
            'per_portion_calories': 10,
            'per_portion_protein': 1,
            'per_portion_fat': 0,
            'per_portion_carbohydrates': 2,
            'per_portion_fiber': 0,
        },
    )
    assert stored.status_code == 201, stored.text
    historical = user_a_client.post(
        '/api/logs/',
        json={
            'ingredient_id': ingredient_id,
            'log_date': '2026-01-01',
            'portions_consumed': 1,
            'calories': 10,
            'protein': 1,
            'fat': 0,
            'carbohydrates': 2,
            'fiber': 0,
        },
    )
    assert historical.status_code == 201, historical.text
    provider['payload']['foodNutrients'].pop()  # Missing fiber, with genuine zero fat.
    refreshed = imported(user_a_client)
    assert refreshed['id'] == ingredient_id
    assert refreshed['units'] == original['units']
    assert refreshed['nutrition']['fiber'] is None
    assert refreshed['nutrition']['fat'] == 0
    assert (
        user_a_client.get(f"/api/ingredients/{copied['id']}").json()['nutrition']['fiber'] == 0.02
    )
    incomplete = user_a_client.post(
        '/api/stored_food/',
        json={
            'ingredient_id': ingredient_id,
            'prepared_portions': 1,
            'per_portion_calories': 10,
            'per_portion_fat': 0,
            'per_portion_fiber': None,
        },
    )
    assert incomplete.status_code == 201, incomplete.text
    log = user_a_client.post(
        '/api/logs/',
        json={
            'stored_food_id': incomplete.json()['id'],
            'log_date': '2026-01-02',
            'portions_consumed': 1,
            'calories': 10,
            'fat': 0,
            'fiber': None,
        },
    )
    assert log.status_code == 201, log.text
    assert log.json()['protein'] is None and log.json()['fiber'] is None
    with Session(engine) as db:
        assert db.get(StoredFood, stored.json()['id']).per_portion_fiber == 0
        assert db.get(DailyLogEntry, historical.json()['id']).fiber == 0
        assert db.get(StoredFood, incomplete.json()['id']).per_portion_fiber is None
        assert db.get(DailyLogEntry, log.json()['id']).fiber is None
    assert user_a_client.get('/api/logs/2026-01-02').json()[0]['fiber'] is None


@pytest.mark.parametrize(
    'data_type,unit,normalizable',
    [
        ('Foundation', None, True),
        ('SR Legacy', None, True),
        ('Survey (FNDDS)', None, True),
        ('Branded', 'g', True),
        ('Branded', 'ml', False),
        ('Experimental', None, False),
    ],
)
def test_missing_and_zero_nutrients_with_basis(data_type, unit, normalizable):
    result = _trim_food_payload(
        {
            'fdcId': 1,
            'description': 'Fixture',
            'dataType': data_type,
            'servingSize': 50,
            'servingSizeUnit': unit,
            'foodNutrients': [{'nutrientId': 1004, 'value': 0, 'unitName': 'g'}],
        }
    )
    assert result['normalization']['can_normalize'] is normalizable
    if normalizable:
        assert result['nutrition']['fat'] == 0
        assert result['nutrition']['fiber'] is None
        assert result['nutrition']['calories'] is None
    else:
        assert result['nutrition'] is None


def test_macro_units_and_invalid_values_are_not_fabricated():
    result = _trim_food_payload(
        {
            'dataType': 'Foundation',
            'foodNutrients': [
                {'nutrientId': 1003, 'value': 1000, 'unitName': 'mg'},
                {'nutrientId': 1004, 'value': 5, 'unitName': 'ml'},
                {'nutrientId': 1008, 'value': 100, 'unitName': 'kJ'},
                {'nutrientId': 1079, 'value': 'NaN', 'unitName': 'g'},
            ],
        }
    )
    assert result['nutrition'] == dict(
        calories=None, protein=0.01, fat=None, carbohydrates=None, fiber=None
    )


def test_personal_nutrition_round_trip_preserves_blank_and_zero(user_a_client):
    response = user_a_client.post(
        '/api/ingredients/',
        json={
            'name': 'Incomplete personal',
            'nutrition': {'fat': 0, 'protein': None},
        },
    )
    assert response.status_code == 201, response.text
    result = user_a_client.get(f"/api/ingredients/{response.json()['id']}").json()
    assert result['nutrition']['fat'] == 0
    assert result['nutrition']['protein'] is None
    assert result['nutrition']['fiber'] is None
