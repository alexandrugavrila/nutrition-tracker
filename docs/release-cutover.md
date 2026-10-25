# Account and USDA release cutover

This runbook is not authorization to deploy. Local rehearsals use disposable
PostgreSQL and locally built images. Synthetic fixtures, localhost certificates
and empty GitHub status responses do not satisfy production release gates.

## Prerequisites and evidence

Require Python 3.11+, Docker Compose and a restricted evidence directory outside
Git, such as `release-evidence/<candidate-commit>`. Reports contain personal
information and backups contain the entire database. Restrict access, retain
recovery copies and keep them outside Git. Never put passwords on command lines.

Record the candidate commit, registry digest of both application images, actual
old running image IDs, deployed Alembic revision, PostgreSQL version, database
size, backup checksum, table counts, ID/content hashes and sequence values.
`cutover.json` records these during the checkpoints. It records the host checkout
commit separately: that does not establish the image's source commit. Verify
image provenance from the release workflow. Retain old images in a registry or
export them before removing containers. Candidate tags alone are rejected.

Before the window, rehearse the exact starting revision and verify free space on
BOTH the Docker database filesystem and backup host, including a second restored
database. The script checks backup host space (3x database size), but cannot
inspect remote disk capacity or independent writers. Disable scheduled imports
and external writers. Keep public traffic closed at the HTTPS ingress. Do not
change the PostgreSQL major version during the account cutover.

The orchestrator supports the bundled Compose `db` service. Backend database URL,
credentials and database name must match that service exactly; external database
URLs and query overrides fail closed. `DB_AUTO_CREATE` must be false.

## Staged invocation

PowerShell: `pwsh scripts/prod/deploy.ps1`. Bash: `./scripts/prod/deploy.sh`.
Both accept identical arguments and delegate to `scripts/prod/cutover.py`.
Set `PYTHON` to an explicit interpreter path if needed, including Git Bash on
Windows. The old single-tag deploy interface is removed. Use the same absolute
`--evidence` directory for all stages. Errors never reopen public traffic.

1. `prepare --evidence <dir> --backend <repo@sha256:digest> --frontend <repo@sha256:digest>`
   pulls candidate application images and records previous image references/IDs.
   It does not change `.env.production`, replace the DB image or stop traffic.
2. Close external ingress and stop independent writers. Ensure the existing
   database is running (fresh installs start only `db`). Run
   `maintenance --evidence <dir> --expected-revision <rehearsed-revision>`.
   Use `base` only for a truly empty database. The script stops edge, frontend,
   backend and maintenance, rejects other running Compose writers, checks the
   exact revision, dumps the stopped database and restores into a newly created
   `cutover_verify_*` database. It compares every public table's count/content/
   primary-key hash and sequence state before removing only that verification
   database. Unversioned populated databases fail; never stamp to bypass this.
3. `expand --evidence <dir>` checks the backup checksum and stopped writers,
   then upgrades only to `b42d8f0a315c`.
4. Set `BACKEND_IMAGE` to the candidate digest for manual one-off account commands.
   Use `compose run --rm --no-deps -T backend python -m
   Backend.commands.create_admin --email <admin> --display-name <name> --password-stdin`.
   Create/select the ordinary legacy owner with `Backend.commands.manage_account
   create-user --email <owner> --display-name <name> --password-stdin` in the same
   one-off container pattern. Supply passwords on stdin. Do not start the server.
5. `report --evidence <dir> --owner-email <owner>` writes `adoption.json` and its
   SHA256 in `cutover.json`. Review the ordinary owner, counts, deterministic name
   suffixes, unresolved references and all-personal classification. No personal
   data becomes canonical/shared. Review also applies to empty fresh installs.
   Blocked reports are retained as `adoption-blocked.json` without applying them.
6. `finalize --evidence <dir> --approved-report-sha256 <reviewed-sha256>` applies
   that exact report transactionally, upgrades explicitly to `e75a1c3d648f`, runs
   migration drift checks and verifies retained historical IDs/counts. All app
   services remain stopped. Never write between adoption and final constraints.
7. Optional verified Foundation synchronization and explicit starter seeding run
   now using the candidate image and Phase 9 artifact checks. Neither is needed
   for account creation. Maintenance stays opt-in; do not start all profiles.
8. Persist the reviewed candidate digest references in `.env.production` and
   explicitly start `backend frontend edge`, while external ingress remains
   restricted to operator clients. Check actual container image identities.
   Validate login/logout, secure HttpOnly cookies, two-account isolation and
   references over the actual HTTPS hostname. Health alone is insufficient.
9. Record smoke evidence and operator approval before reopening ingress. Monitor
   authentication failures, API errors, sync failures and ownerless records.

A failed checkpoint is not permission to edit `cutover.json` or skip a stage.
Investigate, then start a new reviewed attempt or restore first. Independent
operators must not run concurrent cutovers against the same database.

## Owner-selected private HTTP deployment

For this homelab installation, the owner explicitly deferred HTTPS. Follow
[home-server preparation](home-server-preparation.md): use production mode,
`SESSION_SECURE_COOKIE=false`, `ALLOW_INSECURE_HTTP=true`, and the exact
`http://nutrition.internal` origin. Restrict ingress to the intended clients and
validate actual network policy. In the staged instructions above, close/reopen
HTTP ingress at that boundary and test HttpOnly/SameSite cookies without Secure.
HTTPS-specific checks are deferred, never recorded as passing. All image,
backup/restore, ownership and authenticated smoke gates still apply.

