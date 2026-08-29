## Purpose

Describe the change and why it belongs in this integration or release.

## Branch-flow check

- [ ] This working branch was created from `development`, and the pull request targets `development`.
- [ ] Or, this is the release pull request from `development` to `main` and will use **Create a merge commit**.
- [ ] Or, this is a post-release synchronization pull request from `main` to `development` because a fast-forward was not possible.
- [ ] No history was rewritten with rebase, reset, or force-push after review began.

## Validation

- [ ] Relevant backend and frontend tests pass.
- [ ] Migration and generated API-schema checks pass when applicable.
- [ ] Documentation and script catalogs are updated when workflows change.

## Release-only checklist

- [ ] Merges to `development` are paused until release tagging and branch synchronization finish.
- [ ] The `development` → `main` pull request has green required checks.
- [ ] The resulting `main` merge commit will be tagged and published with the same version.
- [ ] `development` will be fast-forwarded or non-destructively synchronized to the release commit before work resumes.
