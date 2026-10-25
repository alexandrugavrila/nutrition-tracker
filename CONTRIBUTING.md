# Contributing Guide

This guide covers developer setup, branching, Docker workflows, API and migration handling, testing, and CI. For the quick overview see [README](README.md).

---

## Virtual Environment

- Each worktree maintains its own `.venv` folder.
- Windows and PowerShell:
  ```pwsh
  pwsh ./scripts/env/activate-venv.ps1
  ```
- On Windows, allow the helper scripts to run by unblocking them and loosening the execution policy for the current user:
  ```pwsh
  Get-ChildItem -Recurse -Filter *.ps1 | Unblock-File
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```
- macOS and Linux:
  ```bash
  source ./scripts/env/activate-venv.sh
  ```
- Run `pwsh ./scripts/env/check.ps1 -Fix` or `./scripts/env/check.sh --fix` to ensure you are inside the expected worktree, the default branch lives in the primary clone, and the virtual environment is active. The fixer creates missing worktrees, activates the venv, and switches directories when it is safe.
- Most helper scripts auto-activate the virtualenv when `VIRTUAL_ENV` is unset, so you can run them directly.

---

## Branching, Integration, and Releases

The repository uses two long-lived branches with distinct responsibilities:

- `development` is the integration branch. Every feature, bugfix, refactor, housekeeping, and dependency branch starts from the latest `origin/development` and merges back into `development` through a pull request.
- `main` is the release branch. It advances only when `development` is promoted for a release with a history-preserving merge commit.

Branch naming pattern: `<type>/<slug>` where `type` is one of `feature`, `bugfix`, `refactor`, or `housekeeping`. There are no direct-to-`main` working branches or hotfix exceptions; change this policy explicitly before using a different flow.

Recommended clone layout:

```pwsh
git clone <repo-url> C:\Workspace\projects\apps\nutrition-tracker\nutrition-main
```

You can use any parent directory; the key is that the primary clone sits in its own folder so worktrees can be siblings. To override the parent directory used by scripts, set `NUTRITION_WORKTREE_PARENT` before running them.

### Start a working branch

Recommended flow when starting or updating a branch:

1. Sync remote refs and audit existing worktrees:

   ```pwsh
   pwsh ./scripts/repo/check.ps1
   # or
   ./scripts/repo/check.sh
   ```

   The command runs `sync-branches` (fetch, prune, create local tracking branches), `audit-worktrees` (ensures every branch maps to exactly one worktree, the default branch stays in the primary clone, and no worktree is detached), and `audit-container-sets` (flags Docker Compose projects for branches that no longer exist).

2. Update the local integration branch without rewriting it:

   ```pwsh
   git -C ../nutrition-development fetch origin
   git -C ../nutrition-development merge --ff-only origin/development
   ```

3. Create or jump into the branch worktree:

   ```pwsh
   pwsh ./scripts/switch-worktree-branch.ps1 feature/my-feature -CopyEnv
   ```

   For a new branch, the helper always uses the latest `origin/development` as its base, even when invoked from `nutrition-main`. Existing local or remote branches retain their existing ancestry. The script creates `nutrition-feature-my-feature` under the worktree parent (default: parent of the primary clone; override with `NUTRITION_WORKTREE_PARENT`), pushes a new branch with its upstream, and optionally opens VS Code. Pass `-SkipVSCode` to stay in the terminal or `-NewVSCodeWindow` for a new window.

4. Verify the environment:

   ```pwsh
   pwsh ./scripts/env/check.ps1 -Fix
   # Bash
   ./scripts/env/check.sh --fix
   ```

   `-Fix` creates missing worktrees, switches to them, and activates `.venv` when it is safe to do so.

Worktree conventions:

- `main` (or the repository's default branch) remains in the original clone (the "primary root").

- `development` lives in `nutrition-development` and remains the sole integration target for working branches.

- Every other branch should live in a dedicated directory named `nutrition-<sanitized-branch>` under the worktree parent (defaults to the parent of the primary clone). You can override the parent directory by setting `NUTRITION_WORKTREE_PARENT` before running the helpers.

- The helpers error out on detached HEADs or mismatched worktree locations to avoid running the wrong stack.

Other repo utilities:

- `pwsh ./scripts/repo/sync-branches.ps1 [-DryRun] [-NoFetch]`: refresh local branches, pruning deleted refs, and optionally create worktrees for new branches.
- `pwsh ./scripts/repo/audit-worktrees.ps1`: report orphaned or misconfigured worktrees without fetching.
- `pwsh ./scripts/repo/audit-container-sets.ps1`: flag Docker Compose projects whose branches no longer exist.
- Bash equivalents for both commands live next to the PowerShell versions.

### Integrate working branches

1. Bring `origin/development` into the working branch and resolve conflicts there; never rewrite a shared branch after review has begun.
2. Open the pull request with the working branch as the head and `development` as the base.
3. Require green branch-policy, backend, frontend, migration/schema, and applicable smoke checks before merging.
4. Do not open a working-branch pull request directly against `main`. Dependabot is configured to target `development` under the same rule.

### Promote a release to `main`

1. Pause merges to `development` while the release PR is open so the promoted commit remains unambiguous.
2. Confirm `development` is green and contains every intended release change.
3. Open a pull request with `development` as the head and `main` as the base.
4. Merge with GitHub's **Create a merge commit** option. Do not squash, rebase, reset, force-push, or fast-forward `main`; the release commit must preserve both parents.
5. Update the primary clone and verify the release topology:

   ```pwsh
   git -C ../nutrition-main fetch origin
   git -C ../nutrition-main merge --ff-only origin/main
   git -C ../nutrition-main merge-base --is-ancestor origin/development HEAD
   git -C ../nutrition-main status --short --branch
   ```

6. From that clean `main` merge commit, create/push the release tag and publish matching images. Release identifiers must use `vMAJOR.MINOR.PATCH` with an optional pre-release suffix, such as `v1.3.0` or `v1.3.0-rc.1`:

   ```pwsh
   pwsh ./scripts/prod/publish.ps1 -Tag <version>
   # Bash: ./scripts/prod/publish.sh <version>
   ```

   The publish helper refuses non-`main`, dirty, stale, non-merge, or development-missing release sources. It checks the exact tag on `origin` before building, builds both images, pushes the annotated Git tag to reserve the release identifier, and then pushes both images. A matching remote tag is accepted for a retry; a conflicting tag is rejected before Docker runs.

7. Synchronize `development` to the release commit before resuming work:

   ```pwsh
   git -C ../nutrition-development fetch origin
   git -C ../nutrition-development merge --ff-only origin/main
   git -C ../nutrition-development push origin development
   ```

   With the release freeze still in effect, this is a non-destructive fast-forward performed only by the designated release manager or release-automation identity through the narrowly scoped `development` ruleset bypass. Ordinary work never uses that bypass. If `development` advanced unexpectedly, do not reset or bypass protection; merge `main` back through a reviewed `main` → `development` synchronization PR.

---

## Docker Workflows

### Development entrypoint (default contributor flow)

Always use the wrapper scripts instead of calling `docker compose` directly for day-to-day development; they load branch metadata and enforce the naming scheme.

Start services (choose a seed dataset):

```pwsh
pwsh ./scripts/docker/compose.ps1 up data -test     # test fixtures + auto migrations
pwsh ./scripts/docker/compose.ps1 up data -prod     # production-like startup (no implicit seed)
```

Options:

- Add `type -test` to run on the dedicated test ports (`TEST_*`). Useful for end-to-end runs that should not collide with your dev stack.
- Append service names (e.g. `frontend backend`) to limit which containers start.
- The script waits for PostgreSQL and backend dependencies.
- `data -test` runs migrations then loads test CSV fixtures.
- `data -prod` intentionally skips migrations/seeding so deployment pipelines can run an explicit migration job before traffic.
- Run the explicit migration job with `pwsh ./scripts/db/migrate.ps1` (or `./scripts/db/migrate.sh`) during deploy.

Stop services:

```pwsh
pwsh ./scripts/docker/compose.ps1 down
# add `type -test` to target the test stack
```

`down` removes branch-specific volumes by default for clean isolation. The wrapper does not forward extra Docker Compose flags for
this subcommand—if you need a different teardown (for example, keeping volumes or removing additional resources) run `docker
compose` directly with the branch project name that `up` prints (e.g. `docker compose -p nutrition-my-branch down`).

Restart services:

```pwsh
pwsh ./scripts/docker/compose.ps1 restart data -test
```

Branch-aware environment variables exported by the wrapper:

| Variable             | Description                                        |
| -------------------- | -------------------------------------------------- |
| `DEV_FRONTEND_PORT`  | Vite dev server port (base 3000 + offset)          |
| `DEV_BACKEND_PORT`   | FastAPI dev port (base 8000 + offset)              |
| `DEV_DB_PORT`        | Postgres dev port (base 5432 + offset)             |
| `TEST_*`             | Ports for temporary stacks spun up by scripts      |
| `COMPOSE_PROJECT`    | `nutrition-<sanitized-branch>`                     |
| `DATABASE_URL`       | Branch-local connection string                     |

Multiple branches can run simultaneously because each stack has a unique project name, volume suffix, and port offset.

### Production entrypoint (immutable runtime images)

For production-style deployments, use the root-level `docker-compose.prod.yml` directly:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Production compose intentionally differs from development compose:

- no source bind mounts (immutable image-only runtime);
- explicit `restart: unless-stopped` and service healthchecks;
- only a named PostgreSQL data volume is persisted;
- runtime configuration comes from `.env.production` plus required `${VAR:?error}` guards that fail fast when critical variables are missing. Copy `.env.production.example` to `.env.production` and inject real values from your deployment secret manager before deployment.

Frontend/API routing convention:

- Production uses a dedicated **edge nginx** service for TLS termination. The edge routes `/` to the frontend container and `/api/*` to `backend:8000`.
- Development keeps the Vite proxy in `Frontend/vite.config.ts`; this proxy is dev-only and uses `BACKEND_URL`.
- Because the app uses relative API paths (`/api/...`), production does not need `VITE_API_BASE_URL` or any runtime-injected frontend API config file.

Required `.env.production` values (defaults shown where applicable):

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `BACKEND_IMAGE` | Yes | — | Immutable backend image tag/digest. |
| `FRONTEND_IMAGE` | Yes | — | Immutable frontend image tag/digest. |
| `POSTGRES_IMAGE` | No | `postgres:13` | Override only when needed. |
| `POSTGRES_USER` | Yes | — | DB user for Postgres container init. |
| `POSTGRES_PASSWORD` | Yes | — | DB password for Postgres container init. |
| `POSTGRES_DB` | Yes | — | Database name for Postgres container init. |
| `DATABASE_URL` | Yes | — | Backend SQLAlchemy connection string. |
| `USDA_API_KEY` | No | — | Required for USDA endpoints. |
| `USDA_FOUNDATION_FOODS_JSON` | Maintenance only | — | File path or URL consumed by the `usda-sync` Compose profile. |
| `CORS_ALLOW_ORIGINS` | Yes | — | Comma-separated origins (`https://app.example.com`). Keep this tight in production. |
| `DB_AUTO_CREATE` | No | `false` | Leave false when running migrations separately. |
| `EDGE_IMAGE` | No | `nginx:1.27-alpine` | Edge proxy image override. |
| `EDGE_TLS_CERTS_DIR` | No | `./Edge/tls` | Host path containing `tls.crt` and `tls.key`. |
| `PROD_HTTP_PORT` | No | `80` | Host-port mapping for edge HTTP redirect listener. |
| `PROD_HTTPS_PORT` | No | `443` | Host-port mapping for edge HTTPS listener. |
| `ENVIRONMENT` | No | `production` | Keep `production` in deployed runtime so startup validation enforces required secrets. |



Runtime controls in production compose:

- Edge injects HTTP security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a baseline `Content-Security-Policy`).
- Health probes are dependency-aware:
  - Postgres: `pg_isready` against local socket (`db` readiness).
  - Backend: `GET /api/health/ready` which performs a DB round trip.
  - Frontend: `GET /healthz` static response from nginx.
  - Edge: `GET /healthz` over HTTPS, proxied to backend readiness.
