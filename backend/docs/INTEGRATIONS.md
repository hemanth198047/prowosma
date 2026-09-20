# GitLab, Microsoft Teams and event integrations

Code lives in `com.prowosma.backend.integration` (logic, no Spring) with thin glue in `IntegrationService`,
`IntegrationController`, `InboundEventService` and `InboundEventController`.

## GitLab: issues and merge requests become tasks

Config keys: `token` (needs the `read_api` scope), `projectId` (numeric id or `group/project`),
`host` (optional; blank means gitlab.com).

`POST /api/integrations/{id}/sync/gitlab` imports the project's **open** issues and merge requests as tasks titled
`[GitLab] ...` in the integration's own workspace. Re-syncing never duplicates: each task carries an external
reference (`gitlab:<host>:<project>:<issue|merge-request>:<iid>`) that is looked up **within the workspace**.
Up to 5 pages of 100 per kind are read; the response says `"truncated": true` when that limit was hit.

Self-managed GitLab must use https, and by default must resolve only to public addresses (see "Outbound URL policy").
If yours is on a private network set `INTEGRATIONS_ALLOW_PRIVATE_HOSTS=true`.

## Microsoft Teams

Config key: `webhookUrl`, either a Workflows (Power Automate) webhook or a legacy Office 365 connector webhook.
Messages are sent as an Adaptive Card in a `message` envelope, which both accept.

* `POST /api/integrations/{id}/sync/teams` `{ "message": "..." }` sends a test message.
* `POST /api/integrations/teams/notify` `{ title, message, color }` mirrors the Slack notify endpoint.

The URL must be https on a Microsoft host (`*.webhook.office.com`, `outlook.office.com`, `*.logic.azure.com`,
`*.api.powerplatform.com`, ...). Sovereign clouds add theirs with `TEAMS_EXTRA_HOST_SUFFIXES`. Errors never contain the URL:
a Teams webhook URL carries its own secret.

## Event integrations: Datadog, Sentry, Jenkins

The tool posts to `POST /api/inbound-events/{datadog|sentry|jenkins}/{token}`. There is no login: the token identifies one
integration and therefore one workspace, and everything happens in that workspace only.

**Getting the URL.** Save the integration, reopen its dialog and click *Generate webhook URL*
(`POST /api/integrations/{id}/inbound-token`). The token is 256 random bits, shown **once**; only its SHA-256 hash is stored
(field `inboundTokenHash`, hidden from the API in both directions). Generating again invalidates the old URL. The hash survives
"Save & Connect" (`force-update` carries it over). An unknown, malformed, disabled or wrong-source token is always the same 404.

**Sentry** also signs each body (`Sentry-Hook-Signature`, HMAC-SHA256 of the raw body). Put the integration's Client Secret in the
`clientSecret` field and unsigned or wrongly signed events are refused (401).

**What an event does**

| Event | Task |
|---|---|
| A problem appears (no task for it yet) | a task is created (`[Datadog] ...`), with priority/severity, tags and a link |
| The same problem again, task still open | nothing (no duplicate) |
| The same problem again, task was closed | the task is reopened |
| The problem recovers / is resolved | the task is closed (`DONE`) |
| Anything else (a build only started, an issue assigned) | ignored |

A "problem" is identified by a stable reference: Datadog monitor id (`alert_id`; without one, the title with its `[Triggered ...]`
brackets removed), Sentry issue id (or `metric-<id>`), Jenkins job name. It is stored on the task as
`customFieldValues.externalRef` (`inbound:<source>:<id>`).

**Datadog payload.** Datadog lets you write the webhook payload, so use the template shown in the dialog (also below). The parser
also accepts `alert_title`, `event_msg`, `text`, `monitor_id`, `url` and similar aliases. The per-event `$ID` is deliberately
not used as an identity: it changes on every notification and would open a new task each time.

```json
{ "title": "$EVENT_TITLE", "body": "$TEXT_ONLY_MSG", "alert_id": "$ALERT_ID", "alert_transition": "$ALERT_TRANSITION",
  "alert_type": "$ALERT_TYPE", "priority": "$ALERT_PRIORITY", "link": "$LINK", "tags": "$TAGS" }
```

**Sentry** sends four shapes (issue webhooks, issue-alert events, metric alerts, the legacy project webhook); all are understood.
**Jenkins** uses the Notification plugin's JSON format; only `COMPLETED`/`FINALIZED` phases act (`FAILURE`, `UNSTABLE` open;
`SUCCESS` closes).

**Limits.** Bodies over 256 KB are refused (413). Two identical events arriving at the same instant can both create a task (there
is no lock); a later event will not add a third.

## Outbound URL policy

`OutboundUrlPolicy` + `OutboundHttp` guard every call to a user-supplied host: https only, no embedded credentials, no redirects
followed, 10 s connect / 20 s request timeouts, 5 MB response cap, and (for arbitrary hosts) every resolved address must be
public: no loopback, private, link-local (cloud metadata), carrier-grade NAT or unique-local ranges. The address is checked when
the request is made, so a host that re-resolves to an internal address afterwards (DNS rebinding) is not caught by it.

The Slack integration and the webhook `test`/`dispatch` endpoints still call user-supplied URLs without this policy.
