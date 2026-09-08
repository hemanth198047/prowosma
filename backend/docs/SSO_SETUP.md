# SSO Setup — SAML & Auth0

Every value in this guide is set through environment variables. **None of
these steps require a code change or a rebuild** — for the backend,
restarting the process picks up new env vars; for the frontend's Auth0
values only (which Vite bakes into the JS at build time), a rebuild of the
static bundle is required, but never a source edit.

There are two independent SSO paths in Prowosma. You can enable either,
both, or neither:

| Path | Who it's for | Configured by |
|---|---|---|
| **Auth0** | Any customer wanting hosted social + enterprise login without running their own IdP | One tenant, shared across the whole app |
| **SAML 2.0** | Enterprise customers with their own IdP (Okta, Azure AD, Google Workspace, or any SAML-compliant IdP) | Per-provider metadata URL, add as many as needed |

---

## 1. Auth0

1. Create (or reuse) an Auth0 tenant at <https://manage.auth0.com>.
2. Create an application of type **Single Page Application**.
3. Under **Settings**, copy the **Domain** and **Client ID**.
4. Under **Allowed Callback URLs**, add: `https://<your-frontend-host>/auth0/callback`
   (and `http://localhost:5173/auth0/callback` for local dev).
5. Under **Allowed Logout URLs** and **Allowed Web Origins**, add your frontend origin.
6. Set the following **at frontend build time** (bakes into the JS bundle, see `frontend/.env.example`):

   ```bash
   VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
   VITE_AUTH0_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxx
   ```

   Via Docker: `docker compose build --build-arg VITE_AUTH0_DOMAIN=... --build-arg VITE_AUTH0_CLIENT_ID=...`
   or simply export `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` in your shell before `docker compose up --build` —
   `docker-compose.yml` already threads both into the frontend build args and the backend env.

7. Set the **same** values for the backend (verifies the ID token server-side — see `Auth0TokenVerifier`):

   ```bash
   AUTH0_DOMAIN=your-tenant.us.auth0.com
   AUTH0_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxx
   ```

8. Restart the backend and rebuild the frontend. Until you do steps 6–7, the app runs against a shared
   development tenant and hides all Auth0-backed login buttons in production builds
   (see `frontend/src/config/auth0.js`, `isAuth0Configured`) — it will never silently authenticate
   real users against the wrong tenant.

Social connections (Google / Microsoft / GitHub buttons on the login page) are enabled per-connection
in the Auth0 dashboard under **Authentication → Social** — no app-side config needed once Auth0 itself
is configured.

---

## 2. SAML 2.0 (Okta / Azure AD / Google Workspace / custom)

Set one environment variable per IdP you want to enable — leave the rest blank. Each is picked up by
`SamlConfig` at backend startup with **no code change**.

| Env var | IdP |
|---|---|
| `SAML_OKTA_METADATA_URL` | Okta |
| `SAML_AZURE_METADATA_URL` | Azure AD / Entra ID |
| `SAML_GOOGLE_METADATA_URL` | Google Workspace |
| `SAML_CUSTOM_METADATA_URL` + `SAML_CUSTOM_REG_ID` | Any other SAML 2.0 IdP |

### Steps (same shape for every IdP)

1. In your IdP's admin console, create a new SAML application / integration.
2. Give the IdP these two Service-Provider values (also returned live by
   `GET /api/sso/metadata/{registrationId}` once the app is running):
   - **ACS (Assertion Consumer Service) URL:** `https://<your-backend-host>/login/saml2/sso/{registrationId}`
   - **SP Entity ID / Metadata URL:** `https://<your-backend-host>/saml2/service-provider-metadata/{registrationId}`

   `{registrationId}` is `okta`, `azure`, `google`, or whatever you set `SAML_CUSTOM_REG_ID` to.
3. Map at least these SAML attributes in the IdP's assertion configuration:
   - `email` (falls back to the SAML NameID if absent)
   - `displayName` or `cn` (falls back to email if absent)
4. Copy the IdP's **metadata URL** (every major IdP publishes one — e.g. Okta's is
   `https://<your-org>.okta.com/app/<app-id>/sso/saml/metadata`) into the matching env var above.
5. Restart the backend. Check the startup log for:
   ```
   [SamlConfig] SAML SSO active for N provider(s): [okta, ...]
   ```
   or, if something's wrong, a `WARN` line naming exactly which IdP failed to load and why.
6. Confirm it's live: `GET /api/sso/providers` returns the new provider, and it now shows as a login
   button on the frontend's login page automatically — no frontend change needed, that list is fetched
   at runtime from the backend.

### Notes

- Leaving a value blank, or leaving in placeholder text like `TENANT`/`xxxx`/`example`, causes that
  provider to be silently skipped (not a crash) — see `SamlConfig.tryRegister`.
- A metadata URL that's set but temporarily unreachable at startup logs a `WARN` and skips that
  provider for this run only; fix connectivity and restart to pick it up.
- Multiple SAML IdPs can be active simultaneously (e.g. Okta for one customer, Azure AD for another) —
  each gets its own login button and its own ACS URL.
