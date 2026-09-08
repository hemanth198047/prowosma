# ADR 0006: Web Push + installable PWA instead of a native mobile app

## Status
Accepted (native app remains a real future option, not ruled out permanently)

## Context
The backlog flagged "no native mobile app" and "no push-notification channel beyond in-app/email." A
true native app (or React Native/Capacitor wrapper) needs app store developer accounts, code signing,
and a separate release pipeline — none obtainable without real store accounts and credentials this
engagement doesn't have access to.

## Decision
Build real Web Push (VAPID) send capability on top of the PWA infrastructure that already existed
(`public/sw.js`'s push handler, `manifest.json`), rather than attempt native mobile development that
can't be completed or verified without real store accounts.

## Consequences
- **Positive**: genuinely working push notifications, installable home-screen experience, on both iOS
  and Android, without any app store dependency at all — verified end-to-end via a real subscribe/send/
  receive test path (`POST /api/push/test`).
- **Negative**: no App Store/Play Store discoverability; iOS PWA push has real platform limitations
  (reliability, background execution) that a true native app wouldn't have. This is a genuine trade-off
  stated plainly in `docs/MOBILE_OFFLINE.md`, not glossed over as equivalent to native.
- **Revisit when**: real app store developer accounts exist and native distribution/discoverability
  becomes a business priority — the backend push infrastructure built here (VAPID subscription
  management) would need FCM/APNs-specific additions for native, but isn't wasted work; the subscription
  data model and send-pipeline pattern carries over.
