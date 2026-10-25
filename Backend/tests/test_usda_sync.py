import json
import zipfile
from pathlib import Path

from sqlmodel import Session, select

from Backend.commands.convert_usda_foundation_manifest import main as convert_manifest_main
from Backend.commands.sync_usda_foundation import _load_payload, sync_usda_foundation
from Backend.models import Food, FoodIngredient, Ingredient, IngredientSource


def _food_payload(fdc_id: int, description: str, protein: float = 1.0) -> dict:
    return {
        "FoundationFoods": [
            {
                "fdcId": fdc_id,
                "description": description,
                "dataType": "Foundation",
                "foodNutrients": [
                    {
                        "nutrientId": 1008,
                        "nutrientName": "Energy",
                        "unitName": "kcal",
                        "value": 100,
                    },
                    {
                        "nutrientId": 1003,
                        "nutrientName": "Protein",
                        "unitName": "g",
                        "value": protein,
                    },
                    {
                        "nutrientId": 1004,
                        "nutrientName": "Total lipid (fat)",
                        "unitName": "g",
                        "value": 2,
                    },
                    {
                        "nutrientId": 1005,
                        "nutrientName": "Carbohydrate, by difference",
                        "unitName": "g",
                        "value": 3,
                    },
                    {
                        "nutrientId": 1079,
                        "nutrientName": "Fiber, total dietary",
                        "unitName": "g",
                        "value": 4,
                    },
                ],
                "foodPortions": [],
            }
        ]
    }


def test_missing_input_and_incomplete_stale_flags_fail_before_io(monkeypatch):
    import pytest
    import Backend.commands.sync_usda_foundation as command

    def forbidden(*args, **kwargs):
        raise AssertionError("Invalid invocation must perform no I/O")

    monkeypatch.setattr(command, "_read_artifact", forbidden)
    monkeypatch.setattr(command, "Session", forbidden)
    monkeypatch.delenv("USDA_FOUNDATION_FOODS_JSON", raising=False)
    monkeypatch.setattr("sys.argv", ["sync"])
    with pytest.raises(SystemExit, match="Provide --input"):
        command.main()
    monkeypatch.setattr("sys.argv", ["sync", "--input", "ignored", "--mark-stale"])
    with pytest.raises(SystemExit, match="complete-snapshot"):
        command.main()


def test_unit_helper_retains_referenced_legacy_alias(engine, user_a_client):
    from Backend.commands.sync_usda_foundation import _sync_units
    from Backend.models import IngredientUnit

    with Session(engine) as session:
        ingredient = Ingredient(
            name="Personal",
            user_id="user-a",
            units=[IngredientUnit(name="1 g", grams=1), IngredientUnit(name="g", grams=1)],
        )
        session.add(ingredient)
        session.flush()
        alias = ingredient.units[0].id
        food = Food(
            name="Recipe",
            user_id="user-a",
            ingredients=[
                FoodIngredient(ingredient_id=ingredient.id, unit_id=alias, unit_quantity=50)
            ],
        )
        session.add(food)
        session.commit()
        _sync_units(ingredient, [{"name": "g", "grams": 1}])
        session.commit()
        assert food.ingredients[0].unit_id == alias
        assert session.get(IngredientUnit, alias).name == "1 g"
        assert len(ingredient.units) == 2


def test_usda_sync_loads_zipped_json(tmp_path) -> None:
    archive_path = tmp_path / "foundation.zip"
    expected = _food_payload(400, "Zipped Food")
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("FoodData_Central_foundation_food_json.json", json.dumps(expected))

    assert _load_payload(str(archive_path)) == expected


def test_usda_manifest_converter_writes_usda_ingredients(tmp_path, monkeypatch) -> None:
    archive_path = tmp_path / "foundation.zip"
    manifest_path = tmp_path / "starter.json"
    expected = _food_payload(500, "Manifest Food")
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("FoodData_Central_foundation_food_json.json", json.dumps(expected))
    manifest_path.write_text(
        json.dumps({"version": 1, "catalog_ingredients": [{"slug": "old"}]}),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "sys.argv",
        [
            "convert-usda",
            "--input",
            str(archive_path),
            "--manifest",
            str(manifest_path),
        ],
    )

    assert convert_manifest_main() == 0
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    assert "catalog_ingredients" not in manifest
    assert manifest["usda_ingredients"] == [
        {
            "slug": "usda-500",
            "name": "Manifest Food",
            "source": "usda",
            "source_id": "500",
        }
    ]


