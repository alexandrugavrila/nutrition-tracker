"""Review and apply all-personal ownership adoption during maintenance."""
import argparse
import json
import os
from pathlib import Path
import sys
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session
from Backend.commands._accounts import selector
from Backend.services.adoption import CHECKPOINT, VERSION, apply_report, build_report
from Backend.models import OwnershipAdoption


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    selector(parser)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Default: read-only report")
    mode.add_argument("--apply", action="store_true", help="Apply the exact reviewed --report file")
    parser.add_argument("--report", type=Path, help="Dry-run output file, or reviewed apply input file")
    args = parser.parse_args(argv)
    if args.apply and not args.report:
        parser.error("--apply requires --report")
    try:
        if not (os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URI")):
            raise ValueError("Set DATABASE_URL explicitly; writers must be stopped for adoption.")
        from Backend.db import engine
        if engine.dialect.name != "postgresql":
            raise ValueError("Adoption requires PostgreSQL at the pre-adoption checkpoint.")
        with Session(engine) as session, session.begin():
            if not args.apply:
                session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            # Do not use the account-maintenance lookup's FOR UPDATE in a read-only report.
            from Backend.models import User
            from Backend.auth.sessions import normalize_email
            from sqlmodel import select
            query = select(User).where(User.id == args.user_id) if args.user_id else select(User).where(User.email == normalize_email(args.email))
            owner = session.exec(query).one_or_none()
            if owner is None:
                raise ValueError("Selected owner account does not exist. Create the non-admin account first.")
            completed = session.get(OwnershipAdoption, VERSION)
            revision = session.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            if not completed and revision != [CHECKPOINT]:
                raise ValueError(f"Initial adoption requires exactly revision {CHECKPOINT}.")
            if args.apply:
                reviewed = json.loads(args.report.read_text(encoding="utf-8"))
                result = apply_report(session, owner.id, reviewed)
            elif completed:
                if completed.owner_user_id != owner.id:
                    raise ValueError("Adoption was already completed for another owner.")
                result = completed.report
            else:
                result = build_report(session, owner.id)
        rendered = json.dumps(result, indent=2, sort_keys=True)
        if args.report and not args.apply:
            # Never overwrite a previously reviewed report accidentally.
            with args.report.open("x", encoding="utf-8") as output:
                output.write(rendered + "\n")
        print(rendered)
        return 1 if result.get("blockers") else 0
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except SQLAlchemyError:
        print("Adoption database operation failed; transaction rolled back. Check the checkpoint and stopped writers.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
