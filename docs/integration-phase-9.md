# Phase 9 — Reference-safe Foundation synchronization

Implemented on the stabilization branch after `439737da`. This enables the packaged
Foundation maintenance command; it does not deploy or promote the combined feature.

## Behavior and boundaries

- A small synchronization service validates the entire artifact before catalog mutation.
  Empty/unknown envelopes, malformed records, non-Foundation data, duplicate/conflicting
  IDs, invalid amounts/conversions, duplicate JSON keys, truncated JSON and ambiguous ZIPs
  fail closed. Missing nutrients remain null through the Phase 8 normalization service.
- Normal runs update only supplied records. Stale marking requires `--mark-stale`, an
  explicit `--complete-snapshot` attestation, an independently reviewed `--expected-count`
  and `--expected-sha256`, and the official `FoundationFoods` envelope. The checksum covers
  exact file bytes (ZIP bytes for ZIP inputs). A structurally valid subset is not proof of
  completeness; operator review of the release remains necessary.
- Stale marking is limited to verified shared sources previously managed by a successful
  Foundation bulk run. Personal/unverified mappings, other datasets and API-only imports
  are excluded. Absent records remain stored. Returning records clear staleness. Foundation
  identifier refreshes retain bulk membership; other data types remove it.
- Ingredient IDs, every persisted unit, recipe links and per-user shopping overrides are
  retained. Unit comparisons use database precision. A changed conversion creates a new
  unit instead of changing an existing unit's weight. New base units use `g`; persisted
  `1 g` aliases are neither renamed nor deleted. Catalog defaults can follow provider
  defaults, while personal overrides retain their chosen unit IDs.
- Only verified canonical provider records are updated. Any collision with personal or
  unverified provenance aborts the transaction for operator reconciliation. Synchronization
  never publishes, repoints or updates personal copies. Historical snapshots remain separate.
- PostgreSQL exclusive provider locks serialize bulk writers and exclude identifier imports
  while a run writes. Identifier imports otherwise retain shared provider/per-ID locking.
  The CLI requires PostgreSQL; SQLite is used only for isolated functional tests.
- Each successful run records counts, the artifact checksum, sanitized URI, normalization
  version and timestamps. Source mappings record per-record hashes and the successful bulk
  run ID. A failed catalog transaction rolls back before a separate failed-run audit commits.
  An unavailable database cannot guarantee failure-audit persistence. Upstream exception
  URLs and credentials are not returned or recorded.
- The maintenance profile remains opt-in. Its Compose command no longer implicitly enables
  stale marking. Missing input and incomplete stale-marking arguments fail before I/O.
- Starter seeding remains an explicit version-idempotent operation; it is not an import
  side effect. The existing packaged seeding service works with synchronized source records.

No schema or API contract change was required. Provider validation is factored from the
identifier importer for shared use, and both paths use the existing normalization service.
The manifest converter also uses that service and the strict artifact loader.

## Original patch disposition

The six-file uncommitted patch remains untouched in `nutrition-feature-user-accounts` at
`342605c1da85053dbb252e750736b01e79e14a2a`. Its Phase 1 preservation checksums still match.
This implementation explicitly adopts the original patch's `g` label intent in the shared
normalizer and corresponding tests. It rejects the patch's removal/renaming of persisted
legacy units, replacing it with additive units and coexistence/reference regression tests.
The original README/CONTRIBUTING workspace-path edits were not ported as part of this phase.

## Validation

Validation on 2026-10-16 used only disposable databases, deterministic provider fixtures and
local image builds. Docker was initially stopped; it was started and the required checks
subsequently ran. No existing application database or production service was accessed.

- Full migration-created PostgreSQL suite: **214 passed**, three API E2E tests deselected
  and run separately (**3 passed**). No required tests skipped. Compose configuration and
  missing-input checks are included.
- Final focused PostgreSQL synchronization suite: **27 passed**, no skips. This includes
  three tests added after full-suite collection: credential-redacted load failures, exact
  checksums on truncated files, and idempotent accounting for provider `1 g` aliases.
- Coverage includes repeated imports, conversion precision/change, coexisting referenced
  `g`/`1 g` units, recipe/shopping references, nullable nutrients, stale marking and recovery,
  personal mapping collisions, full rollback after an injected mid-run failure, concurrent
  bulk/import operations, explicit starter seeding and strict JSON/ZIP loading.
- Frontend units: **77 passed** across 15 files. Authenticated Chromium: **9 passed**,
  including account isolation and incomplete-nutrient import/cooking/logging workflows.
- Production frontend build passes; OpenAPI is structurally unchanged. Frontend source
  and API types are unchanged, so inherited strict-TypeScript issues remain as recorded
  in Phase 8 rather than being reported as a clean typecheck.
- Production-image smoke builds the backend image, migrates and checks drift, runs packaged
  account/adoption commands, and invokes the Foundation CLI twice with reviewed count and
  exact checksum. It asserts one canonical record, unchanged second-run counts, nullable
  nutrients and success audits, without source mounts or a USDA key. The final rerun
  passed on image `sha256:8def248173b659409d961d03e31967ae2ecbd3692fd3080c70421bc47f0f490f`;
  its disposable image and database were removed afterward.
- Original worktree six-file status/SHA256 checks and `git diff --check` pass. The worktree
  audit still reports the unrelated pre-existing migration-drift worktree naming mismatch.

The initial broad run found no failures. Final review found that a provider-supplied `1 g`
alias could be counted as changed on every run despite stable data; comparison now applies
the same canonical-label policy as insertion, with the final PostgreSQL regression above.

## Remaining release work

Phase 10 still owns representative production-data upgrade/restore rehearsal, exact release
image identity, real HTTPS topology, live USDA/official-release validation, remote CI and
production cutover. No live full Foundation release was imported in this phase. The operator
must verify release provenance/completeness before allowing stale marking. This phase alone
does not authorize merging the combined feature into development or deploying it.
