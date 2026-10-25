# Phase 8 — Preserve nutrient uncertainty

Implemented on the stabilization branch after `c2cff3ce`. Missing nutrients remain null;
actual zero remains numeric zero. This phase does not deploy the combined feature.

## Contract and changes

- Corrective migration `e75a1c3d648f` follows `d64f0b2c537e`. It makes the five nutrient
  columns nullable in `nutrition`, `stored_food`, and `daily_log_entries`, without data
  updates or changes to existing revision identifiers. A downgrade refuses rows containing
  null nutrients instead of substituting zero.
- API schemas accept omitted/null nutrients and validate known values as finite and
  nonnegative. OpenAPI and generated frontend types expose the nullable contract.
- USDA normalization preserves missing values and genuine zeroes. Explicit gram/milligram/
  microgram macro units are handled; unsupported units remain unknown. Unsupported bases,
  including liquid data without density, remain unimportable.
- Identifier-only trusted imports now accept incomplete nutrition. Reimport updates only
  the verified canonical ingredient's nutrition and provenance timestamp/hash/version
  (`usda-per-g-nullable-v2`). Ingredient IDs, persisted units and conversions, recipes,
  private copies, stored batches and historical logs are preserved. Personal or unverified
  source mappings still require operator reconciliation.
- Nullable arithmetic is shared by ingredient portions, recipes, planning, fridge inventory,
  cooking and logging. Each nutrient propagates independently: adding a known amount to an
  unknown amount remains unknown; multiplying unknown nutrition by a positive quantity
  remains unknown. Zero quantity contributes zero. Missing recipe ingredients do not yield
  misleading partial totals. Numeric daily targets are a separate type.
- Ingredient forms start blank and save blanks as null. Focusing an actual zero no longer
  clears it. USDA previews, tables and aggregate displays show unavailable values rather
  than numeric zero. Cooking and logging preserve null snapshots, including after reload.
- Historical numbers are not reinterpreted. Old zeroes remain zero, including snapshots
  created before a canonical USDA refresh. Copies remain independent personal records.

## Validation

All database validation used uniquely named disposable PostgreSQL stacks/schemas. No
existing application database, production server or original feature worktree was modified.
The ordinary database-sync wrapper was not used because it can target the branch database;
OpenAPI generation used database auto-creation disabled, and drift checks used migrated
PostgreSQL instead.

Executed on 2026-10-15:

- `python -m testsupport.run_e2e`: **194 backend tests passed** on migration-created
  PostgreSQL, **3 authenticated API E2E tests passed**, **9 Chromium tests passed**.
  No required tests skipped. The added browser workflow imports incomplete USDA nutrition,
  makes a recipe, plans/cooks it, checks nullable persisted snapshots, logs it and reloads
  the unavailable daily total. Existing account-isolation workflows also pass.
- Frontend Vitest: **77 tests passed** across 15 files. Regression cases include missing
  versus zero values, independent null propagation, missing recipe references, blank form
  edits, nullable cooking payloads, and null/zero daily log totals.
- `python -m testsupport.run_schema_expansion`: **8 fresh/populated upgrade paths passed**
  through expansion, adoption, final constraints and the new nullable revision. Every path
  passed Alembic drift checks and compares complete nutrition/snapshot rows immediately
  before and after the Phase 8 migration to verify numeric-history preservation.
- `python -m testsupport.run_account_commands_smoke`: production backend image build,
  migration/drift, bootstrap and packaged account/adoption operations passed without source
  mounts or a USDA key. The disposable image and stack were cleaned up after validation.
- Production frontend build passes. OpenAPI matches the application schema and frontend
  types were regenerated using openapi-typescript 7.13.0.
- TypeScript comparison: **466 baseline / 452 current diagnostics**, with no added
  counts by file/diagnostic code. Existing MUI and strict typing issues remain; this is
  not a clean whole-project typecheck.
- The original dirty feature worktree still has the same six modified files, with SHA256
  hashes matching the saved Phase 1 preservation manifest. `git diff --check` passes.

The first integration attempt was blocked by Docker Desktop startup failure. After the
engine became available, the full PostgreSQL/browser and image checks above passed. The
SQLite fallback run (174 passed, 5 PostgreSQL-only tests skipped) is supplementary evidence,
not the migration or integration gate.

## Remaining gates

Foundation bulk synchronization is still disabled pending Phase 9's input validation,
provider serialization and reference-preserving update work. Representative production
restore, HTTPS validation, remote CI and deployment approval remain Phase 10/release work.
This local result is not a declaration that the combined feature is ready for production.
