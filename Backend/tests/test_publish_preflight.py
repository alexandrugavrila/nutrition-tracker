import os
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
POWERSHELL_UTILS = REPO_ROOT / "scripts" / "lib" / "publish-utils.ps1"
BASH_UTILS = REPO_ROOT / "scripts" / "lib" / "publish-utils.sh"


def run_git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


@pytest.fixture
def release_repository(tmp_path: Path) -> tuple[Path, Path, str, str]:
    origin = tmp_path / "origin.git"
    repository = tmp_path / "release"
    run_git(tmp_path, "init", "--bare", str(origin))
    run_git(tmp_path, "init", str(repository))
    run_git(repository, "config", "user.name", "Release Test")
    run_git(repository, "config", "user.email", "release-test@example.com")

    tracked = repository / "release.txt"
    tracked.write_text("base\n", encoding="utf-8")
    run_git(repository, "add", "release.txt")
    run_git(repository, "commit", "-m", "Base")
    run_git(repository, "branch", "-M", "main")
    run_git(repository, "remote", "add", "origin", str(origin))
    run_git(repository, "push", "-u", "origin", "main")
    base_sha = run_git(repository, "rev-parse", "HEAD")

    run_git(repository, "checkout", "-b", "development")
    tracked.write_text("development\n", encoding="utf-8")
    run_git(repository, "add", "release.txt")
    run_git(repository, "commit", "-m", "Development")
    run_git(repository, "push", "-u", "origin", "development")

    run_git(repository, "checkout", "main")
    run_git(repository, "merge", "--no-ff", "development", "-m", "Release")
    run_git(repository, "push", "origin", "main")
    release_sha = run_git(repository, "rev-parse", "HEAD")
    return repository, origin, base_sha, release_sha


def git_bash() -> str | None:
    if os.name != "nt":
        return shutil.which("bash")

    program_files = os.environ.get("ProgramFiles")
    if not program_files:
        return None
    candidate = Path(program_files) / "Git" / "bin" / "bash.exe"
    return str(candidate) if candidate.exists() else None


def available_shells() -> list[str]:
    shells = []
    if shutil.which("pwsh"):
        shells.append("powershell")
    if git_bash():
        shells.append("bash")
    return shells


def run_preflight(repository: Path, shell: str, tag: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PUBLISH_REPO_ROOT"] = str(repository)

    if shell == "powershell":
        script = str(POWERSHELL_UTILS).replace("'", "''")
        command = f". '{script}'; Assert-PublishReleaseSource -Tag '{tag}'"
        args = ["pwsh", "-NoProfile", "-Command", command]
    else:
        script = BASH_UTILS.as_posix().replace("'", "'\\''")
        command = f"source '{script}'; publish_assert_release_source '{tag}'"
        args = [git_bash() or "bash", "-c", command]

    return subprocess.run(
        args,
        cwd=repository,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize("shell", available_shells())
def test_publish_preflight_accepts_unused_remote_tag(release_repository, shell):
    repository, _, _, _ = release_repository
    completed = run_preflight(repository, shell, "v1.2.3")
    assert completed.returncode == 0, completed.stdout + completed.stderr


@pytest.mark.parametrize("shell", available_shells())
def test_publish_preflight_accepts_remote_tag_on_release_commit(release_repository, shell):
    repository, _, _, _ = release_repository
    run_git(repository, "tag", "-a", "v1.2.3", "-m", "Release v1.2.3")
    run_git(repository, "push", "origin", "refs/tags/v1.2.3")
    run_git(repository, "tag", "-d", "v1.2.3")

    completed = run_preflight(repository, shell, "v1.2.3")
    assert completed.returncode == 0, completed.stdout + completed.stderr


@pytest.mark.parametrize("shell", available_shells())
def test_publish_preflight_rejects_remote_tag_on_another_commit(release_repository, shell):
    repository, _, base_sha, _ = release_repository
    run_git(repository, "tag", "-a", "v1.2.3", base_sha, "-m", "Conflicting release")
    run_git(repository, "push", "origin", "refs/tags/v1.2.3")
    run_git(repository, "tag", "-d", "v1.2.3")

    completed = run_preflight(repository, shell, "v1.2.3")
    assert completed.returncode != 0
    assert "already exists on origin" in completed.stdout + completed.stderr


@pytest.mark.parametrize("shell", available_shells())
@pytest.mark.parametrize("tag", ["1.2.3", "release/v1.2.3", "v01.2.3", "v1.2.3+build"])
def test_publish_preflight_rejects_invalid_release_tag(release_repository, shell, tag):
    repository, _, _, _ = release_repository
    completed = run_preflight(repository, shell, tag)
    assert completed.returncode != 0
    assert "must use vMAJOR.MINOR.PATCH" in completed.stdout + completed.stderr


def test_publish_scripts_push_git_tag_before_images():
    powershell = (REPO_ROOT / "scripts" / "prod" / "publish.ps1").read_text(encoding="utf-8")
    bash = (REPO_ROOT / "scripts" / "prod" / "publish.sh").read_text(encoding="utf-8")

    assert powershell.index("Ensure-ReleaseGitTag -Tag $resolvedTag -Push") < powershell.index(
        "Invoke-PublishPush -Images $images"
    )
    assert bash.index('publish_ensure_git_tag "$resolved_tag" true') < bash.index(
        'publish_push_images "$backend_image" "$frontend_image"'
    )