- Resource guardrails are enabled with CPU/memory limits + reservations and conservative `ulimit` defaults (`nofile`, `nproc`) for each service.
- All services emit logs to stdout/stderr and Compose applies `json-file` log rotation (`max-size`, `max-file`, non-blocking mode).
- `usda-sync` is a maintenance profile one-shot for USDA Foundation Foods ingestion:
  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml --profile maintenance run --rm usda-sync
  ```
  `USDA_FOUNDATION_FOODS_JSON` is optional when configuring or starting the normal
  production stack. The sync command requires it (or `--input`) only when invoked;
  missing input exits with an error before loading data or opening a database session.
  The default invocation imports/updates records without marking absent entries stale.
  A URL is fetched by the container. A file path must exist **inside the container**;
  setting this variable to a host path does not mount that file. For a local dataset,
  mount its directory read-only and pass the container path (replace the host path):
  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml --profile maintenance run --rm --volume "/absolute/host/usda:/input:ro" --env USDA_FOUNDATION_FOODS_JSON=/input/foundation.json usda-sync
  ```
  In PowerShell, use a quoted absolute host path such as
  `"C:/datasets/usda:/input:ro"` for the same `--volume` option.
  Run the database-free configuration/command regression tests with
  `python -m pytest tests/test_usda_maintenance_config.py -q` (Docker Compose required).

Deployment secret checklist:

- Never commit real secrets (`.env.production` must stay untracked).
- Provide `POSTGRES_PASSWORD`, `DATABASE_URL`, `USDA_API_KEY`, and any future tokens from CI/CD or a dedicated secret manager.
- Keep `.env.production.example` values as placeholders only.
- Set `ENVIRONMENT=production` in runtime so backend startup fails if required secrets are missing.

---


### Production monitoring, logging, and incident runbook

#### Uptime target endpoint

Use the edge endpoint as the external uptime probe target:

```text
GET https://<your-domain>/healthz
```

Expected behavior:
- `200 OK` means edge is reachable *and* backend readiness passed (including DB connectivity).
- `503` or timeout means routing path degraded; trigger incident triage.

#### Log collection and rotation strategy

- Containers log to stdout/stderr (backend gunicorn access logs are JSON-formatted; frontend/edge nginx logs are JSON-formatted; Postgres uses structured line prefixes).
- Docker `json-file` driver rotates logs in-place to bound disk usage:
  - edge/frontend: `max-size=10m`, `max-file=5`
  - backend/db: `max-size=20m`, `max-file=10`
- Recommended aggregation: ship container logs to your platform collector (Loki/ELK/CloudWatch/etc.) and alert on sustained 5xx rates, backend readiness failures, and DB restart loops.

#### Incident runbook (minimal)

1. **Confirm symptom**
   - Check uptime probe (`/healthz`) and recent deployment events.
2. **Identify failing tier**
   - `docker compose --env-file .env.production -f docker-compose.prod.yml ps`
   - `docker compose --env-file .env.production -f docker-compose.prod.yml logs --since=15m edge frontend backend db`
3. **Common failure patterns**
   - Edge unhealthy: verify certificate mount (`EDGE_TLS_CERTS_DIR` contains `tls.crt`/`tls.key`) and nginx config syntax.
   - Backend unhealthy: call `http://localhost:8000/api/health/ready` inside backend container; inspect DB auth/network errors.
   - DB unhealthy: validate credentials, volume free space, and Postgres start logs.
4. **Immediate mitigation**
   - Roll back to last known-good image tags (`BACKEND_IMAGE`, `FRONTEND_IMAGE`) and restart stack.
   - If schema issues caused outage, follow the backup/restore section above before reintroducing traffic.
5. **Post-incident**
   - Capture timeline, root cause, customer impact, and preventive action items in your incident tracker.

---

## Database Utilities

All database helpers live under `scripts/db/` and respect the current branch's environment variables. Detailed usage for every script—including call chains and flags—lives in the [Script catalog](#script-catalog--call-graph), but the short list below highlights the most common flows.

