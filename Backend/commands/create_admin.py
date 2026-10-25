"""Bootstrap an empty administrator in the configured database."""
import argparse
from Backend.commands._accounts import read_password, run
from Backend.services.accounts import bootstrap_admin


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--password-stdin", action="store_true")
    args = parser.parse_args(argv)
    def operation(session):
        created = bootstrap_admin(session, email=args.email, display_name=args.display_name,
            password_provider=lambda: read_password(args.password_stdin))
        return "Created empty administrator." if created else "Administrator already exists; unchanged (including activation and password)."
    return run(operation)


if __name__ == "__main__":
    raise SystemExit(main())
