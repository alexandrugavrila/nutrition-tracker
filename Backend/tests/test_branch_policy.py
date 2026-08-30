import pytest

from scripts.repo import check_branch_policy
from scripts.repo.check_branch_policy import (
    PolicyError,
    validate_pull_request,
    validate_release_merge,
    validate_release_tag,
    validate_release_tag_name,
)


@pytest.mark.parametrize(
    ("base", "head"),
    [
        ("development", "feature/example"),
        ("development", "bugfix/example"),
        ("development", "dependabot/pip/example"),
        ("development", "main"),
        ("main", "development"),
    ],
)
def test_allowed_pull_request_paths(base, head):
    validate_pull_request(base, head)


@pytest.mark.parametrize(
    ("base", "head"),
    [
        ("main", "feature/example"),
        ("feature/integration", "feature/example"),
        ("development", "release/example"),
    ],
)
def test_disallowed_pull_request_paths(base, head):
    with pytest.raises(PolicyError):
        validate_pull_request(base, head)


def test_release_merge_requires_development_as_second_parent():
    validate_release_merge("release old-main development-tip", "development-tip")

    with pytest.raises(PolicyError):
        validate_release_merge("release old-main feature-tip", "development-tip")


@pytest.mark.parametrize(
    "parent_line",
    [
        "release old-main",
        "release old-main development-tip unexpected-parent",
    ],
)
def test_release_merge_requires_exactly_two_parents(parent_line):
    with pytest.raises(PolicyError):
        validate_release_merge(parent_line, "development-tip")


def test_release_tag_must_equal_main():
    validate_release_tag("release", "release")

    with pytest.raises(PolicyError):
        validate_release_tag("other", "release")


@pytest.mark.parametrize("tag", ["v1.2.3", "v1.2.3-alpha", "v2.0.0-rc.1"])
def test_release_tag_name_accepts_versioned_docker_tags(tag):
    validate_release_tag_name(tag)


@pytest.mark.parametrize("tag", ["1.2.3", "v01.2.3", "release/v1.2.3", "v1.2.3+build"])
def test_release_tag_name_rejects_nonstandard_or_non_docker_tags(tag):
    with pytest.raises(PolicyError):
        validate_release_tag_name(tag)


def test_integration_pr_must_contain_current_development(monkeypatch):
    monkeypatch.setattr(
        check_branch_policy,
        "git_output",
        lambda args: "feature-tip" if args[1].startswith("feature-tip") else "development-tip",
    )
    monkeypatch.setattr(check_branch_policy, "git_succeeds", lambda args: True)

    check_branch_policy.check_pull_request(
        "development",
        "feature/example",
        "feature-tip",
        "origin/development",
    )

    monkeypatch.setattr(check_branch_policy, "git_succeeds", lambda args: False)
    with pytest.raises(PolicyError):
        check_branch_policy.check_pull_request(
            "development",
            "feature/example",
            "feature-tip",
            "origin/development",
        )


def test_release_pr_head_must_equal_development_tip(monkeypatch):
    monkeypatch.setattr(
        check_branch_policy,
        "git_output",
        lambda args: "release-head" if args[1].startswith("release-head") else "development-tip",
    )

    with pytest.raises(PolicyError):
        check_branch_policy.check_pull_request(
            "main",
            "development",
            "release-head",
            "origin/development",
        )