def test_repeat_sync_retains_aliases_references_and_changed_conversions(engine, user_a_client):
    from Backend.models import (
        IngredientUnit,
        UserIngredientPreference,
        CatalogSelection,
        CatalogSyncRun,
    )

    payload = _food_payload(600, "Reference food")
    payload['FoundationFoods'][0]['foodPortions'] = [
        {'gramWeight': 100, 'portionDescription': 'cup'}
    ]
    with Session(engine) as db:
        assert sync_usda_foundation(db, payload)['created'] == 1
        source = db.exec(select(IngredientSource)).one()
        ingredient = source.ingredient
        iid = ingredient.id
        cup = next(u for u in ingredient.units if u.name == 'cup')
        old_cup = cup.id
        alias = IngredientUnit(name='1 g', grams=1, ingredient_id=iid)
        db.add(alias)
        db.flush()
        alias_id = alias.id
        food = Food(
            name='Referenced',
            user_id='user-a',
            ingredients=[FoodIngredient(ingredient_id=iid, unit_id=alias.id, unit_quantity=25)],
        )
        second = Food(
            name='Cup recipe',
            user_id='user-a',
            ingredients=[FoodIngredient(ingredient_id=iid, unit_id=old_cup, unit_quantity=2)],
        )
        db.add(food)
        db.add(second)
        db.add(CatalogSelection(user_id='user-a', ingredient_id=iid))
        db.add(UserIngredientPreference(user_id='user-a', ingredient_id=iid, unit_id=alias.id))
        db.commit()
        counts = sync_usda_foundation(db, payload)
        assert counts == dict(created=0, updated=0, unchanged=1, stale=0)
        payload['FoundationFoods'][0]['foodPortions'][0]['gramWeight'] = 120
        payload['FoundationFoods'][0]['foodNutrients'].pop()
        assert sync_usda_foundation(db, payload)['updated'] == 1
        db.expire_all()
        ingredient = db.get(Ingredient, iid)
        assert db.get(IngredientUnit, old_cup).grams == 100
        assert db.get(IngredientUnit, alias_id).name == '1 g'
        assert len([u for u in ingredient.units if u.name == 'g' and u.grams == 1]) == 1
        assert sorted(u.grams for u in ingredient.units if u.name == 'cup') == [100, 120]
        assert ingredient.nutrition.fiber is None
        assert second.ingredients[0].unit_id == old_cup
        assert food.ingredients[0].unit_id == alias_id
        assert db.get(UserIngredientPreference, ('user-a', iid)).unit_id == alias_id
        assert db.exec(select(CatalogSyncRun)).all()[-1].status == 'succeeded'
        db.commit()
        assert sync_usda_foundation(db, payload)['unchanged'] == 1


def test_stale_marking_requires_reviewed_complete_foundation_and_spares_personal(
    engine, user_a_client
):
    from Backend.commands.sync_usda_foundation import _hash_payload
    from Backend.models import CatalogSyncRun
    from Backend.services.catalog import import_verified
    from Backend.models import User

    a, b = _food_payload(700, 'First'), _food_payload(701, 'Second')
    with Session(engine) as db:
        sync_usda_foundation(db, a)
        sync_usda_foundation(db, b)
        db.add(
            Ingredient(
                name='Personal',
                user_id='user-a',
                sources=[IngredientSource(source='usda', source_id='999')],
            )
        )
        user = db.get(User, 'user-a')
        api = import_verified(db, user, 702, _food_payload(702, 'API only')['FoundationFoods'][0])
        db.commit()
        result = sync_usda_foundation(
            db,
            a,
            mark_stale=True,
            complete_snapshot=True,
            expected_count=1,
            expected_sha256=_hash_payload(a),
        )
        assert result['stale'] == 1
        sources = {s.source_id: s for s in db.exec(select(IngredientSource)).all()}
        assert sources['701'].is_stale
        assert not sources['700'].is_stale
        assert not sources['702'].is_stale
        assert not sources['999'].is_stale and sources['999'].ingredient.user_id == 'user-a'
        db.commit()
        sync_usda_foundation(db, b)
        assert (
            not db.exec(select(IngredientSource).where(IngredientSource.source_id == '701'))
            .one()
            .is_stale
        )


import pytest


