#!/usr/bin/env python3
"""Validate Nutrition's development-to-main branch and release topology."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Sequence


WORKING_BRANCH_PREFIXES = (
    "feature/",
    "bugfix/",
    "refactor/",
    "housekeeping/",
    "dependabot/",
)
RELEASE_TAG_PATTERN = re.compile(
    r"^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$"
)


class PolicyError(RuntimeError):
    """Raised when a branch or release violates the repository policy."""


def validate_pull_request(base: str, head: str) -> None:
    if base == "main":
        if head != "development":
            raise PolicyError(
                "Pull requests targeting main must come from development. "
                f"Received {head!r} -> main."
            )
        return

    if base != "development":
        raise PolicyError(
            "Pull requests must target development, except for the "
            "development -> main release promotion. "
            f"Received {head!r} -> {base!r}."
        )

    if head == "main":
        # Allowed only for non-destructive post-release synchronization.
        return

    if not head.startswith(WORKING_BRANCH_PREFIXES):
        allowed = ", ".join(f"{prefix}*" for prefix in WORKING_BRANCH_PREFIXES)
        raise PolicyError(
            f"Working branches targeting development must use one of: {allowed}. "
            f"Received {head!r}."
        )


def validate_release_merge(parent_line: str, development_sha: str) -> None:
    fields = parent_line.split()
    if len(fields) != 3:
        raise PolicyError(
            "main must advance through a two-parent development -> main merge "
            "commit; squash, rebase, fast-forward, direct, and octopus updates "
            "are not release promotions."
        )

    second_parent = fields[2]
    if second_parent != development_sha:
        raise PolicyError(
            "The second parent of the main release commit must be the exact "
            f"origin/development tip ({development_sha}); received {second_parent}."
        )


def validate_release_tag(tag_commit_sha: str, main_sha: str) -> None:
    if tag_commit_sha != main_sha:
        raise PolicyError(
            "Release tags must point at the current main release commit. "
            f"Tag commit: {tag_commit_sha}; origin/main: {main_sha}."
        )


def validate_release_tag_name(tag: str) -> None:
    if not RELEASE_TAG_PATTERN.fullmatch(tag):
        raise PolicyError(
            f"Release tag {tag!r} must use vMAJOR.MINOR.PATCH with an optional "
            "Docker-compatible pre-release suffix."
        )


def git_output(args: Sequence[str]) -> str:
    completed = subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def git_succeeds(args: Sequence[str]) -> bool:
    return subprocess.run(
        ["git", *args],
        check=False,
        capture_output=True,
        text=True,
    ).returncode == 0


def check_pull_request(
    base: str,
    head: str,
    head_sha: str,
    development_ref: str,
) -> None:
    validate_pull_request(base, head)
    head_commit = git_output(["rev-parse", f"{head_sha}^{{commit}}"])
    development_sha = git_output(["rev-parse", f"{development_ref}^{{commit}}"])

    if base == "main" and head_commit != development_sha:
        raise PolicyError(
            "The development -> main release PR must use the exact current "
            f"development tip. Head: {head_commit}; development: {development_sha}."
        )

    if base == "development" and head != "main" and not git_succeeds(
        ["merge-base", "--is-ancestor", development_sha, head_commit]
    ):
        raise PolicyError(
            "The pull-request head must contain the current development tip. "
            "Update the working branch from development without rewriting shared history."
        )


def check_main_push(head: str, development_ref: str) -> None:
    head_commit = git_output(["rev-parse", f"{head}^{{commit}}"])
    development_sha = git_output(["rev-parse", f"{development_ref}^{{commit}}"])
    parent_line = git_output(["rev-list", "--parents", "-n", "1", head_commit])
    validate_release_merge(parent_line, development_sha)


def check_release_tag(head: str, main_ref: str, tag: str | None = None) -> None:
    if tag:
        validate_release_tag_name(tag)
    tag_commit = git_output(["rev-parse", f"{head}^{{commit}}"])
    main_sha = git_output(["rev-parse", f"{main_ref}^{{commit}}"])
    validate_release_tag(tag_commit, main_sha)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    pull_request = subparsers.add_parser("pull-request")
    pull_request.add_argument("--base", required=True)
    pull_request.add_argument("--head", required=True)
    pull_request.add_argument("--head-sha")
    pull_request.add_argument("--development-ref", default="origin/development")

    main_push = subparsers.add_parser("main-push")
    main_push.add_argument("--head", default="HEAD")
    main_push.add_argument("--development-ref", default="origin/development")

    release_tag = subparsers.add_parser("release-tag")
    release_tag.add_argument("--head", default="HEAD")
    release_tag.add_argument("--main-ref", default="origin/main")
    release_tag.add_argument("--tag")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "pull-request":
            if args.head_sha:
                check_pull_request(
                    args.base,
                    args.head,
                    args.head_sha,
                    args.development_ref,
                )
            else:
                validate_pull_request(args.base, args.head)
        elif args.command == "main-push":
            check_main_push(args.head, args.development_ref)
        elif args.command == "release-tag":
            check_release_tag(args.head, args.main_ref, args.tag)
    except (PolicyError, subprocess.CalledProcessError) as exc:
        print(f"Branch policy failed: {exc}", file=sys.stderr)
        return 1

    print("Branch policy passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
