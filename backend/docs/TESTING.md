# Testing & Coverage

## What changed

Both the backend and frontend now have an **enforced coverage gate** — previously coverage was
measured nowhere, and no build step failed regardless of how little of the codebase tests actually
touched.

| | Backend | Frontend |
|---|---|---|
| Tool | JaCoCo | Vitest (`@vitest/coverage-v8`) |
| Run | `./gradlew check` | `npm run test:coverage` |
| Gate config | `build.gradle` (`jacocoTestCoverageVerification`) | `vite.config.js` (`test.coverage.thresholds`) |
| Current honest baseline | 25% (starting bar — see note below) | ~0.5% lines, measured across the whole `src/` tree |

**Both thresholds are set at or below what the codebase actually measures today, not at an
aspirational number.** A threshold set above current real coverage would just make every build fail
immediately, which teaches people to raise the number or delete the check rather than write tests —
the opposite of what a coverage gate is for. The frontend number in particular was verified by
actually running `npx vitest run --coverage` in this exact codebase (see `all: true` in
`vite.config.js` — without that flag, Vitest only reports coverage for files a test happens to import,
which would make the percentage look far higher than reality and the gate meaningless).

The backend's 25% figure could not be measured the same way in this environment (no reachable Maven
Central to run `./gradlew check` from here — see the network-access caveat repeated throughout this
engagement's other changes). Treat 25% as a reasoned estimate from the 16 pre-existing + 8 new test
classes against 226 source files, and **run `./gradlew jacocoTestReport` once locally to get the real
number** — adjust `BACKEND_MIN_COVERAGE` (or the `build.gradle` default) down if the real measured
number is lower, the same way the frontend number was corrected after actually measuring it.

## New tests added this change

Targeting the highest-value previously-untested surfaces — each one exercises a real security/business
rule, not a placeholder assertion:

**Backend** (`src/test/java/com/prowosma/backend/`):
- `billing/PlanGuardFilterTest` — FREE-plan feature gating actually returns 402, GET requests are never blocked
- `ratelimit/RateLimitFilterTest` — the 429 threshold, per-user isolation, response headers, actuator exemption
- `email/EmailSuppressionTest` — suppression add/skip-on-send/remove, normalization/deduplication
- `email/EmailWebhookControllerTest` — SendGrid + Postmark bounce/complaint ingestion, non-bounce events correctly ignored, shared-secret auth (both query param and header), wrong/missing secret rejected
- `storage/FileStorageServiceTest` — local store/delete, executable-extension denylist, virus-scanner rejection actually prevents storage, scanner-error fail-open behavior

**Frontend** (`src/test/`):
- `config/auth0.test.js` — the exact dev-tenant-fallback / `isAuth0Configured` logic fixed in the SAML/Auth0 configurability change, including the "only one of two vars set" edge case
- `pages/Login.auth0Gating.test.jsx` — regression test proving Login.jsx actually hides Auth0-backed buttons when not configured, and shows them when it is

All frontend tests were run for real in this environment (`npx vitest run` — 4 files, 18 tests, all
passing) since the npm registry was reachable. Backend tests could not be executed the same way (no
reachable Maven Central / MongoDB / Docker here) — see each new test file's own header comment; they
follow the exact same `ProwosmaTestBase` / MockMvc patterns as the pre-existing, presumably-working
test suite, so risk is low but this is "verified by careful reading," not "verified by running," same
caveat as the rest of this engagement's backend changes.

## Ratchet plan

1. Run the real baseline locally: `./gradlew jacocoTestReport` (backend, open
   `build/reports/jacoco/test/html/index.html`) and `npm run test:coverage` (frontend).
2. Set both thresholds to the real measured number (not a round number chosen for looks).
3. Each PR that adds meaningful tests without regressing coverage: bump the threshold up to match the
   new measured floor. Small, frequent bumps beat one large aspirational jump that immediately fails.
4. Prioritize coverage for: security filters (RoleGuardFilter, PlanGuardFilter, RateLimitFilter — the
   pattern established by this change), anything touching money (BillingService, StripeWebhookController),
   and anything touching another person's data (workspace isolation, DLP).

## Known gaps not addressed by this change

- **No end-to-end (Playwright/Cypress) suite** — unit/integration tests only, on both sides. A true E2E
  suite exercising frontend + backend together is tracked as a separate item in the enterprise-readiness
  backlog (Testing & QA).
- **S3 file-storage path is untested** — `FileStorageServiceTest` covers the local provider only; the S3
  path needs a real or emulated S3 endpoint (MinIO in CI) to test meaningfully rather than mocking the
  AWS SDK client itself.
- **A couple of files fail to instrument for coverage** (`PARSE_ERROR` in the Vitest coverage run,
  non-fatal — the report and gate still complete successfully) — worth investigating if precise
  per-file coverage numbers matter for a specific file, but doesn't affect the overall gate today.
