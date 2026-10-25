import copy
import io
import pytest
from fastapi import HTTPException
from sqlmodel import Session, select
from Backend.auth.passwords import verify_password
from Backend.auth.sessions import create_auth_session
from Backend.commands._accounts import read_password
from Backend.models import User, AuthSession, Ingredient, Food, Plan, UserStarterSeed
from Backend.services.accounts import bootstrap_admin, maintain_account
from Backend.services.onboarding import load_starter_manifest, seed_user_starter_data


def bootstrap(session):
    assert bootstrap_admin(session, email=" Admin@Example.com ", display_name="Admin", password_provider=lambda: "initial-password")
    return session.exec(select(User)).one()


def test_bootstrap_empty_repeat_and_nonadmin_collision(engine):
    with Session(engine) as session, session.begin():
        user = bootstrap(session)
        assert not session.exec(select(Ingredient)).all()
        assert not session.exec(select(Food)).all()
        assert not session.exec(select(Plan)).all()
        user.is_active = False
        session.add(user)
        session.flush()
        assert not bootstrap_admin(session, email=user.email, display_name="Changed", password_provider=lambda: pytest.fail("No password read on repeat"))
        assert user.display_name == "Admin" and not user.is_active
        user.is_admin = False
        session.add(user)
        session.flush()
        with pytest.raises(ValueError, match="non-admin"):
            bootstrap_admin(session, email=user.email, display_name="Admin", password_provider=lambda: pytest.fail("No promotion"))


@pytest.mark.parametrize("action", ["reset-password", "activate", "deactivate"])
def test_account_change_revokes_sessions_atomically(engine, action):
    with Session(engine) as session:
        user = bootstrap(session)
        create_auth_session(session, user, ttl_days=14)
        session.commit()
        uid = user.id
        maintain_account(session, user, action, password_provider=lambda: "replacement-password")
        assert not session.exec(select(AuthSession)).all()
        session.rollback()
        assert len(session.exec(select(AuthSession)).all()) == 1
        assert verify_password("initial-password", session.get(User, uid).password_hash)
        maintain_account(session, session.get(User, uid), action, password_provider=lambda: "replacement-password")
        session.commit()
        assert not session.exec(select(AuthSession)).all()
        user = session.get(User, uid)
        if action == "reset-password":
            assert verify_password("replacement-password", user.password_hash)
        else:
            assert user.is_active == (action == "activate")


def test_seed_failure_rolls_back_and_completed_version_preserves_edits(engine):
    with Session(engine) as session:
        user = bootstrap(session)
        session.commit()
        manifest = load_starter_manifest()
        bad = copy.deepcopy(manifest)
        bad["foods"].append({"slug": "missing", "name": "Missing source", "ingredients": [{"source": "USDA", "source_id": "absent"}]})
        with pytest.raises(HTTPException):
            seed_user_starter_data(session, user, manifest=bad)
        session.commit()  # even catching and committing must not persist partial data
        for model in (Ingredient, Food, Plan, UserStarterSeed):
            assert not session.exec(select(model)).all()
        seed_user_starter_data(session, user, manifest=manifest)
        session.commit()
        food = session.exec(select(Food)).one()
        food.name = "My edited breakfast"
        session.add(food)
        session.delete(session.exec(select(Plan)).one())
        session.commit()
        assert seed_user_starter_data(session, user, manifest=manifest) == {"ingredients": 0, "foods": 0, "plans": 0}
        assert session.exec(select(Food)).one().name == "My edited breakfast"
        assert not session.exec(select(Plan)).all()
        bad["version"] = manifest["version"]
        with pytest.raises(ValueError, match="new version"):
            seed_user_starter_data(session, user, manifest=bad)


def test_password_input(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(" a secret with spaces \n"))
    assert read_password(True) == " a secret with spaces "
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    with pytest.raises(ValueError, match="empty"):
        read_password(True)
    with pytest.raises(ValueError, match="terminal"):
        read_password(False)


def test_password_prompt_never_falls_back_to_echo(monkeypatch):
    import getpass
    import warnings
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    def unavailable(prompt):
        warnings.warn("Cannot disable echo", getpass.GetPassWarning)
        pytest.fail("Must not continue to an echoed password read")
    monkeypatch.setattr(getpass, "getpass", unavailable)
    with pytest.raises(ValueError, match="Hidden password entry"):
        read_password(False)
