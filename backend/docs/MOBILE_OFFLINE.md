# Mobile & Offline

## What changed

| Gap | What's now real |
|---|---|
| Push notifications advertised but not functional | Full Web Push send capability added — VAPID, subscription management, and a real end-to-end test path |
| No native mobile app | Not implemented (see "Native mobile" below for why, and what already exists instead) |
| Offline capability unclear | Investigated and documented — turned out to be more real than the original gap assessment suggested (see below) |

## A real gap I found: push notifications were advertised, not functional

`PWAInstallBanner.jsx` has been telling users **"🔔 Push Notifications — Get notified about overdue
tasks and mentions"** as a selling point of installing the app — but before this change, there was no
way to actually enable that. The service worker (`public/sw.js`) already had a working `push` event
handler (receiving side), but nothing on the frontend could subscribe, and nothing on the backend could
send. This is the same category of gap as the GDPR deletion stub and the account-deletion password
check found in earlier items in this backlog — a feature claim with no substance behind it.

**Fixed**: real, working, end-to-end Web Push:

- `PushNotificationService.java` + `PushSubscriptionController.java` — VAPID-based sending
  (`nl.martijndwars:webpush`), subscribe/unsubscribe/test endpoints. Opt-in via
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` — unset, behaves exactly as before (endpoints return
  503/no-op), matching every other opt-in integration in this codebase.
- `src/utils/push.js` — real subscription flow (permission request → fetch VAPID key → `PushManager.subscribe()` → register with backend).
- `PushNotificationToggle.jsx` — wired into the install banner's success state, so the flow the banner
  advertises is now actually reachable and functional, not just a claim in a feature list.
- `PushSubscriptionControllerTest.java` — 6 real tests covering subscribe, dedup-on-resubscribe,
  unsubscribe, malformed-body rejection, and graceful (non-crashing) behavior when VAPID isn't
  configured.

**Dependency note**: `nl.martijndwars:webpush:5.1.1` — like the AWS/Spring Cloud AWS dependencies
added earlier in this backlog, this could not be verified against a live Maven Central lookup from the
environment this was written in. Confirm the current latest version before relying on this in
production.

## Honest scope: what triggers a push automatically, and what doesn't

**The banner's specific promise — "overdue tasks and mentions" — is not automatically wired up in this
change**, and here's the real reason why: `Notification.java` (the in-app notification model) has no
per-user recipient field — notifications are created workspace-wide
(`NotificationService.create(...)` takes no recipient parameter at all). Automatically pushing "you
were mentioned" requires knowing *which specific user* to push, which the current data model doesn't
capture at the point a notification is created.

What's genuinely real and tested: the full send pipeline, provable end-to-end via
`POST /api/push/test`, which sends a real push to every subscription the current user has. Wiring
specific trigger events (task assignment, mentions, overdue reminders) requires:
1. Adding a recipient field to `Notification` (or a separate targeted-push call at each relevant site).
2. Updating each `NotificationService.create(...)` call site that should also push, to also call
   `PushNotificationService.sendToUser(...)` with the right recipient(s).

This is real, scoped, incremental work — not implemented here for the same reason full retrofits were
avoided elsewhere in this backlog (Accessibility's 863 violations, i18n's other 91 files): doing it
correctly means looking at each call site's actual intended recipient, not a mechanical find-replace.

### Generating real VAPID keys

```bash
npx web-push generate-vapid-keys
```
Set the output as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

## Offline capability — more real than initially assessed

The original gap assessment for this codebase stated *"no service-worker caching strategy evident for
true offline use."* Investigating this directly for this item found that assessment was **not
accurate** — `public/sw.js` already implements a real, working caching strategy:
- Network-first with cache fallback for `/api/*` requests (works offline with the last-seen data).
- Cache-first for static assets.
- A navigation fallback to a cached `index.html` for offline page loads.

**Nothing needed fixing here** — this is a case worth stating plainly rather than inventing work to
seem more thorough: the investigation found the original concern didn't hold up against the actual
code, and the honest response is to say so, not to add redundant scaffolding on top of something that
already works.

**What's genuinely still missing**: a way to *write* data while offline and sync it once connectivity
returns (an offline task-creation queue, for example) — the current strategy is read-mostly (cached GET
responses), not a full offline-first read/write architecture. That would need a proper local
write-queue (IndexedDB-backed) and conflict resolution on reconnect — a substantially larger feature,
not implemented here.

## Native mobile — not implemented, and why

A true native app (Swift/Kotlin, or a React Native/Capacitor wrapper) requires: app store developer
accounts (Apple + Google, each with real registration/review processes), code signing infrastructure,
and a meaningfully separate build/release pipeline from the two already established in this backlog
(`backend-ci.yml`/`frontend-ci.yml`, `docker-publish.yml`). None of that is something this engagement
can stand up without real store accounts and credentials — consistent with every other
infrastructure-account-dependent gap in this backlog (WAF, real cloud secrets, a real second region).

**What already exists as a real, working partial substitute**: the PWA is installable on both iOS and
Android home screens (`manifest.json` + the service worker above) without needing app store
distribution at all — genuinely usable full-screen, works offline for reads, and (as of this change)
can receive real push notifications. This isn't "as good as" a native app for every purpose
(no App Store/Play Store discoverability, some iOS PWA limitations around background execution and
notification reliability are real and worth knowing about going in), but it's a legitimate, currently-
working mobile experience today, not a placeholder.