- `pwsh ./scripts/db/backup.ps1` / `./scripts/db/backup.sh`
  Writes `Database/backups/<sanitized>-<timestamp>.dump` plus metadata (Alembic revision, git SHA). Refuses non-local DBs unless `-AllowNonLocalDb` / `--allow-non-local-db` is provided.
- `pwsh ./scripts/db/migrate.ps1`
  Explicitly runs `alembic upgrade head` against the running stack. Use this as a one-time deploy job before routing traffic.
- `pwsh ./scripts/db/restore.ps1 [-ResetSchema] [-UpgradeAfter] [<file>]`
  Restores the most recent dump for the branch or a provided file. `-ResetSchema` drops/recreates the public schema; `-UpgradeAfter` reapplies migrations.
- `pwsh ./scripts/db/export-to-csv.ps1 [-Production|-Test] [-OutputDir <path>]`
  Writes the current database tables to CSV (defaults to production data). Bash: `./scripts/db/export-to-csv.sh`.
- `pwsh ./scripts/db/import-from-csv.ps1 [-test|-production]`
  Loads CSV seed data into the running container; used automatically for `compose.ps1 up data -test`. Production mode requires explicit confirmation flags.
- `pwsh ./scripts/db/check-migration-drift.ps1`
  Compares the migration state between the database and `Backend/migrations`.
- `pwsh ./scripts/db/update-api-schema.ps1`
  Spins up a temporary backend, regenerates `Backend/openapi.json`, and updates `Frontend/src/api-types.ts`.
- `pwsh ./scripts/db/sync-api-and-migrations.ps1`
  One-stop command: runs Alembic autogenerate, formats new migrations, updates OpenAPI + TS types, runs drift checks, and prompts you to commit generated artifacts.

Most scripts accept Bash equivalents with the same flags.

### Safe deploy sequence (backup, migrate, rollback)

Use this sequence in server deployments to keep schema lifecycle deterministic:

1. **Backup before migration**  
   `pwsh ./scripts/db/backup.ps1` (or `./scripts/db/backup.sh`).
2. **Run one explicit migration job (before app traffic)**  
   `pwsh ./scripts/db/migrate.ps1` (or `./scripts/db/migrate.sh`).
3. **Start/update app containers**  
   Use your deploy platform; avoid implicit seeding in production startup.
4. **Rollback if migration fails post-deploy**  
   `pwsh ./scripts/db/restore.ps1 -ResetSchema <backup.dump>` (or `./scripts/db/restore.sh --reset-schema <backup.dump>`), then redeploy the previous app version.

---

## Script Catalog & Call Graph

The repository keeps Bash and PowerShell twins for every contributor-facing script. Use either flavor on any platform; functionality and options match unless noted.

### Testing and quality gates

- `scripts/run-tests.ps1` / `scripts/run-tests.sh`
  - Purpose: run backend unit tests, frontend unit tests, optional OpenAPI/migration sync, and optional end-to-end API + browser suites.
  - Flags:
    - PowerShell: `-e2e`, `-sync`, `-full` (equivalent to both flags).
    - Bash: `--e2e`, `--sync`, `--full` (plus `-h|--help`).
  - Call graph:
    - When sync flags are present, calls `scripts/db/sync-api-and-migrations.ps1|.sh`.
      - That script invokes `scripts/db/update-api-schema.ps1|.sh` to regenerate `Backend/openapi.json` and `Frontend/src/api-types.ts`.
      - Afterwards it runs `scripts/db/check-migration-drift.ps1|.sh`, which shells into `scripts/db/check_migration_drift.py` to autogenerate and (if needed) adopt migrations via Alembic.
    - When e2e flags are present, calls `scripts/tests/run-e2e-tests.ps1|.sh`.
    - Always sources `scripts/lib/venv.ps1|.sh` to ensure the virtual environment is active.

- `scripts/tests/run-e2e-tests.ps1` / `scripts/tests/run-e2e-tests.sh`
  - Purpose: run migration-built PostgreSQL tests and authenticated API/browser E2E on disposable infrastructure.
  - Parameters: additional pytest arguments apply to the API E2E invocation.
  - Call graph: loads `scripts/lib/venv.*`, installs Playwright Chromium, then invokes `python -m testsupport.run_e2e`.
  - The Python runner creates a uniquely named Compose project from `testsupport/docker-compose.e2e.yml`, with PostgreSQL data in tmpfs and a random loopback port. It starts API/Vite child processes on temporary ports and always terminates them and removes only its own Compose project.
  - `testsupport.seed_accounts` creates two ordinary test accounts directly, avoiding production bootstrap/onboarding dependencies. It refuses existing accounts and requires the database guard described below.

### Ownership expansion and adoption checkpoint

`b42d8f0a315c` is the **pre-adoption expansion checkpoint**, following
`a31c7e9f204b`. It is integration-only. Keep application writers stopped through
expansion, the forthcoming adoption operation, and final ownership constraints.
Do not deploy this intermediate application/schema as a finished account cutover.

- Every existing ingredient starts with `is_shared=false`; every source mapping
  starts `unverified`, including records with existing payload hashes.
- Logs/stored food retain legacy `user_id` strings and gain nullable `owner_user_id`
  foreign keys. Existing rows stay unassigned until adoption; new API writes populate
  the authenticated owner. Reads use the foreign key, never a matching legacy string.
- Shared visibility requires an explicit shared flag, no owner, and a verified
  provider mapping. Unclassified rows are hidden from users and administrators.
  Ordinary sourced ingredient creation currently remains personal and unverified;
  the identifier-only trusted import interface is delivered in Phase 6.
- `user_ingredient_preferences` uses `(user_id, ingredient_id)` as its key and a
  composite foreign key to require a unit of that ingredient. No row means no override.
  The existing ingredient-level default is preserved. Preference APIs and resolution
  are implemented in Phase 6; adoption copies legacy personal choices in Phase 5.
- `ownership_adoptions` records a completed mapping/version, owner, report and hash.
  `ingredient_provenance_history` preserves personal provenance separately when
  adoption releases a canonical mapping. Both remain empty during expansion.
- Source verification stores status, timestamp, artifact checksum, normalization
  version, and optional import-run reference. Sync runs can record artifact identity.
  These fields do not automatically trust existing source strings or hashes.

Run `python -m testsupport.run_schema_expansion` to rehearse a fresh installation
and populated upgrades from `d3f0b1c2e7ad`, `b6a1f2c3d4e5`, `6b2f8f8d9c11`,
`8c9d0e1f2a3b`, `91b4c6d8e2f0`, and `a31c7e9f204b`. It creates a unique tmpfs
PostgreSQL stack, validates the complete migration graph and model drift, compares
all existing column values/IDs/references, and cleans up its own resources. The
backend CI job runs this rehearsal. An actual deployed revision must be identified
and rehearsed before deployment; the synthetic fixtures are not a production restore.

No migration stamping or `create_all` is used for these PostgreSQL checks. Existing
migration files remain unchanged. An Alembic downgrade discards expansion metadata;
use the roadmap's matched backup/image recovery procedure for a failed cutover.

### Authentication and starter data

Account creation and bootstrap create empty accounts, without starter data or a USDA key.
Apply migrations before using the commands. Set `DATABASE_URL` explicitly; these commands
never start containers, restore data, create tables, or select a branch database for you.
Activate the intended Python environment before using the script wrappers.

- `scripts/auth/create-admin.ps1` / `.sh` wrap `Backend.commands.create_admin`.
  Flags: `--email <email> --display-name <name> [--password-stdin]`.
  Hidden password entry with confirmation is the default. Plaintext `--password` is no longer supported.
  An existing administrator is unchanged (including disabled status); a non-admin email fails.
- `scripts/auth/manage-account.ps1` / `.sh` wrap `Backend.commands.manage_account`.
  Subcommands: `reset-password`, `activate`, `deactivate`. Select exactly one of
  `--email <email>` or `--user-id <id>`. Password reset accepts `--password-stdin`.
  These maintenance operations revoke all sessions in the same transaction.
  `create-user --email <email> --display-name <name> [--password-stdin]` creates an empty,
  active non-admin account; an existing email fails without changing the account.
