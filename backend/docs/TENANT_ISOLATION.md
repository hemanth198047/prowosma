# Tenant isolation

How the backend keeps one workspace's data away from another, and what to do when you change it.

## The tenant guard (`config/tenant/`)

Many services fetch a record by id (`repository.findById(id)`) and act on it without checking that it
belongs to the caller's workspace. Instead of patching every call site, every Spring Data repository of a
workspace-owned entity is wrapped once, at startup, by `TenantGuardBeanPostProcessor`.

While an **authenticated `/api/**` request** is running, the wrapper enforces:

| Call | Another workspace's record |
|---|---|
| `findById`, `existsById`, `findAllById` | reported as not found |
| `deleteById`, `deleteAllById`, `delete` | left untouched (like deleting an id that does not exist) |
| `save`, `saveAll` | refused if it would **overwrite** it (`TenantViolationException`, answered as 404) |

Everything else passes straight through: derived queries such as `findByOrganizationId` (callers already
scope those), schedulers, `@Async` work, WebSocket frames, and tests' own setup code (no HTTP request).

* The caller's workspace is `WorkspaceContext` (the verified `X-Workspace-Id`, or the API key's workspace).
  With **no** workspace selected, only records that have no owner at all (created before multi-tenancy) are visible.
* Both tenant field names are recognised: `organizationId` and `workspaceId`.
* Exempt entities: `User` (a global identity) and `Workspace` (it *is* the tenant); they are authorised by membership checks.
* Exempt paths (`TenantGuardPolicy`): `/api/auth/`, `/api/sso/`, `/api/invitations/{accept,info,validate}`,
  `/api/webhooks/stripe`, `/api/webhooks/email/`, `/api/health`. These establish identity or are
  system-to-system callbacks.

### Switching it: `app.tenant-guard.mode` / `TENANT_GUARD_MODE`

* `enforce` (default) blocks cross-workspace access.
* `log` reports each one as a WARN (`[TenantGuard:LOG] …`) and lets it through. Use it to trial the guard
  against real traffic and find any flow that legitimately crosses workspaces before enforcing.
* `off` does not install the guard.

An unrecognised value means `enforce`; a typo never disables protection.

### Check it is installed

Startup logs one line per guarded repository: `[TenantGuard] ENFORCE guarding Task (N repositories so far)`.
Expect a few dozen. If you instead see `COULD NOT guard repository bean …`, that repository's by-id access is
unprotected. `TenantIsolationTest.guardIsInstalled` fails in the same situation.

### What it does *not* cover

* A write whose request body carries its own `organizationId` (services must set it from the workspace context).
* `MongoTemplate` access, and unscoped `findAll()`-style queries. Scope those where they are written.
* An already-open WebSocket is not re-validated when its token later expires.

## Webhooks

Only the two inbound provider callbacks are public: `POST /api/webhooks/stripe` (verifies `Stripe-Signature`) and
`POST /api/webhooks/email/{ses,sendgrid,postmark}` (shared secret). The outbound-webhook **management** API under
`/api/webhooks` requires a login, a workspace, and normal role rules (Viewers are read-only), and every by-id
endpoint uses `WebhookRepository.findByIdAndOrganizationId`.

## WebSocket (`StompAuthChannelInterceptor`, `StompAccessPolicy`)

* CONNECT needs a valid JWT (`Authorization: Bearer …` STOMP header; both frontend hooks send it).
* SUBSCRIBE / SEND are allowed only for `/topic/workspace/{id}`, `/topic/doc/{id}` and
  `/app/doc/{id}/{join,leave,edit,cursor}`, and only for members of that workspace (or the document's workspace).
* Ids must match `[A-Za-z0-9_-]{1,64}`. This is what blocks `/topic/doc/*` and `/topic/**`: the simple broker
  matches subscriptions with an Ant-style matcher, so a wildcard would otherwise receive every document's traffic.
* **Anything not listed is denied.** To add a destination, add it to `StompAccessPolicy` (and its test) on purpose.
