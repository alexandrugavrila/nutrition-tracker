# Phase 3: empty accounts and packaged account operations

Implemented on the existing stabilization branch after `2c01490f`. This is an
integration-only change; the remaining ownership, provenance, security, browser,
nutrition, synchronization and deployment gates still apply.

## Decisions and behavior

- API account creation and administrator bootstrap create empty accounts.
- Production startup and Compose allow a missing USDA key; USDA endpoints retain
  their unavailable response when no key is configured.
- Packaged commands: `Backend.commands.create_admin`, `manage_account`, and
  `seed_starter_data`. The production image already copies these modules.
- Bootstrap normalizes email, leaves existing administrators entirely unchanged,
  and refuses to promote an existing non-admin. Passwords use hidden confirmation
  or one stdin line, never a plaintext command argument.
- Reset, activation and deactivation revoke sessions within the account transaction.
- Explicit seeding locks the account on PostgreSQL, uses a savepoint, and records
  a manifest version and SHA-256 hash. Completed versions are not regenerated after
  personal edits/deletions. Changed content under an already-used version fails.
- Existing seed names are reused without overwriting edits. Missing source/unit
  prerequisites fail and roll back the complete seed. Sourced ingredients owned
  by an account cannot be used as shared starter ingredients.
- Additive migration `a31c7e9f204b` follows `91b4c6d8e2f0`; previous revisions are
  unchanged. Existing installations receive no inferred seed completion markers.
- Both shell wrappers now use the caller's activated Python and explicitly configured
  database. They no longer start containers or choose a branch database implicitly.
  Contributor documentation contains the exact command/flag contract.

## Validation (2026-10-12)

- Focused auth/ownership/settings: 22 passed.
- New account-operation tests: 7 passed, including bootstrap collision, transactional
  session revocation/rollback, partial-seed rollback, edit/deletion preservation,
  changed-manifest rejection and password-input safety.
- Full SQLite suite: 154 passed; one E2E module intentionally excluded without its environment.
- Migration-created disposable PostgreSQL suite: 154 passed; 3 E2E tests deselected
  and subsequently run against the authenticated application.
- Authenticated API E2E: 3 passed; Chromium browser workflows: 5 passed.
- Frontend unit suite: 56 passed.
- Production Compose/missing-input checks: 7 passed, now also without a USDA key.
- Production image: built successfully; migration to head and Alembic drift check
  passed (`No new upgrade operations detected`). Bootstrap/repeat/non-admin collision,
  empty-catalog account state, explicit/repeated seeding, password reset, activation,
  deactivation and session revocation passed without source mounts or a USDA key.
- Tested image identity: `sha256:fd0bb645cf9d706ff60d94a7e4d3d88ac5beb6f3ef9d63a5d2188bd4fdbad91f`.
  The temporary image and disposable database were removed after validation.
- OpenAPI matches the committed schema exactly; no API type changes required.
- PowerShell command wrappers' help paths and Bash syntax verified.
- After full-suite validation, added and passed the seventh focused regression
  ensuring hidden password prompts cannot fall back to echoed input; rebuilt and
  reran the production-image smoke against the final backend code.
- Original feature worktree status and all six preserved SHA-256 file hashes match
  the phase-1 recovery artifacts. No original patch changes were incorporated.

Docker was initially stopped; starting Docker Desktop resolved the local validation
blocker. Existing application databases were not accessed. The canonical API/migration
sync script manages branch databases, so equivalent OpenAPI comparison and Alembic
checks were performed explicitly against disposable infrastructure instead.

Remote CI has not run for this local commit. Production deployment, representative
legacy-data rehearsal, and the later roadmap gates are outside Phase 3.
