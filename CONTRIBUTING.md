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
   pwsh ./scripts/switch-worktree-branch.ps1 feature/my-feature
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
| `USDA_API_KEY` | Yes | — | Required for USDA endpoints. |
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
  - Purpose: spin up a branch-isolated Docker Compose test stack, wait for the backend and frontend to become healthy, then execute both `pytest -m e2e` against `Backend/tests/test_e2e_api.py` and the Playwright browser suite under `Frontend/e2e/`.
  - Flags: accepts additional pytest arguments (pass-through). Both variants honour `-h|--help`.
  - Call graph: loads helpers from `scripts/lib/venv.*`, `scripts/lib/branch-env.*`, and `scripts/lib/compose-utils.*`; always shells into `scripts/docker/compose.ps1|.sh` (`up ...` to start, `down ...` to tear down), then runs `npm --prefix Frontend run e2e:install` followed by `npm --prefix Frontend run e2e`.

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
  - Requirements: `.env.production` must define critical runtime variables (`BACKEND_IMAGE`, `FRONTEND_IMAGE`, database credentials, `DATABASE_URL`, `USDA_API_KEY`, `CORS_ALLOW_ORIGINS`), plus edge TLS certificate mount inputs (`EDGE_TLS_CERTS_DIR`) or Compose exits immediately via `${VAR:?error}` guards where configured.

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

The e2e runners launch a temporary stack on the `TEST_*` ports, run both the API and browser suites against that stack, and clean up after completion.

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

The CI workflow contains **backend**, **frontend**, **e2e**, and **production-smoke** jobs. A separate **branch-policy** workflow enforces the integration and release topology. The E2E job runs the existing API and Playwright suites against an isolated Docker test stack on a disposable runner checkout and always attempts teardown. It uses a temporary local branch to satisfy the branch-aware test helpers; that branch is never pushed.

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
