"""Phase 6 permission, reference, catalog and session boundaries."""

from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import httpx
import pytest
from sqlmodel import Session, select
from Backend.models import (
    Ingredient,
    IngredientSource,
    CatalogSelection,
    IngredientProvenanceHistory,
    User,
    AuthSession,
)
from Backend.routes import usda


def food(fdc_id=123):
    return {
        'fdcId': fdc_id,
        'description': 'USDA rice',
        'dataType': 'Foundation',
        'foodNutrients': [
            {'nutrientId': identifier, 'value': value, 'unitName': unit}
            for identifier, value, unit in (
                (1008, 100, 'kcal'),
                (1003, 1, 'g'),
                (1004, 0, 'g'),
                (1005, 20, 'g'),
                (1079, 2, 'g'),
            )
        ],
        'foodPortions': [{'gramWeight': 100, 'portionDescription': 'cup'}],
    }


@pytest.fixture
def provider(monkeypatch):
    state = {'payload': food(), 'error': False, 'requests': 0}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, **kwargs):
            state['requests'] += 1
            request = httpx.Request('GET', url + '?api_key=TOP-SECRET')
            if state['error']:
                raise httpx.HTTPStatusError(
                    'secret URL ' + str(request.url),
                    request=request,
                    response=httpx.Response(500, request=request),
                )
            return httpx.Response(200, json=state['payload'], request=request)

    monkeypatch.setattr(usda.httpx, 'AsyncClient', Client)
    monkeypatch.setattr(usda, 'settings', SimpleNamespace(usda_api_key='TOP-SECRET'))
    return state


def imported(client):
    response = client.post('/api/usda/import/123')
    assert response.status_code == 200, response.text
    return response.json()


