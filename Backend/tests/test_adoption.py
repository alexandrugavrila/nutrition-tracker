import pytest
from sqlmodel import Session, select
from Backend.models import User
from Backend.services.accounts import create_personal_account
from Backend.services.adoption import proposed_names, apply_report


def test_duplicate_names_are_stable_bounded_and_collision_safe():
    rows = [{'id':3,'name':'Rice'}, {'id':1,'name':'Rice'}, {'id':2,'name':'Rice [legacy #3]'}]
    assert proposed_names(rows, 100) == [{'id':3,'old':'Rice','new':'Rice [legacy #3-1]'}]
    result = proposed_names([{'id':1,'name':'x'*255},{'id':2,'name':'x'*255}],255)
    assert len(result[0]['new']) == 255
    assert result[0]['new'].endswith('[legacy #2]')
    assert proposed_names(list(reversed(rows)),100) == proposed_names(rows,100)


def test_invalid_report_rejected_before_database_access():
    with pytest.raises(ValueError, match='JSON object'):
        apply_report(object(), 'owner', [])


def test_operator_creates_only_empty_ordinary_account(engine):
    with Session(engine) as session, session.begin():
        user = create_personal_account(session, email='Owner@Example.com', display_name='Owner', password_provider=lambda:'password-value')
        assert not user.is_admin and user.is_active and user.email == 'owner@example.com'
        with pytest.raises(ValueError, match='already exists'):
            create_personal_account(session, email=user.email, display_name='Duplicate', password_provider=lambda:pytest.fail('No password read on collision'))
        assert len(session.exec(select(User)).all()) == 1
