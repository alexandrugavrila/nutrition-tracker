"""Create synthetic E2E accounts only in an explicitly confirmed test database."""
import os

from testsupport.database import validated_test_url


def main():
    url = validated_test_url(os.environ)
    if url is None:
        raise RuntimeError("Explicit TEST_DATABASE_URL and confirmation required")
    password = os.environ["E2E_PASSWORD"]
    from sqlmodel import Session, create_engine, select
    from Backend.auth.passwords import hash_password
    from Backend.models import User
    engine = create_engine(url)
    try:
        with Session(engine) as session:
            primary = (os.environ["E2E_EMAIL"], os.environ["E2E_OTHER_EMAIL"])
            # Separate browser isolation cases from CRUD login budgets.
            for email in (*primary, *("isolation-" + email for email in primary)):
                if session.exec(select(User).where(User.email == email)).first():
                    raise RuntimeError("E2E seeding requires fresh accounts; refusing to overwrite")
                session.add(User(email=email, display_name=email,
                                 password_hash=hash_password(password), is_admin=False))
            session.commit()
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
