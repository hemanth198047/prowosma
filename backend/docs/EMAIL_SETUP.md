# Email Setup — SMTP Providers & Bounce/Complaint Handling

Email is sent via standard SMTP (`spring.mail.*`, driven entirely by env vars — see
`backend/.env.example`). Switching providers is **always a config change, never a code change**.

## Provider settings

| Provider | `SMTP_HOST` | `SMTP_PORT` | Notes |
|---|---|---|---|
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` | Use SES **SMTP credentials**, not your AWS IAM key directly — generate them in the SES console under "SMTP Settings". |
| SendGrid | `smtp.sendgrid.net` | `587` | `SMTP_USERNAME=apikey` literally, `SMTP_PASSWORD=<your SendGrid API key>`. |
| Postmark | `smtp.postmarkapp.com` | `587` | `SMTP_USERNAME` and `SMTP_PASSWORD` are both your Postmark **Server API Token**. |
| Mailgun | `smtp.mailgun.org` | `587` | Use the SMTP credentials from Mailgun's "Sending" → domain settings, not your API key. |
| Gmail (dev/small scale only) | `smtp.gmail.com` | `587` | App Password required, see comments in `application.properties`. Not recommended for real production volume — no bounce/complaint webhook support, easy to hit Google's sending limits. |

Set `SMTP_FROM_EMAIL` to an address verified with your chosen provider (SES/SendGrid/Postmark/Mailgun
all require sender/domain verification before they'll relay mail — this is a provider-side step, not
something this app can do for you).

## Per-workspace overrides

Independent of the server-wide `SMTP_*` env vars above, each workspace can set its own SMTP
credentials via **Admin → Email Settings** in the app itself (`WorkspaceConfig.smtp*` fields) — useful
for a workspace that wants its own "From" domain rather than a shared one. This was already fully
implemented before this change; nothing about it needed fixing.

## Bounce & complaint handling

Previously entirely missing — now handled by `EmailWebhookController`, which receives bounce/complaint
events from your provider and adds hard-bounced or complained addresses to an internal suppression
list (`email_suppressions` collection). `EmailService` checks this list before every send and skips
addresses on it, protecting your sending domain's deliverability reputation.

Manage the list at **Admin → Email Settings** (`GET /api/admin/email-suppressions`,
`DELETE /api/admin/email-suppressions/{email}`).

### Wiring up each provider's webhook

Set `EMAIL_WEBHOOK_SECRET` first (required once these endpoints are reachable from the internet — all
three check it via `?secret=...` or an `X-Webhook-Secret` header).

**SES** (via SNS):
1. Create an SNS topic, subscribe it to your SES identity's bounce/complaint notifications
   (SES console → your verified identity → Notifications).
2. Add an HTTPS subscription to that topic: `https://your-domain.com/api/webhooks/email/ses?secret=...`
3. SNS sends a `SubscriptionConfirmation` message first — check the backend logs for the confirmation
   URL and visit it once (or fetch it programmatically) to complete the subscription.

**SendGrid**: Settings → Mail Settings → Event Webhook → HTTP POST URL:
`https://your-domain.com/api/webhooks/email/sendgrid?secret=...` — enable at least "Bounce" and
"Spam Report" events.

**Postmark**: Server → Webhooks → Add webhook → URL:
`https://your-domain.com/api/webhooks/email/postmark?secret=...` — enable "Bounce" and
"Spam Complaint" triggers.

**Mailgun**: does not natively bounce/complaint-webhook into this endpoint's exact payload shape
today — either use Mailgun's own suppression list (it maintains one server-side and simply refuses to
resend to a bounced address, achieving the same protective effect without this app's webhook), or add
a small payload-mapping branch to `EmailWebhookController` following the existing SendGrid/Postmark
pattern if you want events to also show up in this app's own suppression list.

## Deliverability metrics

`EmailService` records Micrometer counters, visible at `/actuator/prometheus`:

- `email.send.success{source=...}` / `email.send.failure{source=...}` — `source` is `"workspace
  settings"` or `"server default"`, so per-workspace SMTP problems are distinguishable from
  server-wide ones.
- `email.send.suppressed` — sends skipped because the address is suppressed.
- `email.suppression.added{reason=...,source=...}` — new suppressions being added, broken down by
  hard-bounce vs. complaint and by which provider reported it.

## What this still doesn't cover

- **SES/SNS message-signature verification** — the SES webhook is protected by the same shared-secret
  scheme as the others rather than SNS's own cryptographic message signing. See the class-level
  comment in `EmailWebhookController.java` for why, and how to add it if needed.
- **Soft bounces are intentionally not suppressed** (a full mailbox, a temporary provider outage) —
  only permanent/hard bounces and spam complaints add an address to the list, since suppressing a soft
  bounce could permanently block a perfectly valid address over a transient issue.
- **Deliverability monitoring beyond the Micrometer counters above** — a full reputation/inbox-placement
  monitoring product (e.g. Postmark's own dashboards, Google Postmaster Tools) is provider-side tooling,
  not something this app re-implements.
