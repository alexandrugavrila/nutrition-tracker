"""Rehearse supported populated upgrades on isolated PostgreSQL schemas only."""
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from datetime import date
from sqlalchemy import MetaData, create_engine, select, text
from alembic.config import Config
from alembic.script import ScriptDirectory
from testsupport.database import validated_test_url

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = "b42d8f0a315c"
STARTS = ("base", "d3f0b1c2e7ad", "b6a1f2c3d4e5", "6b2f8f8d9c11", "8c9d0e1f2a3b", "91b4c6d8e2f0", "a31c7e9f204b", CHECKPOINT)


def populate(connection):
    metadata = MetaData()
    metadata.reflect(connection)
    tables = metadata.tables
    def insert(table, **values):
        connection.execute(tables[table].insert().values(**values))
    if "users" in tables:
        for user in ("fixture-a", "fixture-b"):
            insert("users", id=user, email=user + "@example.invalid", password_hash="fixture-only", display_name=user)
    insert("ingredients", id=101, name="Legacy personal edits")
    insert("ingredients", id=102, name="Other legacy")
    insert("nutrition", id=801, ingredient_id=101, calories=0, protein=1.2345, carbohydrates=2, fat=3, fiber=4)
    insert("ingredient_units", id=201, ingredient_id=101, name="1 g", grams=1)
    insert("ingredient_units", id=202, ingredient_id=101, name="g", grams=1)
    insert("foods", id=301, name="Legacy recipe")
    insert("food_ingredients", food_id=301, ingredient_id=101, unit_id=201, unit_quantity=75)
    if "user_id" in tables["ingredients"].c:
        insert("ingredients", id=103, name="Legacy personal edits")
        insert("foods", id=302, name="Legacy recipe", user_id="fixture-a")
        for number, user in enumerate(("fixture-a", "fixture-b"), 104):
            insert("ingredients", id=number, name="Duplicate private name", user_id=user)
    if "ingredient_sources" in tables:
        source = dict(id=401, ingredient_id=101, source="usda", source_id="unverified-edited-record")
        if "payload_hash" in tables["ingredient_sources"].c:
            source["payload_hash"] = "a" * 64  # Hash alone must never grant verification.
        insert("ingredient_sources", **source)
    if "ingredient_shopping_units" in tables:
        insert("ingredient_shopping_units", ingredient_id=101, unit_id=201)
    if "plans" in tables:
        insert("plans", id=501, label="Legacy plan", payload={"plan":[{"type":"food", "foodId":"301", "overrides":{"101":{"unitId":201}}}]})
    if "stored_food" in tables:
        insert("stored_food", id=601, user_id="legacy-device-A", ingredient_id=101,
            prepared_portions=2, remaining_portions=1, per_portion_calories=10,
            per_portion_protein=1, per_portion_carbohydrates=2, per_portion_fat=3, per_portion_fiber=4)
    if "daily_log_entries" in tables:
        insert("daily_log_entries", id=701, user_id="legacy-device-A", ingredient_id=101,
            log_date=date(2026,1,1), portions_consumed=1, calories=10, protein=1, carbohydrates=2, fat=3, fiber=4)
    snapshot = {}
    for name, table in tables.items():
        if name != "alembic_version":
            rows = connection.execute(select(table)).mappings().all()
            snapshot[name] = [dict(row) for row in rows]
    return snapshot


