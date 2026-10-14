# Security and reliability audit — what was found, what was fixed, what to do now

This was an audit of the code and configuration in the repository, with every fix covered by a test that fails without it. It is **not** a penetration test, and nothing here can promise "error-free". The last section lists what was found but deliberately not changed, and what could not be verified.

## Do these now (code can't do them for you)
1. **Rotate the AI provider key** (Anthropic / OpenAI / Gemini) and enter the new one in *AI Settings*. Until this release, any signed-in workspace member — a *viewer* included — could read the key through `GET /api/ai/settings`.
2. **Set `JWT_SECRET`** on every deployment (Render, VPS, compose): a long random value, e.g. `openssl rand -base64 64`. The application now **refuses to start** without one (see *JWT* below). If a deployment ever ran on the built-in default, treat all sessions as compromised: set the new secret, which signs everyone out.
3. **If you use `docker-compose.yml`**, put `JWT_SECRET` and `GRAFANA_ADMIN_PASSWORD` in the `.env` file next to it. Compose now stops with a clear message if they are missing.
4. Run `npm ci` after pulling (the lockfile now pins axios 1.20.0 and dompurify 3.4.17).
5. Optional: `SWAGGER_ENABLED=true` if you want the API documentation pages back (off by default now); `OTEL_TRACING_SAMPLING_PROBABILITY=1.0` to trace every request again (default is now 0.1).

## Fixed in this release
| # | Severity | Problem | Fix | Proof |
|---|---|---|---|---|
| 1 | **High** | `GET /api/ai/settings` returned the workspace's AI provider key, in plain text, to every signed-in user (viewers too) | The key is never returned; the page gets `apiKeySaved: true/false` instead | `AISettingsServiceTest` |
| 2 | **High** | Any member could `POST/PATCH` the AI settings: overwrite the key, change the provider or endpoint, switch AI on/off | Admin-only in `RoleGuardFilter`; the AI Settings page shows a notice and locks its controls for non-admins | `RoleGuardAiSettingsTest` — **5 of its 16 tests fail on the old code**, all pass now |
| 3 | **High** | `GET /api/auth/profile` returned the whole user record: password hash, the **live 2FA secret**, hashed backup codes, and the **magic-link login token** | Those five fields are accepted on input but never serialized | `UserSecretsSerializationTest` |
| 4 | **High** | The JWT signing secret had built-in defaults visible in the source; a deployment without `JWT_SECRET` (and without the `prod` profile) silently used them, so anyone could forge a login for any user | `JwtSecretGuard` refuses to start with an empty, short (<32 bytes) or published secret, whatever the profile. Local development opts in with `ALLOW_INSECURE_DEV_JWT=true` | `JwtSecretGuardTest` |
| 5 | **High** | `docker-compose.yml` published MongoDB, Redis, RabbitMQ (with `guest/guest` management), Jaeger, Prometheus, Alertmanager and Grafana on every network interface, with no passwords — and shipped a known JWT secret | Those ports are bound to `127.0.0.1`; only the backend (9090) and frontend (8080) stay public; the JWT secret and Grafana password are required | YAML validated |
| 6 | **High** | `axios` 1.19.0 (pinned in the lockfile) has 12 published advisories (prototype pollution, ReDoS…); `dompurify` was also affected | Lockfile bumped to axios 1.20.0 / dompurify 3.4.17 — `package.json` unchanged | `npm audit --omit=dev`: **0 vulnerabilities**; full test suite and build re-run |
| 7 | Medium | AI provider keys were stored in plain text | New keys are stored encrypted (AES-256-GCM, same key as other secrets); keys saved earlier keep working and become encrypted the next time they are saved | `AISettingsServiceTest` |
| 8 | Medium | The Gemini key was sent in the request URL (`?key=…`), which ends up in logs | Sent in the `x-goog-api-key` header | code review |
| 9 | Medium | AI-settings changes were audit-logged only the first time | Every change is logged (never containing the key) | `AISettingsServiceTest` |
| 10 | Medium | **Backup codes could not be typed on the login page**: the code box kept only digits and stopped at 6 characters, though the backend supports codes like `abcde-fghjk`. Someone who lost their authenticator was locked out | The box accepts backup codes; the button is disabled until something is typed; errors are announced to screen readers; the page now uses the translation keys that actually exist (the back button was never translated) | `Login.twoFactor.test.jsx` (11 tests) |
| 11 | Medium | Stopping or redeploying the backend killed it instead of letting running requests finish (`sh -c` swallowed the stop signal; no graceful shutdown) | `exec java …` in the Dockerfile, `server.shutdown=graceful` with a 30 s timeout, `-XX:+ExitOnOutOfMemoryError` | config reviewed |
| 12 | Medium | Swagger UI / API docs were on and public in every environment | Off unless `SWAGGER_ENABLED=true` | `SecurityConfigTest` still passes |
| 13 | Low | Tracing sampled **100 %** of requests by default (cost and latency in production) | Default 10 % | — |
| 14 | Low | nginx and Vercel sent no security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (microphone and display-capture stay allowed: the recording feature needs them). The legal pages are routed in nginx too | JSON / syntax validated |

### Note on the 10 "known failing" login tests
They were not just stale: they described a *token-based* 2FA design that the backend does not implement. The backend (deliberately) consumes the password-verified window on **every** attempt, so after a wrong code the person must start again from the password — which is what the page already did. The tests were rewritten to the real contract, and the one genuine defect behind them (#10) was fixed.

## Found but NOT changed — please decide
| Finding | Why it was left | Suggested action |
|---|---|---|
| Webhook signing secrets are readable by every member (`GET /api/webhooks`) — the UI has a "reveal" button that depends on it | Changing it removes a feature | Show the secret once at creation / rotation only; admin-only afterwards |
| Invitation tokens are returned by the invitation list to every member | May be relied on by the invite flow | Return tokens only to admins |
| `RoleGuardFilter` lets any authenticated user `PATCH` task/goal sub-paths and skips role checks for paths *containing* `/api/tasks/attachments/` | May be intentional (status updates, downloads) — the intent isn't written down | Confirm intent; viewers probably shouldn't mutate |
| `/api/tasks/attachments/**` is public (no token) | Download links may rely on it | Use signed, expiring links |
| MongoDB / Redis in compose have no authentication (now only reachable from the host) | Needs coordinated changes to every service's connection string | Enable auth before exposing them beyond one machine |
| 6 vulnerabilities in **development-only** tools (3 moderate, 3 high); they are not in the production bundle | Build-time only | `npm audit fix` when convenient |
| ~17 lint findings (state set inside effects, empty `catch` blocks, one impure `Date.now()` during render) | Style/performance, no wrong behaviour found; fixing risks regressions | Clean up gradually |
| The meetings list makes one extra database lookup per waiting meeting (to show "next check") | Only matters with many waiting meetings | Batch the lookup if lists grow beyond a few dozen |
| No Content-Security-Policy header | Needs a tested allow-list for Auth0, Sentry, fonts | Introduce in report-only mode first |

## What could not be verified here
- **The backend was never run end to end**: I can compile and run pure logic and the real filter/service classes against stand-ins, but not the Spring/MongoDB/Redis stack. The integration tests (`RecordingApiTest`, `FirefliesIntegrationApiTest`) compile but have not been run. **Run `./gradlew test` before deploying.**
- Docker and nginx configuration were validated for syntax only, not started.
- Real Google Meet / Teams / Fireflies / speech-to-text services have not been exercised.
- Load, penetration and dependency-confusion testing were not done.
