"""Shared operator CLI plumbing; no plaintext password arguments."""
import getpass
import os
import sys
import warnings
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session


def read_password(stdin=False):
    if stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        if not sys.stdin.isatty():
            raise ValueError("Use a terminal for hidden password entry or --password-stdin.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                password = getpass.getpass("Password: ")
                if password != getpass.getpass("Confirm password: "):
                    raise ValueError("Passwords do not match.")
        except getpass.GetPassWarning:
            raise ValueError("Hidden password entry is unavailable; use --password-stdin.") from None
    if not password.strip():
        raise ValueError("Password must not be empty.")
    return password


def selector(parser):
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--email")
    group.add_argument("--user-id")


def run(operation):
    try:
        # Never silently operate on the fallback SQLite file or an implicit dotenv.
        if not (os.getenv("DATABASE_URL") or os.getenv("SQLALCHEMY_DATABASE_URI")):
            raise ValueError("Set DATABASE_URL explicitly for account operations; apply migrations first.")
        from Backend.db import engine
        with Session(engine) as session, session.begin():
            message = operation(session)
        print(message)
        return 0
    except (ValueError, HTTPException, OSError) as exc:
        print(getattr(exc, "detail", str(exc)), file=sys.stderr)
        return 1
    except SQLAlchemyError:
        print("Database operation failed. Verify connection, migrations and account uniqueness; no changes committed.", file=sys.stderr)
        return 1
