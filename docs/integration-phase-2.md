# Phase 2: baseline reconciliation and trustworthy tests

Starting point: `924b9f49` on the stabilization branch, based on committed
`feature/user-accounts` (`342605c1`). Merge source: development `e7aeab70`.
The original dirty feature worktree and its six-file patch were not incorporated.

## Reconciliation

- Retained development's branch policy, publishing safeguards, migration-drift
  readiness fix, frontend workflow selectors, and security dependency updates.
- Retained the account branch's Argon2 dependency and newer account-compatible
  Python/frontend requirements. Regenerated the npm lockfile and applied compatible
  transitive security fixes; no advisory suppressions were added.
- Bounded SQLAlchemy to `<2.1`: a fresh unbounded install selected 2.1, which
  attempted to load `psycopg` for existing PostgreSQL URLs while this application
  installs `psycopg2-binary`. The validated environment used SQLAlchemy 2.0.54.

## Test contract

Tests select anonymous, admin, user-A, or user-B fixtures explicitly. Existing
ownerless-catalog mutation tests retain an explicit admin fixture; successful
admin tests are not evidence of ordinary-user authorization.

`DATABASE_URL` no longer controls destructive test fixtures. PostgreSQL requires
`TEST_DATABASE_URL` plus exact-name `TEST_DATABASE_CONFIRM`, with a database name
ending in `_test`. Each test run migrates a unique schema, truncates only that
schema's tables, and drops only that schema. SQLite defaults to memory.

The cross-platform E2E runner creates its own Compose project and tmpfs PostgreSQL
database, migrates it, seeds ordinary test accounts, starts local API/Vite child
processes, and runs authenticated API and browser suites. Missing infrastructure
or credentials fails the required job. Cleanup removes only resources it created.
See CONTRIBUTING.md for commands and prerequisites.

## Local validation

- Migration-created PostgreSQL suite: 147 passed; 3 live E2E tests deselected there.
- Separate required-E2E missing-environment regression: 1 passed.
- Authenticated live API E2E: 3 passed.
- Chromium E2E: 5 passed, including UI login/logout and nutrition workflows.
- Frontend unit tests: 56 passed with two workers; lint and production build passed.
- PostgreSQL `alembic check`: no new upgrade operations detected.
- Runtime OpenAPI equals the checked-in schema.
- npm and backend requirements audits: no known vulnerabilities reported.

An initial frontend run timed out on a lazy route while using unrestricted workers;
the complete suite passed with two workers, now the configured default. Initial
fresh-install PostgreSQL validation exposed the SQLAlchemy issue described above;
validation was repeated successfully after bounding the requirement.

No existing application database was migrated or read. These checks are fresh-test
database validation, not a representative populated-production upgrade rehearsal.
Remote CI, ruleset activation, immutable production-image smoke testing, adoption,
and production deployment remain later gates. Add `authenticated-e2e` as a required
GitHub check after the workflow is available; repository files do not modify the
remote ruleset themselves.
