"""Explicit, transactional, version-idempotent starter seeding."""
import argparse
from pathlib import Path
from Backend.commands._accounts import run, selector
from Backend.services.accounts import find_user
from Backend.services.onboarding import load_starter_manifest, seed_user_starter_data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    selector(parser)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args(argv)
    def operation(session):
        user = find_user(session, email=args.email, user_id=args.user_id)
        manifest = load_starter_manifest(args.manifest) if args.manifest else None
        return str(seed_user_starter_data(session, user, manifest=manifest))
    return run(operation)


if __name__ == "__main__":
    raise SystemExit(main())