@pytest.mark.parametrize(
    'kind',
    [
        'empty',
        'unknown',
        'malformed',
        'nonfoundation',
        'duplicate',
        'conflict',
        'badnutrient',
        'badportion',
        'count',
        'checksum',
        'partial',
    ],
)
def test_invalid_snapshot_never_mutates_catalog(engine, kind):
    from copy import deepcopy
    from Backend.commands.sync_usda_foundation import _hash_payload
    from Backend.models import CatalogSyncRun

    original = _food_payload(800, 'Keep')
    payload = _food_payload(801, 'Never inserted')
    options = {}
    if kind == 'empty':
        payload = {'FoundationFoods': []}
    elif kind == 'unknown':
        payload = {'Other': []}
    elif kind == 'malformed':
        payload['FoundationFoods'].append(None)
    elif kind == 'nonfoundation':
        payload['FoundationFoods'][0]['dataType'] = 'Branded'
    elif kind in ('duplicate', 'conflict'):
        payload['FoundationFoods'].append(deepcopy(payload['FoundationFoods'][0]))
        if kind == 'conflict':
            payload['FoundationFoods'][1]['description'] = 'Conflict'
    elif kind == 'badnutrient':
        payload['FoundationFoods'][0]['foodNutrients'][0]['value'] = 'invalid'
    elif kind == 'badportion':
        payload['FoundationFoods'][0]['foodPortions'] = [{'gramWeight': -1}]
    elif kind == 'count':
        options = dict(expected_count=2)
    elif kind == 'checksum':
        options = dict(expected_sha256='0' * 64)
    elif kind == 'partial':
        options = dict(mark_stale=True)
    with Session(engine) as db:
        sync_usda_foundation(db, original)
        with pytest.raises(ValueError):
            sync_usda_foundation(db, payload, **options)
        assert [i.name for i in db.exec(select(Ingredient)).all()] == ['Keep']
        assert not db.exec(select(IngredientSource)).one().is_stale
        runs = db.exec(select(CatalogSyncRun).order_by(CatalogSyncRun.id)).all()
        assert [r.status for r in runs] == ['succeeded', 'failed']
        assert runs[-1].artifact_sha256 == _hash_payload(payload)


def test_personal_provider_mapping_is_never_published(engine, user_a_client):
    with Session(engine) as db:
        db.add(
            Ingredient(
                name='Private edits',
                user_id='user-a',
                sources=[IngredientSource(source='usda', source_id='900')],
            )
        )
        db.commit()
        with pytest.raises(ValueError, match='reconciliation'):
            sync_usda_foundation(db, _food_payload(900, 'External'))
        row = db.exec(select(Ingredient)).one()
        assert row.name == 'Private edits' and row.user_id == 'user-a' and not row.is_shared


def test_injected_failure_rolls_back_previous_updates_and_keeps_failure_audit(engine, monkeypatch):
    from Backend.services import foundation_sync as service
    from Backend.models import CatalogSyncRun

    payload = _food_payload(910, 'Original')
    with Session(engine) as db:
        sync_usda_foundation(db, payload)
        payload['FoundationFoods'][0]['description'] = 'Must roll back'
        payload['FoundationFoods'] += _food_payload(911, 'Fail here')['FoundationFoods']
        original = service._upsert_nutrition

        def fail(ingredient, values):
            if ingredient.name == 'Fail here':
                raise RuntimeError('injected')
            original(ingredient, values)

        monkeypatch.setattr(service, '_upsert_nutrition', fail)
        with pytest.raises(RuntimeError, match='injected'):
            sync_usda_foundation(db, payload)
        assert [i.name for i in db.exec(select(Ingredient)).all()] == ['Original']
        assert [
            r.status for r in db.exec(select(CatalogSyncRun).order_by(CatalogSyncRun.id)).all()
        ] == ['succeeded', 'failed']


@pytest.mark.parametrize('second_kind', ['bulk', 'identifier'])
def test_provider_lock_serializes_bulk_and_identifier_imports(
    engine, user_a_client, monkeypatch, second_kind
):
    if engine.dialect.name != 'postgresql':
        pytest.skip('PostgreSQL advisory locking')
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from sqlalchemy import text
    from Backend.services import foundation_sync as service
    from Backend.services.catalog import import_verified
    from Backend.models import User

    entered, release = Event(), Event()
    original = service._sync_units

    def hold(ingredient, units):
        if not entered.is_set():
            entered.set()
            assert release.wait(15)
        return original(ingredient, units)

    monkeypatch.setattr(service, '_sync_units', hold)
    payload = _food_payload(920, 'Concurrent')

    def first():
        with Session(engine) as db:
            return sync_usda_foundation(db, payload)

    def second():
        with Session(engine) as db:
            if second_kind == 'bulk':
                return sync_usda_foundation(db, payload)
            user = db.get(User, 'user-a')
            result = import_verified(db, user, 920, payload['FoundationFoods'][0])
            db.commit()
            return result.id

    with ThreadPoolExecutor(2) as pool:
        future = pool.submit(first)
        assert entered.wait(15)
        try:
            with Session(engine) as db:
                assert not db.execute(
                    text('SELECT pg_try_advisory_xact_lock_shared(643220, 1)')
                ).scalar()
            other = pool.submit(second)
        finally:
            release.set()
        future.result(timeout=20)
        other.result(timeout=20)
    with Session(engine) as db:
        assert len(db.exec(select(Ingredient)).all()) == 1
        assert len(db.exec(select(IngredientSource)).all()) == 1


