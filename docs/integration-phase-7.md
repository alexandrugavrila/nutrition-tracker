# Phase 7 — Browser account isolation

The application scopes persisted workflows, in-memory providers, and API requests to the
confirmed immutable account ID. This phase follows commit `a776f577` on the stabilization
branch and does not deploy the combined feature.

## Implemented behavior

- Session-storage keys are versioned as `nutrition:v2:<user-id>:<workflow-key>`. All
  planning, shopping, cooking, ingredient and food draft consumers use the same scoped
  hooks. A returning account can restore its own persisted values. Anonymous components
  do not read or write application workflow storage.
- Legacy unscoped application keys are deleted without guessing an owner. Unrelated
  storage remains intact. Invalid JSON, incompatible workflow shapes and unavailable
  storage fall back to defaults/in-memory state.
- Account-dependent providers and the protected application subtree are keyed by account
  scope generation. Identity checks suspend and invalidate the outgoing scope before
  another account can render. Transient state and fetched caches are discarded.
- Focus, visibility, page restoration, cross-tab notifications, 401 responses and account
  mismatches recheck identity. Out-of-order identity responses are ignored. An unavailable
  identity check fails closed. BroadcastChannel has a storage-event fallback and carries
  no user data or session tokens.
- Every protected client and direct-fetch call uses the mounted account scope. Requests
  abort when that scope ends; delayed bodies and later steps of old async operations are
  rejected. The parsed API client preserves abort failures instead of treating them as
  empty successful responses. Storage setters/reducer dispatches stop persisting too.
- An optional `X-Account-ID` request expectation prevents cookie-switch races. The backend
  compares it to the cookie-authenticated user before route execution, returning 409 and
  `X-Account-Mismatch: 1` on mismatch. The check also protects logout. The header is not
  authentication and cannot grant access. Existing non-browser clients may omit it.

The small backend check is necessary: browser cancellation or an identity preflight alone
cannot prevent another tab changing the cookie between a check and a write. This keeps an
A draft from becoming B's new object even when all referenced IDs would otherwise be valid.
No schema migration, account adoption, provider refresh or historical nutrition change is
part of this phase. The OpenAPI document is structurally unchanged.

## Validation

The isolated PostgreSQL runner uses migration-created schemas and disposable accounts.
The browser-isolation pair is separate from CRUD accounts so the expanded suite exercises
real login limits without exhausting a shared test account's budget. The first integrated
run passed all three new isolation scenarios but hit that shared-account limit in a later
existing workflow; the fixture separation corrects the test setup without weakening limits.

Coverage includes:

- A -> logout -> B -> logout -> A, account-specific planning values and reloads.
- Every persisted workflow key with representative values; legacy cleanup; invalid JSON,
  invalid plan structures and denied browser storage; stale state/reducer callbacks.
- Deferred network responses and body parsing, invalidated follow-up writes, expired
  sessions, account-mismatch responses and out-of-order identity checks.
- Two browser tabs sharing cookies, logout/login notifications, focus refresh, and a cookie
  change deliberately made without a browser notification. A's draft is rejected before
  B's database is changed; protected forms remount under the confirmed account.
- Existing authenticated ingredient/USDA/copy/recipe/planning/shopping/cooking/log workflows.

Validation on 2026-10-14:

- Migration-created PostgreSQL suite: **185 passed**, no skipped tests. The three
  API E2E tests were deselected here and run separately: **3 passed**.
- Frontend unit suite: **70 passed** across 15 files, including delayed-response and
  parsed-body cancellation regressions.
- Chromium: **8 passed**, including all three account-isolation scenarios and the five
  existing authenticated workflows.
- Production frontend build passes. OpenAPI is structurally unchanged; generated types
  remain synchronized. No new migration is needed.
- TypeScript comparison: **466 baseline / 466 current diagnostics**, no added counts by
  file and diagnostic code. Existing MUI/type errors remain; this is not a clean typecheck.
- Worktree environment validation and `git diff --check` pass. The repository audit still
  reports the unrelated existing migration-drift worktree naming mismatch.
- Original feature worktree six-file status and saved SHA256 hashes remain unchanged.

The frontend unit suite also checks the parsed client's cancellation path. It caught a
cross-realm DOMException being swallowed as an empty body; parsing now ignores only JSON
syntax failures and propagates cancellation. A lazy-page unit assertion uses an explicit
five-second wait to tolerate concurrent test load. The inventory refetch fixture now
returns a fresh Response clone per request and checks that the refetched inventory is
preserved; previously it reused a consumed response whose error was silently swallowed.

## Operational notes and remaining gates

The application retains account-scoped session drafts for same-account return; it does not
promise protection from someone who can inspect the browser's developer tools or profile.
Legacy unscoped drafts are intentionally discarded. Transient dialogs, selections and
unpersisted fields reset when identity is rechecked. This is not a cross-device draft sync
feature. Keep future protected callers inside the account scope and use its request client.

No existing application database was accessed. The original dirty feature worktree remains
untouched. Remote CI and production HTTPS/proxy validation remain unverified. Inherited
strict TypeScript diagnostics remain a release limitation. Phases 8 (nutrient uncertainty),
9 (reference-safe synchronization), and 10 (deployment and restore rehearsal) remain.
