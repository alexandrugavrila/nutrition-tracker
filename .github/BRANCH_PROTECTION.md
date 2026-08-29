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

The branch-policy check permits approved working/dependency branch prefixes and the explicit `main` → `development` post-release synchronization path.

## Activation order

1. Merge the workflow and policy files into `development`.
2. Promote `development` to `main` using a merge commit.
3. Confirm all four named checks appear on a test pull request.
4. Enable and enforce the `development` ruleset.
5. Enable and enforce the `main` ruleset.
