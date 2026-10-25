"""Assertions for the migration-created, disposable adoption rehearsal."""
from sqlalchemy import event, text
from sqlmodel import Session
from Backend.services.adoption import apply_report, build_report, snapshot


def rehearse(engine):
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users(id,email,password_hash,display_name,is_admin) VALUES ('fixture-a','fixture-a@example.invalid','fixture-only','Admin',true), ('fixture-b','fixture-b@example.invalid','fixture-only','Owner',false) ON CONFLICT (id) DO NOTHING"))
        connection.execute(text("UPDATE users SET is_admin = (id = 'fixture-a')"))
    with Session(engine) as session:
        before = snapshot(session)
        report = build_report(session, 'fixture-b')
        assert not report['blockers'], report['blockers']
        assert snapshot(session) == before, 'Dry-run mutated data'
        assert build_report(session, 'fixture-b') == report
        assert build_report(session, 'fixture-a')['blockers']
    # A changed database must not accept a previously reviewed report.
    with Session(engine) as session, session.begin():
        session.execute(text("UPDATE users SET display_name = 'Changed' WHERE id = 'fixture-b'"))
        try:
            apply_report(session, 'fixture-b', report)
        except ValueError as exc:
            assert 'does not match' in str(exc)
        else:
            raise AssertionError('Stale report accepted')
        session.rollback()
    # Corrupt embedded references are blockers, without any attempted repair.
    with Session(engine) as session, session.begin():
        session.execute(text("INSERT INTO plans(user_id,label,payload) VALUES (NULL,'Broken','{\"plan\":[{\"type\":\"ingredient\",\"ingredientId\":\"99999999\"}]}')"))
        assert any('missing ingredient' in error for error in build_report(session, 'fixture-b')['blockers'])
        session.rollback()
    units = before['ingredient_units']
    if len(units) >= 2 and units[0]['ingredient_id'] == units[1]['ingredient_id']:
        with Session(engine) as session, session.begin():
            for user, unit in zip(('fixture-a','fixture-b'), units):
                session.execute(text("INSERT INTO user_ingredient_preferences(user_id,ingredient_id,unit_id) VALUES (:user,:ingredient,:unit)"), {'user':user,'ingredient':unit['ingredient_id'],'unit':unit['id']})
            assert any('conflicting existing' in error for error in build_report(session, 'fixture-b')['blockers'])
            session.rollback()
    # Failure after owner writes must roll back the ledger, owners and archives.
    def fail_preferences(connection, cursor, statement, parameters, context, many):
        if statement.startswith('DELETE FROM user_ingredient_preferences'):
            raise RuntimeError('Injected adoption failure')
    event.listen(engine, 'before_cursor_execute', fail_preferences)
    try:
        with Session(engine) as session, session.begin():
            try:
                apply_report(session, 'fixture-b', report)
            except RuntimeError as exc:
                assert 'Injected' in str(exc)
            else:
                raise AssertionError('Failure injection not reached')
            assert snapshot(session) == before, 'Savepoint did not restore all rows'
    finally:
        event.remove(engine, 'before_cursor_execute', fail_preferences)
    with Session(engine) as session, session.begin():
        assert apply_report(session, 'fixture-b', report)['status'] == 'applied'
    with Session(engine) as session:
        after = snapshot(session)
        assert not after['ingredient_sources']
        assert len(after['ingredient_provenance_history']) == len(before['ingredient_provenance_history']) + len(before['ingredient_sources'])
        from Backend.services.adoption import canonical, CONTENT_TABLES
        for table, rows in before.items():
            if table in ('ingredient_sources', 'ingredient_provenance_history', 'ownership_adoptions', 'user_ingredient_preferences'):
                continue
            def preserved(row):
                excluded = ({'owner_user_id'} if table in ('stored_food','daily_log_entries') else {'user_id','is_shared','name'}) if table in CONTENT_TABLES else set()
                return {key:value for key,value in row.items() if key not in excluded}
            assert canonical([preserved(row) for row in rows]) == canonical([preserved(row) for row in after[table]]), table
        for table in CONTENT_TABLES:
            column = 'owner_user_id' if table in ('stored_food','daily_log_entries') else 'user_id'
            assert all(row[column] == 'fixture-b' for row in after[table])
        assert all(not row['is_shared'] for row in after['ingredients'])
        assert [row['details'] for row in after['ingredient_provenance_history'] if row['adoption_version'] == report['version']] == before['ingredient_sources']
        assert [{key:row[key] for key in ('ingredient_id','unit_id')} for row in after['user_ingredient_preferences']] == report['shopping_preferences']
        for table, renames in report['renames'].items():
            by_id = {row['id']:row for row in after[table]}
            for rename in renames:
                assert by_id[rename['id']]['name'] == rename['new']
        assert apply_report(session, 'fixture-b', report)['status'] == 'already_applied'
        try:
            apply_report(session, 'fixture-a', report)
        except ValueError as exc:
            assert 'Conflicting' in str(exc)
        else:
            raise AssertionError('Conflicting rerun accepted')
        assert snapshot(session) == after
    return report


def verify_visibility(engine):
    """Use separate authenticated cookie jars after finalization."""
    import os
    os.environ['DB_AUTO_CREATE'] = 'false'
    os.environ['SESSION_SECURE_COOKIE'] = 'false'
    from fastapi.testclient import TestClient
    from Backend.backend import app
    from Backend.db import get_db
    from Backend.auth.passwords import hash_password
    from Backend.models import User
    with Session(engine) as session, session.begin():
        for identity in ('fixture-a','fixture-b'):
            user = session.get(User, identity)
            user.password_hash = hash_password('adoption-test-password')
            session.add(user)
        data = snapshot(session)
    def database():
        with Session(engine) as session:
            yield session
    app.dependency_overrides[get_db] = database
    try:
        with TestClient(app, headers={"Origin":"http://testserver"}) as admin, TestClient(app, headers={"Origin":"http://testserver"}) as owner:
            for client, identity in ((admin,'fixture-a'),(owner,'fixture-b')):
                response = client.post('/api/auth/login', json={'email':identity+'@example.invalid','password':'adoption-test-password'})
                assert response.status_code == 200, response.text
            for table, path in (('ingredients','ingredients'),('foods','foods'),('plans','plans'),('stored_food','stored_food')):
                response = owner.get('/api/'+path+'/')
                assert response.status_code == 200, response.text
                assert {row['id'] for row in response.json()} == {row['id'] for row in data[table]}
                assert admin.get('/api/'+path+'/').json() == []
            assert len(owner.get('/api/logs/2026-01-01').json()) == len(data['daily_log_entries'])
            assert admin.get('/api/logs/2026-01-01').json() == []
    finally:
        app.dependency_overrides.clear()

    # Later personal edits do not get overwritten by an idempotent rerun.
    from Backend.models import OwnershipAdoption
    from Backend.services.adoption import VERSION
    with Session(engine) as session, session.begin():
        ledger = session.get(OwnershipAdoption, VERSION)
        session.execute(text("UPDATE ingredients SET name = 'Personal edit after adoption' WHERE id = (SELECT min(id) FROM ingredients)"))
        edited = snapshot(session)
        assert apply_report(session, 'fixture-b', ledger.report)['status'] == 'already_applied'
        assert snapshot(session) == edited