## HTTPS boundary (future homelab project)

The production edge is HTTP internally and now defaults to loopback through
`PROD_HTTP_BIND_ADDRESS=127.0.0.1`. A real HTTPS terminator is required for the HTTPS deployment mode.
Use a private bind address only when the chosen topology requires it; restrict
direct access. Set `CORS_ALLOW_ORIGINS` to the real HTTPS origin and keep secure
production session cookies enabled. Never disable them to pass HTTP-only tests.

The local rehearsal uses a short-lived self-signed certificate and a test TLS
proxy directly in front of the production backend/frontend images. It does not
validate the future external terminator and internal edge topology. Verify
redirect schemes, forwarded headers, trusted proxies and ingress restrictions
when that topology is selected. No public certificate or production HTTPS
installation is created by this phase.

## Recovery

No automatic rollback, downgrade or Alembic stamping is performed. The legacy
rollback scripts fail before modifying anything because compatibility across the
ownership cutover is not certified. Before schema changes, previous images and
configuration may be restarted after confirming the DB is unchanged.

After expansion/adoption, keep ingress and writers stopped. Preserve the failed
current database and logs. Verify `before.dump` against `backup_sha256`; restore
with `pg_restore --exit-on-error --no-owner --no-privileges` into a NEW empty DB.
Never clean/drop the failed source. Compare revision, all table/ID/content hashes
and sequences using `Backend.commands.release_snapshot`. Point a separate stack
at that restored DB and pair it with the recorded previous images, checking
actual image identities. Validate before switching ingress. The local rehearsal
proves separate-database restore fidelity, but does not run unknown previous
production images.

After users resume writing, restoring the old backup loses subsequent writes.
Close traffic, preserve the current database, and review forward repair or an
explicit reconciliation. Alembic downgrade is not backup recovery.

## Historical dataset and approved rehearsal repair

`Database/backups/main-20251123-144741.dump` records revision `0f8b1c2d3e45`
and commit `a403f319`. SHA256:
`f6be0266f82b5ce6956a85f92dd40afe06618c53f1ef640f22a8796f3973f88c`.
The unmodified dump blocks adoption: Plan 4/item 0 references recipe 11 but has
an override for ingredient 117, no longer in that recipe (ingredients 99, 15,
129, 88). The user approved removing only that unused override in the disposable
rehearsal copy. The original dump and application database remain unchanged.

Reproduce with `python -m testsupport.run_release_cutover --snapshot
Database/backups/main-20251123-144741.dump --repair-known-legacy-override`.
The repair flag requires the exact input checksum and verifies expected JSON and
absence of the recipe link. It runs after backup/expansion, before adoption.
Without the flag, the original blocker is reproduced. This is not general cleanup
or authorization to repair production. Review the current state separately for
a future real cutover; the guarded equivalent transaction is:

```sql
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM food_ingredients WHERE food_id=11 AND ingredient_id=117) THEN
    RAISE EXCEPTION 'Ingredient now belongs to recipe; repair no longer applies';
  END IF;
  UPDATE plans SET payload = payload::jsonb #- '{plan,0,overrides,117}'
  WHERE id=4 AND payload->'plan'->0->>'foodId'='11'
    AND payload::jsonb->'plan'->0->'overrides'->'117'='{"unitId":77,"quantity":1}'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expected legacy override has changed'; END IF;
END $$;
COMMIT;
```

This old dump supports historical-data rehearsal, but does not establish the
current deployed revision/images or include later writes. Do not upload personal
dumps to CI. The default CI rehearsal uses synthetic data.

## Validation and gates

`python -m testsupport.run_release_cutover` builds production images, rehearses
populated adoption, actual backup restoration, wrong-revision/unapproved-report
failures, final constraints and Chromium HTTPS login/reload/A-B-A/logout.
`run_account_commands_smoke` covers fresh bootstrap and optional sync;
`run_schema_expansion` covers eight starting revision paths; `run_e2e` covers the
full authenticated workflows. CI's `release-cutover` job uploads its log and must
actually pass for the pushed candidate commit. Missing tools fail the run.

Development integration requires all named candidate CI jobs, successful local
integration checks and audits with explicit dispositions. Main promotion also
requires representative recovery, exact production image/HTTPS validation and
reviewed recovery evidence under the merge-commit release policy. Production
needs a rehearsed current state, designated owner, window, verified final backup,
smoke tests and operator approval. Missing evidence is a blocked gate, never a
pass. Do not infer remote CI success from local tests or empty query results.

To verify published images instead of rebuilding, append
`--backend-image <backend-repository@sha256:digest> --frontend-image <frontend-repository@sha256:digest>`
to the rehearsal command. Both are required; mutable tags are rejected. This mode
pulls the exact references, reports their local image IDs and retains those images
after removing only the disposable test stack. Repeat on the home server's CPU
architecture before approving deployment. Registry access must already be configured.

For the owner-selected private HTTP deployment, add `--transport http`. This
retains production mode and explicitly sets `SESSION_SECURE_COOKIE=false` and
`ALLOW_INSECURE_HTTP=true` only in the disposable rehearsal backend. The browser
asserts the named cookie's intended flags, rejects untrusted-origin logout, and
checks A/B/A isolation and logout. HTTPS remains the default regression and runs
separately in CI. A successful loopback HTTP rehearsal is not proof of LAN access
restrictions, DNS, or the final site's origin configuration.
