# Phase 6 — Authorization and session boundaries

Implemented on the stabilization branch after Phase 5. This is an integration change,
not a deployment or a declaration that the combined feature is ready to release.

## Permission contract

| Operation | Anonymous | Ordinary account / administrator |
|---|---|---|
| Personal content | 401 | Own records only; another owner's IDs return 404 |
| USDA search/detail/import | 401 | Identifier-only server import; verified canonical data |
| Canonical ingredient fields | No access | Read-only, including administrators |
| Personal copy | No access | Explicit copy with independent ingredient/unit IDs |
| Shopping choice | No access | Own override on an accessible ingredient |
| Ingredient/food tag creation | 401 | Allowed in the shared vocabulary |
| Referenced ingredient/food deletion | No access | 409; history and saved references preserved |

A user's USDA selections are separate from canonical storage. Importing the same USDA
ID from two accounts reuses one canonical record and adds two independent selections.
An account does not see every imported catalog item automatically. Removing a selection
never deletes the canonical record and is blocked while that account references it.
Personal copies retain historical provenance only; they never receive provider updates
and copying does not repoint existing recipes or plans.

## Implementation

- Ordinary ingredient input rejects ownership and provenance claims. Shared CRUD is
  immutable. Preferences resolve per user without changing the canonical default.
- Plan writes validate the existing JSON structure, referenced ingredients/foods,
  matching units, recipe override membership and finite nonnegative quantities.
  Recipe changes also preserve the validity of existing plan overrides.
- Deletion checks recipes, plan JSON, stored food and logs. Stored-batch removal retains
  the existing source reassignment behavior, preserving numeric log snapshots.
  Persisted unit conversions remain stable; new conversions require new units.
- Authenticated mutations serialize on the account row. Provider import serializes by
  USDA ID with PostgreSQL transaction advisory locks and retains provider uniqueness.
- USDA normalization is extracted into a service; upstream failures return sanitized
  errors. Client payloads cannot inject catalog contents or provider URLs.
- Login uses shared database budgets, unknown-account password verification, bounded
  credential input, and row locks coordinated with account maintenance. Password change
  and session revocation commit together. Cookie mutations/login validate origins;
  wildcard CORS does not grant credentialed reads. Production requires secure cookies.
- Browser import, explicit copy and shopping-preference flows use the new APIs. Full
  account-transition browser isolation remains Phase 7.

Migration `d64f0b2c537e` adds `catalog_selections` and `login_budgets` after `c53e9a1b426d`.
Selections are backfilled from recipe, plan, shopping preference, stored-food and log
references. Historical migration IDs remain intact. Adoption still runs at
`b42d8f0a315c`, so its snapshot/locking contract excludes the two later tables.
Legacy data remains personal under the approved all-personal adoption policy.

## Validation

Validation uses disposable PostgreSQL containers/schemas and synthetic provider data;
no existing application database or real USDA key is needed. The test-only loopback
provider and ASGI wrapper are excluded from production packaging.

- Eight supported legacy/fresh upgrade paths passed expansion, reviewed adoption,
  ownership finalization and Alembic drift checks at the new head. A focused PostgreSQL
  test additionally exercises the final catalog-selection backfill SQL with recipe,
  plan, preference, stored-food and log dependencies, duplicates and an unselected row.
- PostgreSQL API tests cover anonymous/admin/A/B permissions, forged provenance,
  source-ID races, inaccessible IDs, mismatched units, reference-safe deletion,
  independent copies/preferences, cookie flags, origin rejection, throttling,
  password rollback and concurrent login/reset and plan/delete operations.
- Frontend: 56 unit tests pass; production build passes. Authenticated browser workflows
  exercise real backend USDA import using the local fixture, explicit copying, recipes,
  planning, shopping, cooking and log preservation.
- OpenAPI matches the application; frontend types regenerated with openapi-typescript
  7.13.0. Strict TypeScript remains blocked by inherited diagnostics: baseline 467,
  current 466, no added diagnostics (same compiler settings; line shifts ignored).
- Production-image smoke exercises empty bootstrap, repeat/collision behavior,
  explicit seeding, account maintenance, session revocation and populated adoption.
- Worktree environment validation passes. The repository audit retains the unrelated
  existing `nutrition-fix-migration-drift-readiness` naming mismatch. Direct OpenAPI and
  disposable migration/drift checks replace wrappers that could reach a branch database.
- Original feature commit `342605c1da85053dbb252e750736b01e79e14a2a`, its six-file
  status and every saved SHA256 checksum remain unchanged. No dirty patch was ported.

Final validation on 2026-10-13: **184 PostgreSQL tests**, **56 frontend unit tests**,
**3 authenticated API E2E tests**, and **5 Chromium workflows** passed. No PostgreSQL
unit tests were skipped; the three E2E tests were deselected from that suite and run
separately. Development Compose configuration passed with a computed custom frontend
port and an explicit trusted-origin override. The production account/adoption smoke
passed with image `sha256:ab1f033795b3d3af2bd30851a7c38dd101b3c26e4de5577db6a9c1b6edef410d`;
this local test image was removed after the smoke and is not a published release image.
`git diff --check` passes.

## Remaining gates and intentional limits

Trusted import currently rejects incomplete nutrient records. Phase 8 must add nullable
nutrition end-to-end; proxy preview normalization and historical numeric snapshots have
not been reinterpreted here. Existing canonical imports are selected without refresh.
Foundation synchronization remains disabled until Phase 9.

Phase 7 account-transition isolation, Phase 8 uncertainty, Phase 9 safe synchronization
and Phase 10 deployment/restore work remain. Remote CI, representative production-data
rehearsal, real HTTPS/proxy topology and live USDA integration remain unverified release
gates. Login address limits use the server-resolved peer address; proxy trust must be
configured and exercised in deployment validation. No push, merge or deployment is part
of this phase. Synthetic migration tests do not replace a representative restore drill.
