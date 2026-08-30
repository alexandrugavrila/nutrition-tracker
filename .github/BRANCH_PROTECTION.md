# GitHub Branch-Protection Contract

Apply these repository settings after `.github/workflows/branch-policy.yml` is present on the default branch. The workflow enforces source/target topology; GitHub rulesets make its result mandatory.

## Repository merge methods

- Enable **Create a merge commit**.
- Disable squash merging and rebase merging so the `development` → `main` release ancestry cannot be flattened in the GitHub UI.

## `main` ruleset

- Require a pull request before merging.
- Require approvals and resolved review conversations.
- Require branches to be up to date before merging.
- Require status checks: `branch-policy`, `backend`, `frontend`, and `production-smoke`.
- Block branch deletion and non-fast-forward/force-push updates.
- Do not allow bypass for ordinary release work.

The branch-policy check permits only `development` as the source of a pull request targeting `main`, and the push check requires the resulting commit to have exactly two parents with the current `development` tip as its second parent.

## `development` ruleset

- Require a pull request before merging.
- Require approvals and resolved review conversations.
- Require branches to be up to date before merging.
- Require status checks: `branch-policy`, `backend`, `frontend`, and `production-smoke`.
- Block branch deletion and non-fast-forward/force-push updates.
- Add only the designated release manager or release-automation GitHub App to the bypass list. Use that bypass solely to fast-forward `development` to the just-tagged `main` release commit while the release freeze is active.

Ordinary development changes still require pull requests. The narrowly scoped release bypass exists because an exact fast-forward cannot be represented by a merge-commit-only pull request. If `development` moved during the release, do not bypass or rewrite it; use the permitted, reviewed `main` → `development` synchronization pull request instead.

## Release-tag ruleset

Create a tag ruleset targeting `v*`:

- Restrict tag creation to the designated release manager or release-automation GitHub App.
- Block tag updates and deletions, including for administrators during ordinary release work.
- Require the `branch-policy` status check where GitHub exposes required workflows for tag rulesets.

The workflow additionally requires `vMAJOR.MINOR.PATCH` with an optional Docker-compatible pre-release suffix and verifies that the tag resolves to the current `origin/main` release commit.

## Activation order

1. Merge the workflow and policy files into `development`.
2. Promote `development` to `main` using a merge commit.
3. Confirm all four named checks appear on a test pull request.
4. Enable and enforce the `development` ruleset.
5. Enable and enforce the `main` ruleset.
6. Enable the release-tag ruleset and verify that a non-release actor cannot create, move, or delete a test `v*` tag.