def personal(client, name='Personal'):
    response = client.post(
        '/api/ingredients/', json={'name': name, 'units': [{'name': 'cup', 'grams': 100}]}
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(
    'method,path',
    [
        ('post', '/api/ingredients/possible_tags'),
        ('post', '/api/foods/possible_tags'),
        ('get', '/api/usda/search?query=rice'),
        ('get', '/api/usda/foods/123'),
        ('post', '/api/usda/import/123'),
    ],
)
def test_anonymous_cannot_use_catalog_or_create_tags(anonymous_client, provider, method, path):
    response = getattr(anonymous_client, method)(
        path, **({'json': {'name': 'Tag'}} if 'tags' in path else {})
    )
    assert response.status_code == 401
    assert provider['requests'] == 0


@pytest.mark.parametrize(
    'claim',
    [
        {'source': 'usda', 'source_id': '123'},
        {'is_shared': True},
        {'verification_status': 'verified'},
        {'user_id': 'user-b'},
        {'sources': []},
    ],
)
def test_personal_creation_cannot_assert_provenance(user_a_client, claim):
    assert (
        user_a_client.post('/api/ingredients/', json={'name': 'Forged', **claim}).status_code == 422
    )
    assert user_a_client.get('/api/ingredients/').json() == []


def test_import_selection_preferences_and_explicit_copy(
    engine, user_a_client, user_b_client, admin_client, provider
):
    a = imported(user_a_client)
    assert user_b_client.get('/api/ingredients/').json() == []
    assert user_b_client.get(f"/api/ingredients/{a['id']}").status_code == 404
    b = imported(user_b_client)
    admin = imported(admin_client)
    assert a['id'] == b['id'] == admin['id'] and a['is_shared'] and a['user_id'] is None
    for client in (user_a_client, user_b_client, admin_client):
        assert (
            client.put(f"/api/ingredients/{a['id']}", json={'name': 'Tampered'}).status_code == 403
        )
        assert client.delete(f"/api/ingredients/{a['id']}").status_code == 403
    cup = next(unit['id'] for unit in a['units'] if unit['name'] == 'cup')
    path = f"/api/ingredients/{a['id']}/shopping-preference"
    assert user_a_client.put(path, json={'unit_id': cup}).json()['shopping_unit_id'] == cup
    assert (
        user_b_client.get(f"/api/ingredients/{a['id']}").json()['shopping_unit_id']
        == b['shopping_unit_id']
    )
    copy = user_a_client.post(f"/api/ingredients/{a['id']}/copy")
    assert copy.status_code == 201, copy.text
    copied = copy.json()
    assert copied['id'] != a['id'] and copied['user_id'] == 'user-a' and not copied['is_shared']
    assert copied['source_id'] is None
    assert {u['id'] for u in copied['units']}.isdisjoint(u['id'] for u in a['units'])
    assert copied['shopping_unit']['name'] == 'cup'
    assert (
        user_a_client.put(f"/api/ingredients/{copied['id']}", json={'name': 'My rice'}).status_code
        == 200
    )
    assert user_b_client.get(f"/api/ingredients/{copied['id']}").status_code == 404
    assert user_a_client.get(f"/api/ingredients/{a['id']}").json()['name'] == 'USDA rice'
    assert (
        user_a_client.put(path, json={'unit_id': None}).json()['shopping_unit_id']
        == a['shopping_unit_id']
    )
    assert user_a_client.delete(f"/api/ingredients/{a['id']}/selection").status_code == 204
    assert user_b_client.get(f"/api/ingredients/{a['id']}").status_code == 200
    with Session(engine) as session:
        assert len(session.exec(select(IngredientSource)).all()) == 1
        assert len(session.exec(select(IngredientProvenanceHistory)).all()) == 1
        assert session.get(Ingredient, a['id']).nutrition.fat == 0


def test_import_rejects_tampering_invalid_records_and_secret_errors(user_a_client, provider):
    assert (
        user_a_client.post('/api/usda/import/123', json={'nutrition': {'fat': 0}}).status_code
        == 422
    )
    assert provider['requests'] == 0
    provider['payload']['foodNutrients'][0]['value'] = -1
    assert user_a_client.post('/api/usda/import/123').status_code == 422
    provider['payload'] = food(456)
    assert user_a_client.post('/api/usda/import/123').status_code == 502
    provider['error'] = True
    for path in ('/api/usda/search?query=rice', '/api/usda/foods/123', '/api/usda/import/123'):
        response = user_a_client.post(path) if '/import/' in path else user_a_client.get(path)
        assert response.status_code == 502
        assert 'TOP-SECRET' not in response.text and 'api_key' not in response.text
    assert user_a_client.get('/api/ingredients/').json() == []


def test_plan_and_unit_validation_and_reference_safe_deletion(
    user_a_client, user_b_client, admin_client
):
    a, b = personal(user_a_client), personal(user_b_client)
    unit = a['units'][0]['id']
    assert (
        user_a_client.post(
            '/api/plans/',
            json={
                'label': 'Bad',
                'payload': {'plan': [{'type': 'ingredient', 'ingredientId': str(b['id'])}]},
            },
        ).status_code
        == 404
    )
    assert (
        user_a_client.post(
            '/api/plans/',
            json={
                'label': 'Bad',
                'payload': {
                    'plan': [
                        {
                            'type': 'ingredient',
                            'ingredientId': str(a['id']),
                            'unitId': b['units'][0]['id'],
                        }
                    ]
                },
            },
        ).status_code
        == 400
    )
    assert (
        user_a_client.put(
            f"/api/ingredients/{a['id']}/shopping-preference", json={'unit_id': b['units'][0]['id']}
        ).status_code
        == 400
    )
    assert (
        user_a_client.put(
            f"/api/ingredients/{a['id']}",
            json={
                'name': 'Personal',
                'units': [{'id': b['units'][0]['id'], 'name': 'cup', 'grams': 100}],
            },
        ).status_code
        == 400
    )
    assert (
        user_a_client.put(
            f"/api/ingredients/{a['id']}",
            json={'name': 'Personal', 'units': [{'id': unit, 'name': 'cup', 'grams': 200}]},
        ).status_code
        == 409
    )
    recipe = user_a_client.post(
        '/api/foods/',
        json={
            'name': 'Recipe',
            'ingredients': [{'ingredient_id': a['id'], 'unit_id': unit, 'unit_quantity': 1}],
        },
    ).json()
    plan = user_a_client.post(
        '/api/plans/',
        json={
            'label': 'Plan',
            'payload': {
                'plan': [
                    {
                        'type': 'food',
                        'foodId': str(recipe['id']),
                        'overrides': {str(a['id']): {'unitId': unit, 'quantity': 2}},
                    }
                ]
            },
        },
    )
    assert plan.status_code == 201, plan.text
    assert user_a_client.delete(f"/api/ingredients/{a['id']}").status_code == 409
    assert user_a_client.delete(f"/api/foods/{recipe['id']}").status_code == 409
    assert (
        user_a_client.put(
            f"/api/foods/{recipe['id']}", json={'name': 'Empty', 'ingredients': []}
        ).status_code
        == 400
    )
    for client in (user_b_client, admin_client):
        assert client.delete(f"/api/foods/{recipe['id']}").status_code == 404
        assert client.get(f"/api/plans/{plan.json()['id']}").status_code == 404
    assert user_a_client.delete(f"/api/plans/{plan.json()['id']}").status_code == 204
    assert user_a_client.delete(f"/api/foods/{recipe['id']}").status_code == 200
    assert user_a_client.delete(f"/api/ingredients/{a['id']}").status_code == 200


def test_origin_boundaries(user_a_client):
    for origin in ('https://evil.invalid', 'null', ''):
        assert (
            user_a_client.post(
                '/api/ingredients/', json={'name': 'Bad'}, headers={'Origin': origin}
            ).status_code
            == 403
        )
    user_a_client.headers.pop('Origin')
    assert user_a_client.post('/api/ingredients/', json={'name': 'Bad'}).status_code == 403
    assert (
        user_a_client.post(
            '/api/ingredients/', json={'name': 'Good'}, headers={'Origin': 'http://testserver'}
        ).status_code
        == 201
    )


def test_login_budget_persists_and_expires(anonymous_client, monkeypatch):
    import Backend.auth.security as security

    monkeypatch.setattr(security.time, 'time', lambda: 900000)
    for _ in range(10):
        assert (
            anonymous_client.post(
                '/api/auth/login', json={'email': 'absent@example.com', 'password': 'wrong'}
            ).status_code
            == 401
        )
    response = anonymous_client.post(
        '/api/auth/login', json={'email': 'absent@example.com', 'password': 'wrong'}
    )
    assert response.status_code == 429 and response.headers['Retry-After'] == '900'
    monkeypatch.setattr(security.time, 'time', lambda: 900900)
    assert (
        anonymous_client.post(
            '/api/auth/login', json={'email': 'absent@example.com', 'password': 'wrong'}
        ).status_code
        == 401
    )


def test_password_change_rolls_back_with_revocation_failure(engine, user_a_client, monkeypatch):
    from Backend.auth.passwords import verify_password
    from Backend.routes import auth

    def fail(*args, **kwargs):
        raise RuntimeError('injected revocation failure')

    monkeypatch.setattr(auth, 'revoke_all_user_sessions', fail)
    with pytest.raises(RuntimeError):
        user_a_client.post(
            '/api/auth/change-password',
            json={'current_password': 'Password123!', 'new_password': 'new-password'},
        )
    with Session(engine) as session:
        assert verify_password('Password123!', session.get(User, 'user-a').password_hash)
        assert session.exec(select(AuthSession)).first() is not None


def test_concurrent_imports_share_one_canonical_record(
    engine, user_a_client, user_b_client, provider
):
    if engine.dialect.name != 'postgresql':
        pytest.skip('Required PostgreSQL run exercises advisory locks')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(imported, (user_a_client, user_b_client)))
    assert results[0]['id'] == results[1]['id']
    with Session(engine) as session:
        assert len(session.exec(select(IngredientSource)).all()) == 1
        assert len(session.exec(select(CatalogSelection)).all()) == 2


