"""Build and validate packaged account commands using an isolated, disposable DB."""
from pathlib import Path
import subprocess
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def main():
    project = "nutrition-accounts-" + uuid4().hex[:12]
    image = project + ":phase5"
    compose = ["docker", "compose", "-p", project, "-f", str(ROOT / "testsupport/docker-compose.e2e.yml")]
    def run(args, **kwargs):
        return subprocess.run(args, cwd=ROOT, check=True, text=True, **kwargs)
    started = False
    try:
        run(["docker", "build", "-f", "Backend/Dockerfile", "--target", "prod", "-t", image, "."])
        started = True
        run(compose + ["up", "-d", "--wait"])
        base = ["docker", "run", "--rm", "-i", "--network", project + "_default",
                "-e", "DATABASE_URL=postgresql://nutrition_test:disposable-test-only@db:5432/nutrition_test",
                "-e", "ENVIRONMENT=production", "-e", "DB_AUTO_CREATE=false", image, "python"]
        run(base + ["-m", "alembic", "-c", "Backend/alembic.ini", "upgrade", "head"])
        run(base + ["-m", "alembic", "-c", "Backend/alembic.ini", "check"])
        admin = ["-m", "Backend.commands.create_admin", "--email", "admin@example.com", "--display-name", "Admin", "--password-stdin"]
        run(base + admin, input="initial-password\n")
        run(base + admin, input="")  # no password or mutation on repeat
        run(base + ["-c", "from Backend.db import engine; from Backend.models import *; from sqlmodel import Session,select; s=Session(engine); assert len(s.exec(select(User)).all())==1; assert not s.exec(select(Ingredient)).all(); assert not s.exec(select(Food)).all(); assert not s.exec(select(Plan)).all()"])
        seed = ["-m", "Backend.commands.seed_starter_data", "--email", "admin@example.com"]
        run(base + seed)
        run(base + seed)
        for action in ("deactivate", "activate", "reset-password"):
            run(base + ["-c", "from Backend.db import engine; from Backend.models import User; from Backend.auth.sessions import create_auth_session; from sqlmodel import Session,select; s=Session(engine); create_auth_session(s,s.exec(select(User)).one(),ttl_days=1); s.commit()"])
            command = ["-m", "Backend.commands.manage_account", action, "--email", "admin@example.com"]
            if action == "reset-password":
                command += ["--password-stdin"]
            run(base + command, input="replacement-password\n")
            run(base + ["-c", "from Backend.db import engine; from Backend.models import AuthSession; from sqlmodel import Session,select; s=Session(engine); assert not s.exec(select(AuthSession)).all()"])
        run(base + ["-c", "from Backend.db import engine; from Backend.models import User; from Backend.auth.passwords import verify_password; from sqlmodel import Session,select; s=Session(engine); u=s.exec(select(User)).one(); assert u.is_active and verify_password('replacement-password',u.password_hash); u.is_admin=False; s.add(u); s.commit()"])
        result = subprocess.run(base + admin, cwd=ROOT, input="", text=True, capture_output=True)
        assert result.returncode == 1 and "non-admin" in result.stderr
        # Independent schema rehearses the packaged adoption commands at the expansion checkpoint.
        run(base + ["-c", "from Backend.db import engine; from sqlalchemy import text; c=engine.connect(); c.execute(text('CREATE SCHEMA adoption_smoke')); c.commit()"])
        adoption_base = base[:-2] + ["-e", "PGOPTIONS=-c search_path=adoption_smoke"] + base[-2:]
        run(adoption_base + ["-m", "alembic", "-c", "Backend/alembic.ini", "upgrade", "b42d8f0a315c"])
        run(adoption_base + admin, input="initial-password\n")
        run(adoption_base + ["-m", "Backend.commands.manage_account", "create-user", "--email", "owner@example.com", "--display-name", "Owner", "--password-stdin"], input="owner-password\n")
        run(adoption_base + ["-c", "from Backend.db import engine; from sqlalchemy import text; c=engine.connect(); c.execute(text(\"INSERT INTO ingredients(name) VALUES ('Legacy'),('Legacy'); INSERT INTO ingredient_units(ingredient_id,name,grams) SELECT min(id),'1 g',1.2345 FROM ingredients\")); c.commit()"])
        report = run(adoption_base + ["-m", "Backend.commands.adopt_legacy", "--email", "owner@example.com", "--dry-run"], capture_output=True).stdout
        apply_code = "import sys,tempfile; from pathlib import Path; from Backend.commands.adopt_legacy import main; d=tempfile.TemporaryDirectory(); p=Path(d.name)/'reviewed.json'; p.write_text(sys.stdin.read()); raise SystemExit(main(['--email','owner@example.com','--apply','--report',str(p)]))"
        run(adoption_base + ["-c", apply_code], input=report)
        run(adoption_base + ["-m", "alembic", "-c", "Backend/alembic.ini", "upgrade", "head"])
        run(adoption_base + ["-m", "alembic", "-c", "Backend/alembic.ini", "check"])
        run(adoption_base + ["-c", apply_code], input=report)
        # Exercise the packaged Foundation CLI on a container-local artifact, without a key or mount.
        sync_smoke = """
import hashlib, json, sys, tempfile
from pathlib import Path
from Backend.commands.sync_usda_foundation import main
from Backend.db import engine
from Backend.models import CatalogSyncRun, IngredientSource
from sqlmodel import Session, select
payload = {'FoundationFoods': [{'fdcId': 1234567, 'description': 'Smoke Foundation', 'dataType': 'Foundation', 'foodNutrients': [{'nutrientId': 1004, 'value': 0, 'unitName': 'g'}]}]}
with tempfile.TemporaryDirectory() as directory:
    path = Path(directory) / 'foundation.json'
    path.write_text(json.dumps(payload))
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    sys.argv = ['sync', '--input', str(path), '--mark-stale', '--complete-snapshot', '--expected-count', '1', '--expected-sha256', checksum]
    assert main() == 0
    assert main() == 0
with Session(engine) as session:
    source = session.exec(select(IngredientSource).where(IngredientSource.source_id == '1234567')).one()
    assert source.ingredient.nutrition.fat == 0 and source.ingredient.nutrition.fiber is None
    runs = session.exec(select(CatalogSyncRun).order_by(CatalogSyncRun.id)).all()
    assert len(runs) == 2 and all(r.status == 'succeeded' and r.artifact_sha256 == checksum for r in runs)
    assert runs[-1].summary['unchanged'] == 1
"""
        run(base + ["-c", sync_smoke])
        run(["docker", "image", "inspect", "--format", "{{.Id}}", image])
        print("Production account and Foundation command smoke passed (no mounts, no USDA key).")
    finally:
        if started:
            run(compose + ["down", "--volumes", "--remove-orphans"])
        subprocess.run(["docker", "image", "rm", image], cwd=ROOT, check=False)


if __name__ == "__main__":
    main()
