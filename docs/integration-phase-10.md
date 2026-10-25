# Phase 10: local cutover and recovery evidence

Date: 2026-10-17. Stabilization branch: `bugfix/usda-maintenance-config`.
This report describes the accompanying Phase 10 commit. No application database,
original dirty feature worktree, remote branch, or production deployment was changed.

## Implementation

- Replaced the one-step deploy scripts with matching PowerShell/Bash entry points
  into a staged Python controller: prepare, maintenance/verified backup, expansion,
  adoption report review, finalization. Registry digest references are required.
- Stops application and maintenance writers before backup/migration, verifies the
  rehearsed starting revision and matching backend/Compose database target, records
  configuration identity and timestamps, checks backup capacity/checksum, restores
  into a separate fresh database, compares table/ID/content hashes and sequences.
- Applies only the exact reviewed adoption report, upgrades through named checkpoints,
  checks drift and historical IDs/counts, and leaves application access closed.
- Disabled unverified legacy automatic rollback. Documented clean-database recovery
  with previous image identity, retained failed state and post-reopening write loss.
- Added read-only packaged snapshot evidence, production-image cutover/HTTPS rehearsal,
  failure tests, and a CI release-cutover job with log artifact. Missing tools fail.
- Internal production HTTP edge defaults to loopback; external HTTPS remains an
  operational task. Frontend production images now install the lockfile with npm ci.
- Corrected stale anonymous health probes to readiness checks. Authenticated browser
  smoke verifies secure HttpOnly cookies, reload, owner isolation and logout.
- Fixed 11 inherited frontend lint errors without blanket suppression: unused names,
  unknown-value types, hook parameter reassignment and callback self-reference.
  Twenty existing hook dependency/ref warnings remain; lint exits successfully.

## Recorded validation

| Check | Result |
|---|---|
| Migrated PostgreSQL suite, final run | 232 passed; 3 E2E tests deselected here |
| Authenticated API suite | 3 passed |
| Chromium full workflows/account isolation | 9 passed |
| Frontend unit suite | 77 passed, 15 files |
| Focused database-free tests | 30 passed |
| Eight migration starting paths | All passed, including rollback injection and drift |
| Production image fresh bootstrap/account maintenance/optional Foundation sync | Passed |
| Synthetic populated cutover, actual separate DB restore, HTTPS browser | Passed |
| Historical dump cutover after approved repair, separate DB restore, HTTPS browser | Passed |
| Backend pip-audit and frontend npm lockfile audit | No known vulnerabilities |
| Frontend lint | 0 errors, 20 warnings |
| PowerShell and Bash deploy help/argument interfaces | Passed (explicit PYTHON for Git Bash) |
| Original six-file worktree preservation | Checksums unchanged |

Logs are local ignored `phase10-*.log` files. The final complete workflow run is
`phase10-e2e-final.log`; historical image run is `phase10-historical-final.log`;
focused checks are `phase10-focused-final.log`. Images and disposable databases
were removed after testing. These were locally built image IDs, not published
release digests or remote CI evidence.

Historical rehearsal image IDs:

- Backend: `sha256:f90462e5b10dd6c31d672cb137514f878b0a10ebc63f2857d7b14e02b59bf098`
- Frontend: `sha256:6c207decaef7f8385132dc8ff92fb6f03477372aff1e7a1193b680cf7a506e2e`

## Historical data finding and approved repair

The existing November 2025 dump starts at `0f8b1c2d3e45`, recorded source commit
`a403f319`, SHA256
`f6be0266f82b5ce6956a85f92dd40afe06618c53f1ef640f22a8796f3973f88c`.
The first rehearsal correctly blocked adoption on Plan 4/item 0: its override for
ingredient 117 is not part of recipe 11. The user explicitly approved removing
only this unused override in the disposable copy. The runner verifies the exact
dump checksum and expected JSON before that optional repair. The original dump
checksum remains unchanged. A future real repair requires review of current data.

The successful rehearsal preserved 126 ingredients and nutrition rows, 123 units,
13 foods, 54 recipe links, 5 plans and 5 stored-food rows. There were no daily-log
rows in this old dump; synthetic populated upgrade tests cover log preservation.
It upgraded through expansion, all-personal adoption and final constraints to
`e75a1c3d648f`. Both backup restoration and ownership/browser checks passed.
The runbook records the exact repair and recovery procedure.

## Gate disposition

Local implementation and rehearsals are complete. Release gates are not all cleared:

- Candidate remote CI remains **unverified**: this work has not been pushed. The
  named backend/frontend/production-smoke/authenticated-e2e/release-cutover jobs
  must pass for the actual candidate; an absent run is not success.
- Actual server HTTPS topology, public certificate, ingress restrictions and proxy
  headers are **not configured/validated**. The local test used a temporary TLS
  proxy directly in front of production images, not a real external ingress.
- Current deployed schema/images, capacity/window and production legacy-owner
  selection are **not collected**. The old dump does not establish current state.
- Recovery with the actual prior application images remains **unverified**. The
  database restore was performed and compared; no unknown old app image was run.
- Published immutable candidate images/provenance and remote merge-policy/ruleset
  enforcement still require release validation. No PR, merge, push or deployment
  was performed as part of this phase.
- Existing project-wide strict TypeScript diagnostics were not made clean by this
  phase; production Vite build, lint and tests passed. No suppression was added.

The repository audit still reports the pre-existing unrelated migration-drift
worktree naming mismatch. Environment/active-worktree checks passed. Validation
used isolated runners instead of branch DB synchronization wrappers to avoid
application database access. No API/model schema change required regeneration.

Follow [the cutover runbook](release-cutover.md). Development integration, main
promotion and actual deployment remain separate decisions with separate evidence.