- `scripts/auth/seed-starter-data.ps1` / `.sh` wrap `Backend.commands.seed_starter_data`.
  Select exactly one of `--email <email>` or `--user-id <id>`; optional `--manifest <path>`.
  Seeding is explicit and transactional. Missing referenced catalog data rolls back the
  entire seed. A durable per-user version marker prevents repeat seeding after edits or
  deletions. Changing a completed manifest requires a new version. Existing matching names
  are reused without overwriting them. Old installations are not marked seeded automatically.

Both shell variants accept the Python CLI flags above verbatim. The legacy `.py` paths
also delegate to these packaged modules. Production needs no source bind mount:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend python -m Backend.commands.create_admin --email admin@example.com --display-name Administrator
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend python -m Backend.commands.manage_account deactivate --email user@example.com
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend python -m Backend.commands.seed_starter_data --email user@example.com
```

For automation, deliver one password line from a secret manager over stdin and use
`run --rm -T ... --password-stdin`. Never put passwords in command arguments or shell history.
The `--manifest` path, if used in Docker, must be container-visible; mount custom manifests read-only.
USDA endpoints remain unavailable without `USDA_API_KEY`; accounts and local starter data work.

Run `python -m testsupport.run_account_commands_smoke` for production-image bootstrap,
repeat/collision checks, explicit seeding, and account/session maintenance against a unique
tmpfs PostgreSQL database. It builds the production target, uses no source mounts, runs
migrations and a drift check, and removes its containers and test image. The production-smoke
CI job runs this check too.


### Docker stack management

- `scripts/docker/compose.ps1` / `scripts/docker/compose.sh`
  - Purpose: orchestrate **development** Docker Compose stacks with branch-specific project names, port offsets, and data seed flows (`docker-compose.yml`).
  - Subcommands (common to both shells):
    - `up [type <-dev|-test>] data <-test|-prod> [service...]`
    - `down [type <-dev|-test>]`
    - `restart [type <-dev|-test>] data <-test|-prod>`
  - Behavior:
    - `type -test` remaps the dev ports/volumes to the dedicated `TEST_*` values for isolated stacks.
    - `data -test` runs migrations and then loads test fixtures.
    - `data -prod` skips migrations and fixture import by design; run `scripts/db/migrate.ps1|.sh` explicitly in deployment flows.
    - Writes resolved ports to `$COMPOSE_ENV_FILE` when present so callers (for example the e2e runner) can source them.
    - Provides graceful teardown including volume cleanup.
  - Call graph: loads `scripts/lib/branch-env.*`, `scripts/lib/worktree.sh` (Bash variant), and `scripts/lib/compose-utils.*`; PowerShell also imports `scripts/env/activate-venv.ps1` for test-fixture startup.

- `docker-compose.prod.yml`
  - Purpose: production runtime stack using prebuilt immutable images only (no host bind mounts), with an edge TLS proxy, runtime health probes, resource guardrails, and bounded log rotation.
  - Entry point: `docker compose --env-file .env.production -f docker-compose.prod.yml up -d`.
  - Maintenance entry point: `docker compose --env-file .env.production -f docker-compose.prod.yml --profile maintenance run --rm usda-sync`.
  - Requirements: `.env.production` must define critical runtime variables (`BACKEND_IMAGE`, `FRONTEND_IMAGE`, database credentials, `DATABASE_URL`, `CORS_ALLOW_ORIGINS`), plus edge TLS certificate mount inputs (`EDGE_TLS_CERTS_DIR`) or Compose exits immediately via `${VAR:?error}` guards where configured. Foundation input is validated by the `usda-sync` command when invoked, not during Compose interpolation.

### Environment and worktree helpers

- `scripts/env/activate-venv.ps1` / `scripts/env/activate-venv.sh`
  - Purpose: create/activate `.venv`, install Python requirements, and keep `Frontend/node_modules` in sync with `package-lock.json`.
  - Flags: none; respects environment overrides `VENV_PATH`, `REQUIREMENTS_PATH`, and `FRONTEND_PATH`.

- `scripts/env/check.ps1` / `scripts/env/check.sh`
  - Purpose: verify the current directory is the correct worktree for the branch, ensure the default branch stays in the primary clone, and confirm the correct virtual environment is active.
  - Flags:
    - PowerShell: `-Fix`, `-Quiet`.
    - Bash: `--fix`.
  - Call graph: relies on `scripts/lib/branch-env.*` and `scripts/lib/worktree.sh`; PowerShell version can invoke `scripts/env/activate-venv.ps1` during fixes.

- `scripts/switch-worktree-branch.ps1`
  - Purpose: fetch remote refs, create new working branches from the latest `origin/development`, create local tracking branches for remote-only branches, then interactively pick a branch, jump to its dedicated worktree (creating it if needed), optionally open VS Code, optionally start Docker Compose, and always activate the virtualenv.
  - Flags/parameters: `-Branch`, `-SkipVSCode`, `-NewVSCodeWindow`, `-CopyEnv` (copies the current worktree `.env` into the target when missing), `-StartWorkspaceStack`, and `-Data <test|prod>` (required with `-StartWorkspaceStack`).
  - Recommended usage: `pwsh ./scripts/switch-worktree-branch.ps1 <branch> -CopyEnv`.
  - Call graph: invokes `scripts/env/activate-venv.ps1` and `scripts/docker/compose.ps1` when the corresponding switches are selected.

### Repository maintenance

- `scripts/repo/check_branch_policy.py`
  - Purpose: enforce pull-request targets, verify that a `main` update is a two-parent release merge whose second parent is the exact `origin/development` tip, and verify that standard `vMAJOR.MINOR.PATCH[-prerelease]` release tags point at the current `origin/main` commit.
  - Commands: `pull-request --base <branch> --head <branch>`, `main-push [--head <sha>]`, and `release-tag [--head <sha>] [--tag <tag>]`.
  - Call graph: `.github/workflows/branch-policy.yml` invokes the matching command for pull requests, pushes to `main`, and tag pushes.

- `scripts/repo/check.ps1` / `scripts/repo/check.sh`
  - Purpose: one-stop repository hygiene command; optionally skip stages.
  - Flags:
    - PowerShell: `-SkipSync`, `-SkipAudit`, `-SkipContainers` plus pass-through `-SyncArgs` for nested branch sync options.
    - Bash: `--skip-sync`, `--skip-audit`, `--skip-containers` and `--` to forward arguments to branch sync.
  - Call graph:
    - Runs `scripts/repo/sync-branches.ps1|.sh` unless skipped.
      - PowerShell flags: `-NoFetch`, `-YesToAll`, `-DryRun`.
      - Bash flags: `--no-fetch`, `--yes`, `--dry-run`, `-h|--help`.
    - Runs `scripts/repo/audit-worktrees.ps1|.sh` (no flags) to validate branch↔worktree mappings and naming conventions; prompts before removing orphans.
    - Runs `scripts/repo/audit-container-sets.ps1|.sh` (no flags, honours `$CONTAINER_SET_PREFIX`) to locate Compose stacks without matching branches; prompts before removal and exits non-zero if unresolved stacks remain.

- `scripts/prod/publish.ps1` / `scripts/prod/publish.sh`
  - Purpose: validate the release source and version, create or verify the matching annotated Git tag locally and on `origin`, and publish immutable backend/frontend images.
  - Release-source requirements: clean `main`, `HEAD == origin/main`, exactly two parents, `origin/development` as the second parent, and a `vMAJOR.MINOR.PATCH[-prerelease]` tag. Local and remote tags must resolve to `HEAD`.
  - Flags: `-Tag` / positional tag. The older create/push-tag switches remain accepted for compatibility but are unnecessary because local and remote tag publication is mandatory.
  - Call graph: loads `scripts/lib/publish-utils.ps1|.sh`, validates local and remote Git state, builds both Dockerfiles, pushes/verifies the Git tag on `origin`, and then pushes both images.

### Database management

- `scripts/db/backup.ps1` / `scripts/db/backup.sh`
  - Purpose: capture a branch-local Postgres dump and write companion metadata.
  - Flags: `-AllowNonLocalDb` / `--allow-non-local-db` to permit non-local DATABASE_URL targets.
  - Call graph: loads `scripts/lib/branch-env.*` and `scripts/lib/compose-utils.*`; PowerShell variant falls back to running pg_dump inside the container when the host CLI is unavailable.

- `scripts/db/migrate.ps1` / `scripts/db/migrate.sh`
  - Purpose: run `alembic upgrade head` as an explicit migration job.
  - Flags: `-AllowNonLocalDb` / `--allow-non-local-db` to permit non-local DATABASE_URL targets.
  - Call graph: loads `scripts/lib/branch-env.*` and `scripts/lib/compose-utils.*`, waits for Alembic availability in the backend container, then runs Alembic in `/app/Backend`.

- `scripts/db/restore.ps1` / `scripts/db/restore.sh`
  - Purpose: restore a custom-format dump into the branch-local database and optionally upgrade afterward.
  - Flags:
    - PowerShell: `-UpgradeAfter`, `-FailOnMismatch`, `-ResetSchema`, `-AllowNonLocalDb`, optional positional `DumpPath`.
    - Bash: `--upgrade-after`, `--fail-on-mismatch`, `--reset-schema`, `--allow-non-local-db`, optional dump file argument, `-h|--help`.
  - Behavior: auto-selects the newest dump for the current branch (falling back to `main` when necessary), blocks non-localhost targets unless explicitly allowed, can drop/recreate the `public` schema, and compares backup Alembic revision metadata against repo heads.

- `scripts/db/import-from-csv.ps1` / `scripts/db/import-from-csv.sh`
  - Purpose: load CSV fixtures into the running branch database.
  - Flags: exactly one of `-production`/`--production` or `-test`/`--test`; production requires `-AllowProductionSeed` / `--allow-production-seed`; non-local DATABASE_URL requires `-AllowNonLocalDb` / `--allow-non-local-db`.
  - Call graph: ensures venv activation and running containers before executing `python Database/import_from_csv.py` with the matching flag.

- `scripts/db/export-to-csv.ps1` / `scripts/db/export-to-csv.sh`
  - Purpose: export tables from the branch database into CSV fixtures.
  - Flags: choose data set with `-Production`/`--production` or `-Test`/`--test` (default is production) and optionally specify `-OutputDir`/`--output-dir <path>`.
  - Behavior: resolves output directories to absolute paths when possible and runs `python Database/export_to_csv.py` with the assembled arguments.

- `scripts/db/update-api-schema.ps1` / `scripts/db/update-api-schema.sh`
  - Purpose: launch the FastAPI app with Uvicorn, fetch `openapi.json`, and regenerate frontend TypeScript types via `openapi-typescript`.
  - Flags: none.
  - Call graph: both variants source `scripts/lib/venv.*` and `scripts/lib/python.*`; PowerShell version additionally leverages `scripts/lib/log.ps1` for status output.

- `scripts/db/sync-api-and-migrations.ps1` / `scripts/db/sync-api-and-migrations.sh`
  - Purpose: unify API schema updates with migration drift detection.
  - Flags: PowerShell uses `-Auto` (alias `-y`); Bash accepts `-y` or `CI=true` to auto-confirm prompts.
  - Call graph: ensures the virtual environment is active, runs `update-api-schema`, then `check-migration-drift`, and summarises whether migrations were adopted.

- `scripts/db/check-migration-drift.ps1` / `scripts/db/check-migration-drift.sh`
  - Purpose: execute `scripts/db/check_migration_drift.py`, which spins up a disposable Postgres container, autogenerates a migration to detect drift, and optionally adopts it.
  - Flags: pass-through arguments to the Python script (currently none).

- `scripts/db/check_migration_drift.py`
  - Purpose: shared core for drift detection; returns exit code `0` when clean or after successful adoption, `2` when drift persists after adoption, `1` on failure.
  - Behavior: cleans temporary revisions, starts a Postgres container on `TEST_DB_PORT` (or random port), runs Alembic autogenerate twice, renames adopted files with a timestamp slug, and removes temporary containers/files.

### Shared libraries

The `scripts/lib/` directory contains reusable helpers that other scripts source:

- `branch-env.ps1` / `branch-env.sh`: compute sanitized branch names, Compose project identifiers, and branch-specific port offsets.
- `compose-utils.ps1` / `compose-utils.sh`: inspect Compose stacks, ensure branch containers are running, and expose the dedicated test project name.
- `worktree.sh`: enforce the worktree naming convention (used by Bash scripts such as the Compose wrapper and environment checks).
- `venv.ps1` / `venv.sh`: activate the per-worktree virtualenv, bootstrapping dependencies as required.
- `python.ps1` / `python.sh`: resolve the appropriate Python interpreter/arguments.
- `log.ps1`: provide consistent status output helpers for PowerShell scripts.

Refer back to this section whenever you touch a script—any new flag, behavior change, or entry point must be reflected here.

---

## Testing

Run the combined test suite:

```pwsh
pwsh ./scripts/run-tests.ps1            # pytest + frontend tests
pwsh ./scripts/run-tests.ps1 -sync      # run API/migration sync first
pwsh ./scripts/run-tests.ps1 -e2e       # include end-to-end API tests
pwsh ./scripts/run-tests.ps1 -full      # sync + unit + e2e
```

Bash: `./scripts/run-tests.sh` using the same flags (`--sync`, `--e2e`, `--full`).

End-to-end suites can also be invoked directly:

```pwsh
pwsh ./scripts/tests/run-e2e-tests.ps1
./scripts/tests/run-e2e-tests.sh
```

Install backend requirements and run `npm --prefix Frontend ci` first. The runners require Docker Compose, Node, and Playwright Chromium. They create a fresh PostgreSQL database, apply Alembic migrations, seed two ordinary accounts, run real cookie-authenticated API/browser tests, and clean up on failure or success. They never restore application backups or seed production CSVs.

Backend tests use in-memory SQLite by default and **ignore ordinary `DATABASE_URL`**. For PostgreSQL validation, set `TEST_DATABASE_URL` to a PostgreSQL database whose name ends in `_test` and set `TEST_DATABASE_CONFIRM` to that exact name. URL query options are rejected. Tests create and migrate a unique schema, clear only its tables between tests, and drop only that schema afterward. Do not use a shared application database for testing.

API fixtures are explicit: `anonymous_client`, `admin_client`, `user_a_client`, and `user_b_client`. The remaining admin-based legacy tests deliberately exercise existing ownerless catalog fixtures; they do not establish ordinary-user authorization. No fixture logs in every test automatically.

The required runner sets `E2E_REQUIRED=1`; absent configuration, failed readiness, or failed login is an error. An ordinary unit-only run may skip the live E2E module when no port is configured. Direct API/browser invocation requires `DEV_BACKEND_PORT`, `PLAYWRIGHT_BASE_URL`, `E2E_EMAIL`, `E2E_OTHER_EMAIL`, and `E2E_PASSWORD` from a disposable test setup. Never use production credentials.

`python -m testsupport.run_e2e` is also the cross-platform CI entry point. It applies migrations to newly created test infrastructure only; it is not a production deployment or upgrade-rehearsal command.

Additional tooling:

- `npm --prefix Frontend run lint`
- `npm --prefix Frontend run e2e`
- `npm --prefix Frontend run build`
- `npm --prefix Frontend test`
- `pytest` (when running backend unit tests outside the wrapper)

---

## Fridge Workflow Notes

- Domain logic around stored foods now validates macro values on both the FastAPI schemas and database constraints. When you
  touch the fridge routes or models, update the corresponding tests under `Backend/tests/test_stored_food.py` and
  `Backend/tests/test_logs.py` so over-consumption and negative macro scenarios stay covered.
- The Cooking and Food Logging panes share a `FeedbackSnackbar` component to surface success and error toasts. Reuse that helper
  when adding new fridge interactions so the UX remains consistent.

---

## Tooling & Ports

- Vite dev server: `http://localhost:$DEV_FRONTEND_PORT`
- FastAPI docs: `http://localhost:$DEV_BACKEND_PORT/docs`
- Postgres: `localhost:$DEV_DB_PORT` using the credentials provided through your local environment variables (never commit real values).
- Optional DB client: DBeaver or psql using the above credentials.