def main():
    graph = ScriptDirectory.from_config(Config(str(ROOT / "Backend/alembic.ini")))
    assert graph.get_heads() == ["e75a1c3d648f"]
    # Traverse the complete graph, including the users revision's merge parents.
    assert {revision.revision for revision in graph.walk_revisions()} >= set(STARTS) - {"base"}
    project = "nutrition-expansion-" + uuid4().hex[:12]
    compose = ["docker", "compose", "-p", project, "-f", str(ROOT / "testsupport/docker-compose.e2e.yml")]
    env = dict(os.environ)
    for key in ("SQLALCHEMY_DATABASE_URI", "PGOPTIONS", "COMPOSE_FILE", "COMPOSE_PROFILES"):
        env.pop(key, None)
    def run(command, **kwargs):
        subprocess.run(command, cwd=ROOT, env=env, check=True, **kwargs)
    try:
        run(compose + ["up", "-d", "--wait"])
        address = subprocess.check_output(compose + ["port", "db", "5432"], env=env, text=True).strip()
        url = "postgresql://nutrition_test:disposable-test-only@127.0.0.1:" + address.rsplit(":",1)[1] + "/nutrition_test"
        env.update(DATABASE_URL=url, SQLALCHEMY_DATABASE_URI=url, TEST_DATABASE_URL=url,
            TEST_DATABASE_CONFIRM="nutrition_test", ENVIRONMENT="test", DB_AUTO_CREATE="false")
        assert validated_test_url(env) == url
        control = create_engine(url)
        try:
            for start in STARTS:
                schema = "upgrade_" + uuid4().hex
                with control.begin() as connection:
                    connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                env["PGOPTIONS"] = "-c search_path=" + schema
                engine = create_engine(url, connect_args={"options":env["PGOPTIONS"]})
                try:
                    alembic = [sys.executable, "-m", "alembic", "-c", "Backend/alembic.ini"]
                    run(alembic + ["upgrade", start])
                    snapshot = {}
                    if start != "base":
                        with engine.begin() as connection:
                            snapshot = populate(connection)
                    run(alembic + ["upgrade", CHECKPOINT])

                    metadata = MetaData()
                    with engine.connect() as connection:
                        metadata.reflect(connection)
                        for name, rows in snapshot.items():
                            table = metadata.tables[name]
                            if not rows:
                                assert not connection.execute(select(table)).first(), name
                                continue
                            columns = list(rows[0])
                            actual = [dict(row) for row in connection.execute(select(*(table.c[key] for key in columns))).mappings()]
                            assert sorted(actual, key=repr) == sorted(rows, key=repr), name
                        assert connection.execute(text("SELECT count(*) FROM ingredients WHERE is_shared")).scalar_one() == 0
                        assert connection.execute(text("SELECT count(*) FROM ingredient_sources WHERE verification_status != 'unverified'")).scalar_one() == 0
                        for table in ("stored_food", "daily_log_entries"):
                            assert connection.execute(text(f"SELECT count(*) FROM {table} WHERE owner_user_id IS NOT NULL")).scalar_one() == 0
                        for table in ("ownership_adoptions", "ingredient_provenance_history", "user_ingredient_preferences"):
                            assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0
                    if snapshot:
                        rejected = subprocess.run(alembic + ["upgrade", "head"], cwd=ROOT, env=env, capture_output=True, text=True)
                        assert rejected.returncode != 0 and "complete reviewed legacy adoption" in rejected.stderr
                    from testsupport.adoption_checks import rehearse
                    rehearse(engine)
                    if snapshot:
                        with engine.begin() as connection:
                            connection.execute(text("UPDATE users SET display_name = 'Unexpected writer' WHERE id = 'fixture-b'"))
                        rejected = subprocess.run(alembic + ["upgrade", "head"], cwd=ROOT, env=env, capture_output=True, text=True)
                        assert rejected.returncode != 0 and "changed after adoption" in rejected.stderr
                        with engine.begin() as connection:
                            connection.execute(text("UPDATE users SET display_name = :name WHERE id = 'fixture-b'"), {'name':'fixture-b' if 'users' in snapshot else 'Owner'})
                    run(alembic + ["upgrade", "d64f0b2c537e"])
                    def nutrient_snapshots():
                        with engine.connect() as connection:
                            return {table: list(connection.execute(text(f"SELECT * FROM {table} ORDER BY id")).mappings())
                                    for table in ("nutrition", "stored_food", "daily_log_entries")}
                    numeric_history = nutrient_snapshots()
                    run(alembic + ["upgrade", "head"])
                    assert nutrient_snapshots() == numeric_history, "Nutrient migration rewrote historical values"
                    run(alembic + ["check"])
                    from testsupport.adoption_checks import verify_visibility
                    verify_visibility(engine)
                    print(f"PASS {start} -> {CHECKPOINT} -> adoption -> head: preservation, dry-run, stale report, rollback, rerun and drift", flush=True)
                finally:
                    engine.dispose()
                    with control.begin() as connection:
                        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        finally:
            control.dispose()
    finally:
        run(compose + ["down", "--volumes", "--remove-orphans"])


if __name__ == "__main__":
    main()