def test_loader_rejects_truncated_duplicate_keys_and_ambiguous_zip(tmp_path):
    for raw in [
        '{"FoundationFoods": [',
        '{"FoundationFoods":[],"FoundationFoods":[]}',
        '{"x":NaN}',
    ]:
        path = tmp_path / 'bad.json'
        path.write_text(raw)
        with pytest.raises(ValueError):
            _load_payload(str(path))
    path = tmp_path / 'ambiguous.zip'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('Foundation1.json', '{}')
        archive.writestr('Foundation2.json', '{}')
    with pytest.raises(ValueError):
        _load_payload(str(path))


def test_sync_supports_explicit_idempotent_starter_seeding(engine, user_a_client):
    from Backend.models import User
    from Backend.services.onboarding import seed_user_starter_data

    with Session(engine) as db:
        sync_usda_foundation(db, _food_payload(930, 'Starter source'))
        user = db.get(User, 'user-a')
        manifest = {
            'version': 99,
            'foods': [
                {
                    'slug': 'recipe',
                    'name': 'Starter recipe',
                    'ingredients': [
                        {'source': 'usda', 'source_id': '930', 'unit_name': 'g', 'quantity': 10}
                    ],
                }
            ],
        }
        first = seed_user_starter_data(db, user, manifest=manifest)
        db.commit()
        assert first['foods'] == 1
        assert seed_user_starter_data(db, user, manifest=manifest)['foods'] == 0
        db.commit()
        assert len(db.exec(select(Food)).all()) == 1


def test_unit_precision_does_not_create_duplicates(engine):
    payload = _food_payload(940, 'Precision')
    payload['FoundationFoods'][0]['foodPortions'] = [
        {'gramWeight': 12.123456, 'portionDescription': 'slice'}
    ]
    with Session(engine) as db:
        sync_usda_foundation(db, payload)
        assert sync_usda_foundation(db, payload)['unchanged'] == 1
        ingredient = db.exec(select(Ingredient)).one()
        assert [u.grams for u in ingredient.units if u.name == 'slice'] == [12.1235]


def test_load_failure_audit_redacts_url_credentials(engine, monkeypatch):
    import Backend.commands.sync_usda_foundation as command
    from Backend.models import CatalogSyncRun

    monkeypatch.setattr(command, 'engine', engine)

    def fail(*args, **kwargs):
        raise RuntimeError('TOP-SECRET upstream URL')

    monkeypatch.setattr(command, '_read_artifact', fail)
    monkeypatch.setattr(
        'sys.argv',
        [
            'sync',
            '--input',
            'https://name:TOP-SECRET@example.invalid/foundation.zip?api_key=TOP-SECRET',
        ],
    )
    with pytest.raises(SystemExit) as error:
        command.main()
    assert 'TOP-SECRET' not in str(error.value)
    with Session(engine) as db:
        run = db.exec(select(CatalogSyncRun)).one()
        assert (
            run.status == 'failed' and run.artifact_uri == 'https://example.invalid/foundation.zip'
        )
        assert 'TOP-SECRET' not in str(run.summary)
        assert not db.exec(select(Ingredient)).all()


def test_truncated_file_failure_records_exact_artifact_hash(engine, monkeypatch, tmp_path):
    import hashlib
    import Backend.commands.sync_usda_foundation as command
    from Backend.models import CatalogSyncRun

    path = tmp_path / 'truncated.json'
    path.write_bytes(b'{"FoundationFoods":[')
    monkeypatch.setattr(command, 'engine', engine)
    monkeypatch.setattr('sys.argv', ['sync', '--input', str(path)])
    with pytest.raises(SystemExit, match='could not be loaded'):
        command.main()
    with Session(engine) as db:
        run = db.exec(select(CatalogSyncRun)).one()
        assert (
            run.status == 'failed'
            and run.artifact_sha256 == hashlib.sha256(path.read_bytes()).hexdigest()
        )
        assert not db.exec(select(Ingredient)).all()


def test_provider_legacy_gram_label_import_is_idempotent(engine):
    payload = _food_payload(950, 'Gram aliases')
    payload['FoundationFoods'][0]['foodPortions'] = [{'gramWeight': 1, 'portionDescription': '1 g'}]
    with Session(engine) as db:
        sync_usda_foundation(db, payload)
        assert sync_usda_foundation(db, payload)['unchanged'] == 1
        ingredient = db.exec(select(Ingredient)).one()
        assert [(u.name, u.grams) for u in ingredient.units] == [('g', 1)]