---

## Troubleshooting

- **"Branch should be in its dedicated worktree"**  
  Run `pwsh ./scripts/env/check.ps1 -Fix` or manually create the worktree: `git worktree add "<worktree-parent>/nutrition-<sanitized>" <branch>`.
- **Detached HEAD**  
  Switch to a named branch before running the helpers.
- **Compose script exits early**  
  Ensure Docker Desktop is running and you selected a `data` mode.
- **Database restore fails on dependencies**  
  Re-run with `-ResetSchema` (PowerShell) or `--reset-schema` (Bash), then rerun migrations.
- **API schema or migrations drift gate fails in CI**  
  Run `pwsh ./scripts/db/sync-api-and-migrations.ps1`, review diffs, and commit generated files.

---

## Typical Commit Checklist

- [ ] Run `pwsh ./scripts/db/sync-api-and-migrations.ps1` when models or API routes change; commit new migrations, `Backend/openapi.json`, and `Frontend/src/api-types.ts`.
- [ ] Verify `pwsh ./scripts/db/check-migration-drift.ps1` reports no drift.
- [ ] Run `pwsh ./scripts/run-tests.ps1 -full` (or at minimum `./scripts/run-tests.sh --sync`).
- [ ] Ensure frontend lint/build succeed: `npm --prefix Frontend run lint` and `npm --prefix Frontend run build`.
- [ ] Snapshot database if needed: `pwsh ./scripts/db/backup.ps1`.
- [ ] Run `pwsh ./scripts/repo/check.ps1` to confirm worktrees and branches remain aligned.

