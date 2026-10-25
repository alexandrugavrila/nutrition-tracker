"""Reset passwords or activate/deactivate accounts; always revoke sessions."""
import argparse
from Backend.commands._accounts import read_password, run, selector
from Backend.services.accounts import create_personal_account, find_user, maintain_account


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("reset-password", "activate", "deactivate"):
        command = commands.add_parser(action)
        selector(command)
        if action == "reset-password":
            command.add_argument("--password-stdin", action="store_true")
    create = commands.add_parser("create-user")
    create.add_argument("--email", required=True)
    create.add_argument("--display-name", required=True)
    create.add_argument("--password-stdin", action="store_true")
    args = parser.parse_args(argv)
    def operation(session):
        if args.action == "create-user":
            create_personal_account(session, email=args.email, display_name=args.display_name,
                password_provider=lambda: read_password(args.password_stdin))
            return "Empty non-admin account created."
        user = find_user(session, email=args.email, user_id=args.user_id)
        maintain_account(session, user, args.action,
            password_provider=lambda: read_password(getattr(args, "password_stdin", False)))
        return "Account updated; all sessions revoked."
    return run(operation)


if __name__ == "__main__":
    raise SystemExit(main())
