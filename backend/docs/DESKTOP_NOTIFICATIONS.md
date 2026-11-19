# Desktop & phone notifications

People get a notification on their laptop or phone, even when Prowosma isn't open, when:

| What | Who | When |
|---|---|---|
| A task is assigned to them | the new assignee (not if they assigned it to themselves) | right away, from any screen (meeting assistant included) |
| A task of theirs is due within the hour | its assignees | once per due date |
| A task of theirs becomes overdue | its assignees | once per due date (tasks overdue by more than a day before this feature aren't re-announced) |
| Someone @mentions them in a task comment | the mentioned person (workspace members only) | right away |
| A message in a private channel or a direct message | everyone else in it | right away |
| They're added to a project team | the person added | right away |
| Attendance on: they haven't clocked in after their start (shift or call time) + grace | that person | once a day, up to 3 hours after |
| Attendance on: still clocked in after the shift end + "end-of-day reminder" minutes | that person | once a day, up to 3 hours after |

Each alert is sent once (recorded in the `alerts_sent` collection). Checks for due / overdue / attendance run every 2 minutes.

## Turning it on (people)

- A one-time banner offers it: **Turn on**. Or **Profile → Notifications → Turn on notifications**, where there's also **Send a test**.
- Each device is turned on separately. On iPhone, add Prowosma to the Home Screen first (Safari's rule).
- Notifications only work over **https** (or on `localhost` for local testing).

## Setting it up on the server (once)

The server needs a key pair (VAPID). Without it nothing is sent and the screens say "Notifications aren't set up on the server yet".

1. Generate a key pair (any machine with Node):
   ```bash
   npx web-push generate-vapid-keys
   ```
2. On the Hostinger VPS, add to the backend's environment (the same place as the other `...=` settings), then restart the backend:
   ```
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:<an address you read>
   ```
   Keep the private key secret. Don't change the keys later: everyone would have to turn notifications on again.
3. Check: `curl -s https://<your-domain>/api/push/vapid-public-key -H "Authorization: Bearer <token>"` returns the public key.

Local testing (Windows): set the same three variables in the terminal before `start-all`, open `http://localhost:5173`, and allow notifications.

Settings: `app.alerts.jobs-enabled` (default true) switches the due / overdue / attendance checks off; `app.alerts.sweep-ms` (default 120000) is how often they run.