---

## Continuous Integration (GitHub Actions)

The CI workflow contains **backend**, **frontend**, **authenticated-e2e**, and **production-smoke** jobs. A separate **branch-policy** workflow enforces integration and release topology. Authenticated E2E uses the disposable runner described above, requires successful API/browser execution, and uploads browser failure artifacts. Add `authenticated-e2e` to required checks using `.github/BRANCH_PROTECTION.md`; editing the workflow does not change GitHub rulesets automatically.

The backend job audits `Backend/requirements.txt` with `pip-audit` in a separate tool environment, including resolved transitive dependencies. Known vulnerabilities fail CI. The frontend job audits its committed npm lockfile. Run both audits when updating dependencies; passing application tests alone is not a security audit. Keep fixed release tags immutable and publish dependency fixes under a new release tag.

### Branch-policy job

- Working and dependency pull requests must target `development` and use an approved branch prefix.
- Their head commit must contain the current `development` tip, so stale or incorrectly based branches must be non-destructively updated before merge.
- Pull requests targeting `main` must come from `development`.
- A push to `main` must be a two-parent merge commit whose second parent is the exact `origin/development` tip.
- A pushed release tag must match `vMAJOR.MINOR.PATCH[-prerelease]` and point at the current `origin/main` commit.
- GitHub branch protection should require this `branch-policy` check on `main` and `development`; the repository workflow supplies the check, while the protection setting is configured in GitHub.
- The exact ruleset and activation order are recorded in [`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md). Activate it only after the named checks exist on the default branch.

### Backend job

- Spins up PostgreSQL 13 as a service.
- Checks out the repo, sets up Python 3.11 and Node 20.
- Caches pip and npm dependencies.
- Activates the virtualenv via `scripts/env/activate-venv.sh`.
- Runs `scripts/db/check-migration-drift.sh`; fails if migrations are missing.
- Runs Alembic migrations against the service database.
- Executes `scripts/db/update-api-schema.sh` to regenerate OpenAPI + TS types; fails if diffs remain.
- Runs backend tests with `pytest` after migration and generated-schema gates pass.
- Cleans the database schema on exit.

### Frontend job

- Installs Node 20.
- Caches npm modules.
- Runs `npm --prefix Frontend run lint` and `npm --prefix Frontend run build`.

### Production-smoke job

- Builds the production backend and frontend images.
- Starts the production Compose database, runs explicit Alembic migrations, and starts the application stack.
- Verifies edge and database-aware backend readiness endpoints before teardown.

---

Thanks for contributing!


### Legacy ownership adoption (Phase 5 integration checkpoint)

This is a maintenance-only operation, not a deployment script. Do not run against an
application database until writers are stopped, a verified backup exists, and the report
has been reviewed. Use the candidate image with an explicitly selected `DATABASE_URL`.
Keep the old application and Foundation maintenance jobs stopped through finalization.

1. Upgrade only to `b42d8f0a315c`, the expansion checkpoint.
2. Use the packaged `create_admin` and `manage_account create-user` commands to establish
   exactly one active administrator and one active ordinary account. Existing accounts
   are never silently deleted or promoted. The ordinary account will own all legacy data.
3. Generate the report (read-only, repeatable-read transaction):
   `python -m Backend.commands.adopt_legacy --email owner@example.com --dry-run --report adoption.json`.
   The output file must not already exist. Treat it as private operational data.
4. Review blockers, counts, IDs, previous identities, deterministic name suffixes,
   source archives, and shopping preferences. Duplicate names retain the lowest ID's
   name; remaining records receive collision-safe ` [legacy #ID]` suffixes, truncated
   to the column limit. Conflicting per-user shopping preferences require resolution.
5. Apply exactly that report:
   `python -m Backend.commands.adopt_legacy --email owner@example.com --apply --report adoption.json`.
   Changed data invalidates the report. Apply holds table locks (five-second lock timeout)
   and updates ownership, names, provenance, preferences and the ledger transactionally.
6. Immediately run `python -m alembic -c Backend/alembic.ini upgrade head`.
   Revision `c53e9a1b426d` checks the recorded post-adoption fingerprint before enforcing
   ownership. Any intervening data write blocks finalization. Investigate changes; do not
   edit the ledger, stamp the revision, or use downgrade as recovery. Restore the matched
   backup/image pair when the cutover cannot safely continue.

`--user-id` can replace `--email`. Both report and input paths are container-visible:
mount a dedicated host report directory for dry-run output, then mount the reviewed
file read-only for apply, for example `--mount type=bind,src=/host/adoption.json,dst=/reports/adoption.json,readonly`
with `docker run` and `--report /reports/adoption.json`. The host path is not passed as the
container's input path. No source-code mount is needed.

Every legacy ingredient becomes personal, including externally sourced or previously
shared ingredients. Canonical provider mappings are archived in
`ingredient_provenance_history` and detached; IDs, recipe references, persisted units,
plan payloads, historical nutrition and legacy device identities remain unchanged.
Existing per-user shopping choices transfer to the designated owner, with legacy defaults
used only when no override exists. Catalog defaults remain unchanged.
`all-personal-v1` records the owner and original report. Reapplying the original report
for the same owner is a no-op, including after later personal edits; another owner or
report is rejected. The command never imports or publishes catalog records.

Empty fresh databases may upgrade directly to head because no legacy content requires
adoption; the checkpoint/bootstrap/empty-adoption path is also rehearsed. Populated
upgrades must use the checkpoint. Accounts and seeding remain separate operations.
Foundation synchronization is available through the Phase 9 operator command after adoption.
Missing input fails before I/O. External catalog records are immutable through ordinary CRUD;
editing requires an explicit personal copy, without repointing recipes.

The script catalog entry for adoption is the cross-platform Python module
`Backend.commands.adopt_legacy` (flags above; intentionally no additional shell wrapper).
`python -m testsupport.run_schema_expansion` now rehearses expansion, adoption, final
constraints and drift across the supported starting revisions in disposable PostgreSQL
schemas, including stale reports, injected failure rollback, reference blockers,
preference conflicts, repeated apply, preserved values and authenticated owner/admin
visibility. The existing PowerShell/Bash schema-validation wrappers both call this module.
`python -m testsupport.run_account_commands_smoke` also exercises packaged adoption in
an isolated schema inside the production image, without a source mount or USDA key.


### Account and catalog boundaries (Phase 6)

USDA ingredients are canonical backend records. Importing one adds it to the signed-in
user's ingredient list; other accounts do not acquire that selection. Repeated imports
of the same provider ID reuse the canonical row. Ordinary CRUD always creates personal
ingredients and rejects client ownership, publication and provenance assertions.
Administrators have the same personal-content boundary as ordinary accounts.

- `POST /api/usda/import/{fdc_id}` accepts only the identifier in the URL (no body or
  `{}`). The backend fetches and verifies USDA data. Search/detail and both tag-creation
  APIs require authentication. Shared tags remain a common vocabulary.
- `POST /api/ingredients/{id}/copy` creates an independent personal ingredient and
  units. Historical provenance is archived without a provider mapping. Existing recipes
  continue to reference the original ingredient. The editor exposes this explicit action;
  canonical fields cannot be edited, including by an administrator.
- `DELETE /api/ingredients/{id}/selection` removes an unused canonical selection, not
  the canonical row. References in that user's recipes, plans, stored food or logs block
  removal. Personal ingredient/food deletion also returns HTTP 409 while referenced.
- `PUT /api/ingredients/{id}/shopping-preference` takes `{"unit_id":123}` or
  `{"unit_id":null}`. The unit must belong to the accessible ingredient. Null clears the
  override; resolution uses the user override, catalog default, then canonical gram unit.
- Plan writes validate food/ingredient IDs and recipe overrides. Another account's
  personal IDs return 404. Persisted unit conversions cannot be changed in place; add a
  new named unit so saved references retain their meaning.

Migration `d64f0b2c537e` follows the Phase 5 finalization revision. It adds per-user catalog
selections and shared login budgets, preserving selections implied by existing recipes,
plans, preferences, stored food and logs. The pre-adoption checkpoint remains
`b42d8f0a315c`; historical migration IDs and the all-personal adoption policy are unchanged.

Cookie-authenticated mutations and login require a matching `Origin` (or a same-origin
`Referer` fallback). API clients should send their configured application origin.
`CORS_ALLOW_ORIGINS` must list exact trusted browser origins for cross-origin use;
`*` grants neither credentialed CORS access nor mutation authorization. Same-origin
requests through the application proxy are supported. Development Compose defaults to
localhost and 127.0.0.1 at `DEV_FRONTEND_PORT` (3000 by default); set
`CORS_ALLOW_ORIGINS` explicitly for another development hostname or direct local backend.
Production requires secure session
cookies and HTTPS; explicit `SESSION_SECURE_COOKIE=false` is rejected in production.
Password changes and operator reset/deactivation revoke sessions transactionally.
Authenticated mutations lock the account row to coordinate reference edits/deletion and
account changes.

Login budgets persist across workers: at most 10 attempts per normalized email and 100
per client address in a fixed 15-minute window, including successful logins. Exceeding a
budget returns 429 with `Retry-After`; expired budget rows are periodically removed.
Configure the reverse proxy/server's trusted forwarding behavior deliberately: the limiter
uses the server's resolved client address and does not parse arbitrary forwarded headers.
A shared proxy address can therefore share the address budget. Actual production HTTPS
and proxy behavior still require Phase 10 validation.

Phase 8 preserves missing nutrients as null through trusted import, previews, calculations,
and new snapshots. Reimport refreshes verified canonical nutrition while retaining units,
IDs, personal copies and historical snapshots. Foundation synchronization follows the Phase 9 contract below.

`python -m testsupport.run_e2e` runs the PostgreSQL suite and authenticated API/browser
workflows with a loopback USDA fixture through the real server import path. Its test-only
ASGI wrapper validates the disposable database and is not included in production images.
No live USDA key or existing application database is required. See
[Phase 6 evidence](docs/integration-phase-6.md) for validation and remaining release gates.


### Browser account isolation (Phase 7)

Protected React providers mount only after `/api/auth/me` resolves. Each confirmed account
scope has an immutable user ID and a generation key. Identity checks suspend the old scope,
abort its requests, and unmount account-dependent caches and UI before protected content
can render again. Logout, focus/visibility changes, browser history restoration and
cross-tab session-change events trigger this boundary. Failed identity checks fail closed.

All application session-storage keys use `nutrition:v2:<encoded-user-id>:<workflow-key>`.
The hook covers planning, shopping, cooking, ingredient drafts and food drafts. Returning
to an account can restore its own persisted workflow state; another account cannot load
it. Transient component state and fetched caches are discarded. Legacy unscoped application
keys are removed from session/local storage because their ownership cannot be established;
they are not adopted into whichever account signs in first. Unrelated storage is retained.
Malformed or incompatible persisted values fall back to defaults; denied storage falls
back to memory. No anonymous workflow state is persisted.

Protected API calls must use `useAccountClient()` or `useAccountFetch()` under
`AccountScopeContext`, never the unscoped authentication client or raw fetch. Async
callbacks retain the original scope, including multi-request operations; old scopes cannot
issue follow-up writes or consume delayed bodies. Storage callbacks also stop writing when
their scope is invalidated. Keep the provider keyed by `scope.key` so hook initialization
cannot reuse another account's state.

Every protected browser request sends `X-Account-ID` as an expected identity. The backend
still authenticates exclusively with the session cookie. If another tab changes that cookie,
a mismatched expectation returns 409 with `X-Account-Mismatch: 1` before route operations,
including logout. This closes the cookie-change race between checking identity and saving
a draft. Requests from existing API clients may omit the header; it grants no permission.
A 401 or mismatch invalidates the browser scope and rechecks identity. Trusted CORS origins
can read the mismatch header. No database schema change is required.

Cross-tab messages contain only a session-change notification, never account data or tokens.
BroadcastChannel is used when available, with a local-storage event fallback. Storage or
channel availability does not replace the request identity guard. Real HTTPS deployment
and the remaining coordinated release gates are still Phase 10 work.

The shared `testsupport.run_e2e` runner seeds a separate ordinary-account pair for
browser isolation cases, preserving real login limits across the expanded suite. Both
shell E2E wrappers use this same runner. Failure diagnostics tolerate Windows console
encoding without masking the original test failure.


### Nutrient uncertainty (Phase 8)

Migration `e75a1c3d648f`, after `d64f0b2c537e`, makes nutrition and stored-food/log snapshot
nutrients nullable. It does not rewrite numeric history: an old zero stays zero. Apply the
existing expansion/adoption checkpoints before reaching this revision. Downgrading this
revision rejects any null nutrient instead of fabricating a replacement value.

API clients may omit unknown nutrients or send null; actual zero is a known value. Blank
personal ingredient fields mean unknown. Known values must be finite and nonnegative.
The frontend displays unavailable nutrients and incomplete totals as **Unavailable**. Each
nutrient propagates independently through addition, portions, recipe yields, planning,
cooking and logs. Zero quantity contributes zero; a missing ingredient makes its recipe
totals unknown. User-entered daily targets remain numeric.

USDA per-100-gram data is converted to per-gram values without filling omissions. Supported
explicit macro mass units are converted to grams; unsupported units remain unknown. Liquid
and unsupported bases are not guessed. The authenticated identifier-only import refreshes
nutrition on an existing verified canonical ingredient and records its artifact hash and
normalization version (`usda-per-g-nullable-v2`). It preserves ingredient/unit IDs and unit
conversions. Personal copies, stored batches and daily logs retain their own values.
There is no automatic reinterpretation of old zeroes or publication of personal ingredients.

`python -m testsupport.run_schema_expansion` also compares nutrition and snapshot rows
before/after the new revision. `python -m testsupport.run_e2e` covers incomplete USDA import,
recipe planning, nullable cooking snapshots, logging and reload using a deterministic
provider fixture. These runners only use disposable PostgreSQL databases; no live USDA key
or application database is needed. See [Phase 8 evidence](docs/integration-phase-8.md).


### Foundation catalog maintenance (Phase 9)

Run maintenance after completing adoption/final constraints. The packaged cross-platform
entry point is `python -m Backend.commands.sync_usda_foundation`; no additional shell
wrapper is needed. `--input` (or `USDA_FOUNDATION_FOODS_JSON`) accepts a container-visible
JSON/ZIP file or download URL. The production Compose service stays in the `maintenance`
profile; its default command never marks absent records stale. Mount host files read-only
as shown above. No USDA API key is needed for a downloaded artifact.

The script catalog's synchronization options are:

- `--input PATH_OR_URL`: source artifact. ZIPs must contain exactly one JSON document.
- `--expected-sha256 HEX`: SHA256 of the exact input bytes, including the ZIP bytes for a
  ZIP artifact. A mismatch rejects the run before catalog mutation.
- `--expected-count N`: reviewed number of records, before any deduplication (duplicates
  are rejected, even when identical).
- `--mark-stale --complete-snapshot`: explicitly request absent-entry stale marking and
  attest that the artifact is the complete official Foundation release. Both expected
  checksum and count are mandatory in this mode, as is the `FoundationFoods` envelope.

For example, after independently reviewing the official download and recording its count
and checksum (replace both placeholders):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml --profile maintenance run --rm --volume "/absolute/host/usda:/input:ro" usda-sync python -m Backend.commands.sync_usda_foundation --input /input/foundation.zip --mark-stale --complete-snapshot --expected-count REVIEWED_COUNT --expected-sha256 REVIEWED_SHA256
```

A parseable file cannot prove completeness or authenticity. The operator must verify the
release's provenance and completeness before making that attestation; do not derive the
expected count from an arbitrary partial file merely to bypass the guard. Subset updates
are supported without stale marking. Malformed/empty/truncated JSON, duplicate JSON keys,
ambiguous archives, non-Foundation records, conflicting/duplicate IDs, invalid nutrients
and invalid conversions reject the entire run.

The whole catalog update is transactional. A PostgreSQL provider lock serializes bulk
runs and excludes individual imports while a bulk run writes; different identifier imports
can otherwise proceed concurrently. CLI synchronization requires PostgreSQL. A clean,
dedicated SQLModel session is required when calling the service directly.

Only verified shared USDA objects can be updated. A mapping to personal/unverified data
blocks the run for operator reconciliation; it never publishes or repoints that record.
Persisted units are never renamed, reweighted or deleted. New conversions get new unit IDs,
comparison uses database precision, and new base units use `g`. A referenced `1 g` alias
remains intact even when `g` also exists. Recipes and per-user shopping overrides retain
their IDs. The catalog default may follow the current provider default; personal overrides
and historical snapshots are never rewritten. Seeding remains a separate explicit command.

Only absent records previously managed by a successful Foundation bulk run can become
stale. API-only imports, other USDA datasets, unverified mappings and personal objects are
excluded. Returning entries clear their stale marker. A fresh Foundation identifier import
also clears staleness while retaining bulk membership; an import of a different data type
removes that membership. Stale records are retained, including all references.

`catalog_sync_runs` records success/failure, completion time, artifact SHA256, a sanitized
artifact URI, normalization version and counts (or failure stage). Each synchronized source
records its raw-record hash and bulk run ID. Failures roll back catalog changes before a
separate failure audit is committed; an unavailable database cannot guarantee an audit row.
CLI failures never echo upstream URLs or exception details. Missing input/guard errors
exit before I/O. Bulk imports do not select ingredients into anyone's account automatically.

`python -m testsupport.run_e2e` covers PostgreSQL locking, reference preservation and rollback
alongside authenticated browser/API workflows. `python -m testsupport.run_account_commands_smoke`
also runs repeated checksum-verified Foundation CLI imports inside the production image,
without source mounts or live provider access. Both shell test paths use these same Python
runners. See [Phase 9 evidence](docs/integration-phase-9.md) for the validation record.

### Production cutover scripts (script catalog update)

`prod/deploy.ps1` and `prod/deploy.sh` now take the same staged arguments:
`prepare|maintenance|expand|report|finalize --evidence <directory>`, with
stage-specific digest, revision, owner and report-checksum flags. They call
`scripts/prod/cutover.py` (Python 3.11+), require an exact reviewed adoption report,
and leave traffic closed. The previous single-tag deploy interface is removed. Set `PYTHON` to an explicit
interpreter path if needed (including Git Bash on Windows).
`prod/rollback.ps1` and `.sh` fail closed during the ownership cutover; use the
clean-database recovery procedure rather than an unverified image-only rollback.
The manual backup entry points remain available, but the cutover uses its own
verified stopped-writer backup and separate-database restore checkpoint.

Follow [the account/USDA release runbook](docs/release-cutover.md) for the exact
sequence, HTTPS requirements, failure recovery and independent release gates.
The packaged `Backend.commands.release_snapshot` emits only table/ID/content
hashes, sequence state and database version for backup verification. It does not
modify the database. Evidence and backups are sensitive and must stay outside Git.

Local release validation: `python -m testsupport.run_release_cutover` builds
production images, runs a populated cutover and actual restore, injects checkpoint
failures, and performs an HTTPS Chromium account-isolation smoke. It requires
Docker, OpenSSL, installed frontend dependencies and Playwright Chromium; missing
tooling fails the run. The temporary certificate is for localhost only. CI runs
this as the required `release-cutover` job; remote success must be verified for
the actual candidate commit before integration.

### Rehearsing published release images

Pass both `--backend-image <repository@sha256:digest>` and
`--frontend-image <repository@sha256:digest>` to
`python -m testsupport.run_release_cutover` to pull and rehearse existing images.
This mode never builds replacement images and never deletes the supplied images.
Without those flags, the runner builds and removes temporary local images as before.
Evidence records the input references, resolved image IDs and image mode. Tags,
incomplete pairs and malformed digests fail before starting Docker work.
The existing snapshot and explicitly reviewed legacy-repair flags remain available.

Both publish script variants now point to the digest-based rehearsal and staged
`deploy prepare` flow. The production environment example describes only the
internal HTTP bind; certificates belong to the selected external HTTPS ingress.
The branch-protection contract requires `release-cutover` as well as the other
five checks. Documentation changes do not themselves change GitHub enforcement.

LAN-only home-server topology and pending inventory are recorded in [home-server preparation](docs/home-server-preparation.md). The Caddy example is a proposed guest-host configuration, not a deployed service.


### Private homelab HTTP deployment

The home deployment explicitly defers HTTPS to a separate infrastructure project.
Follow [home-server preparation](docs/home-server-preparation.md) and the
[VM provisioning guide](docs/home-vm-provisioning.md). Production defaults still
require secure cookies. Private HTTP requires both `SESSION_SECURE_COOKIE=false`
and `ALLOW_INSECURE_HTTP=true`, plus explicit HTTP `CORS_ALLOW_ORIGINS`.
Keep `ENVIRONMENT=production` and `DB_AUTO_CREATE=false`; restrict edge access to
the intended network. HTTP traffic is unencrypted. Record HTTPS release checks
as deferred for this owner-selected deployment, not passed. Existing HTTPS
rehearsals remain useful regression coverage and are not removed.


The disposable `testsupport.run_release_cutover` stack orders nginx startup after
its backend/frontend dependencies so upstream DNS names exist at startup. Failed
readiness checks print the last connection error and bounded service logs before
cleanup. The production Compose file already orders services using health checks.

The release runner accepts `--transport http` for the explicitly selected private
HTTP deployment. HTTPS remains the default. Both modes use production settings,
isolated data and loopback-only ports. The HTTP mode explicitly enables insecure
transport and checks the named session cookie is HttpOnly/SameSite=Lax without
Secure; HTTPS requires Secure. Both reject an untrusted-origin logout and verify
the session survives that rejection. CI runs both modes in `release-cutover` and
retains separate logs. Append the same transport flag to historical or published
digest rehearsals; this does not validate router rules or deploy a permanent site.
The existing `release_https_smoke.cjs` filename and `RELEASE_HTTPS_ORIGIN` variable
remain compatible; `RELEASE_TRANSPORT=http` is mandatory for an HTTP origin.
