# Phase 5: all-personal legacy ownership adoption

Implemented on the stabilization branch after `ea276de9`. This remains an
integration-only change; no application or production database was accessed or
adopted. The original feature worktree's six-file status and SHA-256 checksums
still match the preservation artifact.

## Agreed ownership contract

All legacy content goes to the selected active ordinary account. Adoption requires
exactly that account and one active administrator, and never creates, deletes or
promotes accounts implicitly. External sharing is backend catalog deduplication,
not user-to-user sharing. Every adopted ingredient is personal. Its source mapping
is archived, then detached from canonical provider identity; later imports cannot
update or replace those personal records. Future editing of a canonical external
ingredient requires an explicit personal copy, without automatic recipe rewrites
(the Phase 6 interface remains outstanding).

The user approved preserving duplicate names with deterministic suffixes. The
lowest ID retains the original name; other records receive collision-safe
` [legacy #ID]` suffixes within the existing column length. IDs never change.

## Implementation

- `Backend.commands.adopt_legacy`: read-only dry run, exclusive report-file creation,
  explicit apply of the exact reviewed JSON, PostgreSQL/checkpoint guards, and
  sanitized database errors. Select the owner by email or immutable user ID.
- `Backend.services.adoption`: deterministic whole-database fingerprint, account and
  relational-reference validation, validation of known plan JSON references/unit
  overrides, name mapping, preference reconciliation, source archival, atomic
  apply with writer locks and rollback, and durable `all-personal-v1` bookkeeping.
  Reports contain identifiers, names, counts and changes, not password/session hashes.
- The original per-user preference wins over a legacy default; competing per-user
  choices block adoption. Defaults and persisted units remain unchanged. Preferences
  are assigned only to the designated owner.
- The expansion checkpoint remains `b42d8f0a315c`. New revision `c53e9a1b426d` checks
  a post-adoption fingerprint and exact adopted IDs/owners before requiring owners
  for personal ingredients, foods, plans, stored food and daily logs. Existing FKs
  enforce valid users. No historical revisions were changed. Empty databases can
  upgrade directly; the checkpoint/empty-adoption path is also tested.
- Original log/stored-food identity strings are preserved for historical reference;
  the non-null `owner_user_id` FK is the application's ownership boundary.
- `manage_account create-user` creates an empty ordinary account using hidden or
  stdin password entry. Existing emails fail without mutation.
- The unsafe Foundation sync writer is removed and both callable/CLI entry points
  fail before I/O pending Phase 9. Missing-input validation remains intact. Loader
  and conversion helpers remain available. This is an intentional interim blocker,
  not a completed synchronization implementation.

See CONTRIBUTING's **Legacy ownership adoption** section for the maintenance
sequence, report mounts, idempotence and recovery guidance. Keep all writers stopped
through finalization; a changed fingerprint requires investigation, not ledger
editing, stamping, or a downgrade.

## Validation (2026-10-12)

- Migration-created PostgreSQL unit/role suite: **160 passed**, no skipped tests.
- Frontend units: **56 passed** across 14 files.
- Authenticated API E2E: **3 passed**; Chromium workflows: **5 passed**.
- Eight isolated PostgreSQL upgrade paths: `base`, `d3f0b1c2e7ad`, `b6a1f2c3d4e5`,
  `6b2f8f8d9c11`, `8c9d0e1f2a3b`, `91b4c6d8e2f0`, `a31c7e9f204b`, and
  `b42d8f0a315c`, through expansion/adoption/final constraints. Every path passes
  Alembic drift checks. The last checkpoint path was run separately after extending
  the same cross-platform runner.
- Fixtures cover duplicate ingredient/recipe names, numeric precision and zero,
  canonical and referenced legacy gram aliases, source mappings, shopping choices,
  recipes, plan JSON, stored food, and logs. Assertions check preserved values/IDs,
  dry-run immutability, stale-report refusal, broken embedded references, preference
  conflicts, injected failure rollback, conflicting/same-owner reruns, finalization
  refusal after intervening writes, and authenticated owner/admin visibility.
  The checkpoint run additionally verifies a rerun preserves later personal edits.
- Production-image command smoke: bootstrap/repeat/collision, explicit seed/repeat,
  password reset/activation/session revocation, ordinary-account creation, packaged
  adoption/apply/repeat and final migration/drift. No source mounts or USDA key.
  Final tested image ID: `sha256:8ba134d6527892c181da1d371f6063fa1453248a44e9bcfcf7d29697ee3c30a2`
  (local smoke image removed after validation; not a published release image).
- OpenAPI structurally unchanged; no generated frontend type changes required.
  Migration/API checks used disposable databases and direct schema comparison rather
  than the branch database wrapper, which can access existing databases.
- `git diff --check` passes. Original feature patch preservation verified.

## Remaining gates

Remote CI and representative production-data rehearsal remain unverified. No push,
merge, promotion, or deployment was performed. Phase 4's existing strict TypeScript
baseline remains outstanding; no frontend implementation or generated types changed
here. Phase 6 authorization/catalog APIs, Phase 7 browser isolation, Phase 8 nutrient
uncertainty, Phase 9 synchronization, and Phase 10 deployment/restore gates remain.
Synthetic upgrade fixtures do not replace a representative backup restore rehearsal.
