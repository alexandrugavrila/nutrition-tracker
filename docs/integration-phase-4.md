# Phase 4: ownership and provenance expansion

Implemented on the stabilization branch after `cec88287`. The pre-adoption
checkpoint is **`b42d8f0a315c`**, following `a31c7e9f204b`. No prior migration was
edited. This is an integration-only checkpoint, not a deployable account cutover.

## Schema contract

- Ingredients gain `is_shared`, default false for existing and new rows. A shared
  row cannot have an owner. Personal rows may remain ownerless during expansion;
  final non-null ownership constraints belong to Phase 5.
- Provider identity remains unique by `(source, source_id)`. All existing mappings
  start `unverified`, regardless of existing payload hashes. Verification status is
  constrained to `unverified`, `verified`, or `rejected`. Verified mappings require
  a timestamp, artifact checksum and normalization version, with an optional FK to
  their import run. Catalog runs gain checksum, artifact URI and normalization version.
- Logs and stored food gain nullable `owner_user_id` foreign keys without changing
  their existing `user_id` identity strings. New API writes set the authenticated
  owner. Reads use the owner FK so matching legacy strings cannot grant access.
- `user_ingredient_preferences` has key `(user_id, ingredient_id)` and a composite
  foreign key requiring a unit of that ingredient. Clearing an override will remove
  its row. Catalog defaults are untouched; preference APIs/resolution remain Phase 6.
- `ownership_adoptions` is a completed-version ledger with selected owner, mapping,
  report, hash and completion time. `ingredient_provenance_history` can retain a
  personal row's historical source metadata independently of canonical mappings.
  Expansion leaves both tables empty; no adoption/classification is performed.

## Transitional application behavior

Ingredient visibility requires either personal ownership or an explicit shared flag
with no owner and verified provenance. Ownerless/unverified rows remain hidden from
all accounts, including administrators. Food, log and stored-food reference checks
use the same ingredient rule; ownerless recipes no longer have an admin exception.

The ingredient serializer now returns the real owner, shared state, and primary
source verification status. Log/stored-food responses expose the nullable owner FK.
OpenAPI and frontend types were regenerated with the repository's pinned generator.

The existing source-ID creation path now creates personal, unverified ingredients;
its lookup cannot return another account's or an unclassified ingredient. These
bounded changes are necessary to avoid bypassing the transitional visibility rule.
They do not replace Phase 6's identifier-only trusted import endpoint, complete
permission matrix, or catalog-edit protections. Foundation synchronization does not
publish newly synchronized records; its verified writer lifecycle remains Phase 9.
Explicit starter seeding requires any referenced catalog source to be verified/shared.

Keep writers stopped through expansion, explicit adoption and final constraints.
Starting this intermediate application against existing data intentionally hides
unassigned rows; that is not a completed migration of account ownership.

## Recorded validation (2026-10-12)

- `python -m testsupport.run_schema_expansion`: seven successful paths to the named
  checkpoint: fresh `base`, then populated `d3f0b1c2e7ad`, `b6a1f2c3d4e5`,
  `6b2f8f8d9c11`, `8c9d0e1f2a3b`, `91b4c6d8e2f0`, and `a31c7e9f204b`.
  Each uses a unique schema in a disposable tmpfs PostgreSQL 13 stack. The complete
  migration graph/head was checked. Every path passed Alembic model-drift validation.
- Populated fixtures include duplicate names where the old schema permits them,
  unverified source mappings with payload hashes, referenced legacy/canonical gram
  units, shopping defaults, recipe relations, plan JSON, stored food and daily logs.
  All pre-existing column values, row counts, IDs and references survived unchanged.
  No ingredient became shared; no source became verified; no owner was assigned.
- Required migration-created PostgreSQL suite: **158 passed**, with three API E2E
  tests deselected and subsequently run against the authenticated application.
  This includes per-user preference keys, matching-unit FK rejection, source evidence
  checks, shared-owner constraint rejection, hidden transitional rows and serialization.
- Authenticated API E2E: **3 passed**. Chromium workflows: **5 passed**.
- Frontend unit suite: **56 passed**. After correcting a generated-type fixture,
  its focused shopping suite passed again (**4 tests**). Frontend build passed.
- Production-image migrations, drift and packaged account command smoke passed,
  without source mounts or a USDA key. Tested image identity:
  `sha256:969725599e397ffd9b7b3e4eb34f10ca72008e3bbc423ad802f087987ceca508`.
  Its disposable database and temporary image were removed after validation.
- Added the populated-upgrade rehearsal to the backend CI job. Remote CI has not
  yet run for this local change.
- Original feature worktree still has exactly its six preserved modified files;
  status and SHA-256 checksums match the Phase 1 preservation artifacts.
- `git diff --check` passed. Existing migration files have no diff.

## Validation limitations and remaining gates

An additional strict TypeScript check fails on the existing `baseUrl` deprecation.
With the one-off compiler option `--ignoreDeprecations 6.0`, it reports 467 existing
frontend errors (including React/MUI API mismatches). A compiler-host comparison
against the original frontend files at `cec88287` confirmed the same 467 diagnostic
locations and codes after correcting this phase's fixture. No suppression was added
to repository configuration. Strict TypeScript is **not a passing check**; these
baseline problems remain a release-validation issue, despite passing build/runtime tests.

The repository audit still reports the pre-existing unrelated
`nutrition-fix-migration-drift-readiness` worktree naming mismatch. It was left untouched.
The canonical sync helper manages branch databases, so equivalent OpenAPI generation,
model comparison and migrations were run explicitly on disposable infrastructure.
No existing application database was accessed; no adoption, publication, final ownership
constraints, deployment or remote merge was attempted. An actual deployed revision and
representative production restore still need the later roadmap's rehearsal gates.