def test_history_blocks_source_deletion_and_survives_stored_food_removal(
    user_a_client, user_b_client
):
    ingredient = personal(user_a_client)
    stored = user_a_client.post(
        '/api/stored_food/',
        json={
            'ingredient_id': ingredient['id'],
            'prepared_portions': 2,
            'per_portion_calories': 10,
            'per_portion_protein': 1,
            'per_portion_carbohydrates': 2,
            'per_portion_fat': 0,
            'per_portion_fiber': 3,
        },
    )
    assert stored.status_code == 201, stored.text
    stored_id = stored.json()['id']
    assert user_b_client.delete(f'/api/stored_food/{stored_id}').status_code == 404
    log = user_a_client.post(
        '/api/logs/',
        json={
            'stored_food_id': stored_id,
            'log_date': '2026-01-01',
            'portions_consumed': 1,
            'calories': 10,
            'protein': 1,
            'carbohydrates': 2,
            'fat': 0,
            'fiber': 3,
        },
    )
    assert log.status_code == 201
    assert user_a_client.delete(f"/api/ingredients/{ingredient['id']}").status_code == 409
    assert user_a_client.delete(f'/api/stored_food/{stored_id}').status_code == 204
    history = user_a_client.get('/api/logs/2026-01-01').json()[0]
    assert history['ingredient_id'] == ingredient['id'] and history['stored_food_id'] is None
    for field in ('calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'id', 'log_date'):
        assert history[field] == log.json()[field]
    assert user_a_client.delete(f"/api/ingredients/{ingredient['id']}").status_code == 409
    assert user_a_client.delete(f"/api/logs/{history['id']}").status_code == 204
    assert user_a_client.delete(f"/api/ingredients/{ingredient['id']}").status_code == 200


def test_concurrent_plan_creation_and_delete_cannot_leave_dangling_json(engine, user_a_client):
    if engine.dialect.name != 'postgresql':
        pytest.skip('Required PostgreSQL run exercises account row locks')
    ingredient = personal(user_a_client)
    from fastapi.testclient import TestClient
    from Backend.backend import app

    with TestClient(app, headers={'Origin': 'http://testserver'}) as other:
        other.cookies.update(user_a_client.cookies)
        with ThreadPoolExecutor(max_workers=2) as pool:
            write = pool.submit(
                user_a_client.post,
                '/api/plans/',
                json={
                    'label': 'Race',
                    'payload': {
                        'plan': [{'type': 'ingredient', 'ingredientId': str(ingredient['id'])}]
                    },
                },
            )
            delete = pool.submit(other.delete, f"/api/ingredients/{ingredient['id']}")
            statuses = (write.result().status_code, delete.result().status_code)
        assert statuses in ((201, 409), (404, 200)), statuses


def test_secure_cookie_attributes(user_a_client, monkeypatch):
    from Backend.routes import auth
    from dataclasses import replace

    monkeypatch.setattr(auth, 'settings', replace(auth.settings, session_secure_cookie=True))
    response = user_a_client.post(
        '/api/auth/login', json={'email': 'user-a@example.com', 'password': 'Password123!'}
    )
    assert response.status_code == 200
    cookie = response.headers['set-cookie'].lower()
    assert (
        'secure' in cookie
        and 'httponly' in cookie
        and 'samesite=lax' in cookie
        and 'path=/' in cookie
    )


def test_concurrent_password_reset_revokes_login_or_rejects_old_password(engine, user_a_client):
    if engine.dialect.name != 'postgresql':
        pytest.skip('Required PostgreSQL run exercises login/reset serialization')
    from Backend.services.accounts import find_user, maintain_account
    from fastapi.testclient import TestClient
    from Backend.backend import app

    def reset():
        with Session(engine) as session, session.begin():
            maintain_account(
                session,
                find_user(session, user_id='user-a'),
                'reset-password',
                password_provider=lambda: 'replacement-password',
            )

    with TestClient(app, headers={'Origin': 'http://testserver'}) as login_client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            login = pool.submit(
                login_client.post,
                '/api/auth/login',
                json={'email': 'user-a@example.com', 'password': 'Password123!'},
            )
            changed = pool.submit(reset)
            assert login.result().status_code in (200, 401)
            changed.result()
        assert login_client.get('/api/auth/me').status_code == 401
        assert user_a_client.get('/api/auth/me').status_code == 401


def test_untrusted_origin_has_no_credentialed_cors_access(user_a_client):
    response = user_a_client.get(
        '/api/ingredients/', headers={'Origin': 'https://untrusted.example'}
    )
    assert 'access-control-allow-origin' not in response.headers


def test_catalog_selection_migration_preserves_dependencies(engine):
    if engine.dialect.name != 'postgresql':
        pytest.skip('PostgreSQL JSON migration validation')
    import importlib
    from uuid import uuid4
    from sqlalchemy import text
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = importlib.import_module(
        'Backend.migrations.versions.d64f0b2c537e_catalog_selections'
    )
    # Transactional DDL in a unique disposable schema; no existing tables are changed.
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            schema = 'catalog_' + uuid4().hex
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET LOCAL search_path = "{schema}"'))
            statements = [
                'CREATE TABLE users (id varchar(36) PRIMARY KEY)',
                'CREATE TABLE ingredients (id integer PRIMARY KEY, is_shared boolean)',
                'CREATE TABLE foods (id integer, user_id varchar(36))',
                'CREATE TABLE food_ingredients (food_id integer, ingredient_id integer)',
                'CREATE TABLE stored_food (owner_user_id varchar(36), ingredient_id integer)',
                'CREATE TABLE daily_log_entries (owner_user_id varchar(36), ingredient_id integer)',
                'CREATE TABLE plans (user_id varchar(36), payload json)',
                'CREATE TABLE user_ingredient_preferences (user_id varchar(36), ingredient_id integer)',
                "INSERT INTO users VALUES ('a'), ('b')",
                'INSERT INTO ingredients VALUES (1,true),(2,true),(3,true),(4,true),(5,true),(6,true),(7,false)',
                "INSERT INTO foods VALUES (1,'a')",
                'INSERT INTO food_ingredients VALUES (1,1)',
                "INSERT INTO stored_food VALUES ('a',2)",
                "INSERT INTO daily_log_entries VALUES ('a',3)",
                "INSERT INTO user_ingredient_preferences VALUES ('b',5),('a',1),('a',7)",
            ]
            for statement in statements:
                connection.execute(text(statement))
            connection.execute(
                text('INSERT INTO plans VALUES (:user_id, CAST(:payload AS json))'),
                [
                    {
                        'user_id': 'b',
                        'payload': '{"plan":[{"type":"ingredient","ingredientId":"4"}]}',
                    },
                    {'user_id': 'a', 'payload': '{"plan":null}'},
                ],
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            selected = set(
                connection.execute(
                    text('SELECT user_id,ingredient_id FROM catalog_selections')
                ).all()
            )
            assert selected == {('a', 1), ('a', 2), ('a', 3), ('b', 4), ('b', 5)}
        finally:
            transaction.rollback()


def test_stale_browser_account_cannot_read_write_or_logout(user_a_client, user_b_client):
    headers = {"X-Account-ID": "user-a"}
    for method, path, body in [
        ("get", "/api/ingredients/", None),
        ("post", "/api/ingredients/", {"name": "A draft with B cookie"}),
        ("post", "/api/auth/logout", None),
    ]:
        response = user_b_client.request(method, path, headers=headers, json=body)
        assert response.status_code == 409
        assert response.headers["X-Account-Mismatch"] == "1"
    assert user_b_client.get("/api/auth/me").status_code == 200
    assert user_b_client.get("/api/ingredients/").json() == []
    own_id = user_b_client.get("/api/auth/me").json()["user"]["id"]
    assert (
        user_b_client.post(
            "/api/ingredients/", headers={"X-Account-ID": own_id}, json={"name": "B's draft"}
        ).status_code
        == 201
    )
