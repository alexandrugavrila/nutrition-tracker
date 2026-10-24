# Historical server rehearsal evidence

Verified October 24, 2026 from the October 23 ordered rehearsal log on the
nutrition VM. This supplements the earlier phase evidence; it is not deployment.

- Source: development merge `b3376bd2790e0aaf67a10abb0e439aab941e57da`, plus
  the rehearsal startup-order/diagnostics correction in this change.
- Input: `main-20251123-144741.dump`, SHA-256
  `f6be0266f82b5ce6956a85f92dd40afe06618c53f1ef640f22a8796f3973f88c`.
- Log: `historical-rehearsal-ordered.log`, SHA-256
  `b53f11530b8dd1067219e2aaf9d48b42716aefa45f2481a9ab180f8008af4a06`.
  The log was copied to the owner's laptop backup folder; private data is not
  committed with this evidence.
- Backup restore comparison passed. Upgrade proceeded from `0f8b1c2d3e45`
  through adoption to `e75a1c3d648f`.
- Preserved 126 ingredients/nutrition rows, 123 units, 13 foods, 54 recipe links,
  5 plans, and 5 stored-food rows. The input has no daily logs.
- Applied only the previously approved stale Plan 4/item 0/ingredient 117
  override repair in the disposable copy. The original dump is unchanged.
- Wrong-revision and unapproved-report rejection checks passed.
- Chromium HTTPS smoke passed: secure cookies, login, reload, A/B/A isolation,
  and revoked access after logout.
- Disposable containers/network and locally built application image tags were
  removed by the runner after validation.

Local build image IDs (not published registry digests):

- Backend: `sha256:6102a34e6e6368dcf940e88e1eeed86ad84bb849bf11bbedcfd495430296359e`
- Frontend: `sha256:af601764ea969b929a8e66858e555e0d0408e85861e34ecdf9e7a8f00f69bfb6`

The earlier failures occurred before Playwright: nginx started before its upstream
service names resolved. Explicit dependencies in the generated rehearsal Compose
configuration fixed that startup sequence. Bounded failure logs now survive in
the outer log before cleanup.

This result does not validate final published images, permanent deployment,
network restrictions, or the selected private HTTP transport. Those gates remain
separate. Dependency changes made after this run also require their own checks.

Follow-up local validation: the non-E2E suite passed 242 tests with 8 skipped
without a PostgreSQL test target. The frontend lockfile updates only `undici`
7.30.0 to 7.30.1 and `zod` 4.3.6 to 4.6.7; the lockfile audit reports zero
vulnerabilities. Docker Desktop is unavailable locally, so this does not claim
a new local container or PostgreSQL rehearsal for the follow-up candidate.
Frontend validation passed 77 tests, the production build, and lint (20 existing
warnings, no errors). A clean `npm ci` installation completed before validation.
The original feature checkout's six modified files still match the preservation
checksums. The repository audit reports its existing unrelated worktree naming
mismatch; no worktree was renamed or removed to conceal it.
