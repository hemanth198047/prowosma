# Meeting Assistant

Status: **Phase 2 — transcripts in, nothing generated yet.** Meetings can be registered, transcripts can be uploaded/pasted
(any platform) or imported automatically from Google Meet. Summaries, minutes, action extraction and task creation come in
later phases. The assistant **cannot join meetings live** (see "Why no live joining").

## What works today
| Capability | Google Meet | Microsoft Teams |
|---|---|---|
| Register a meeting by link (validated, duplicate-safe, recurring-aware) | ✅ | ✅ |
| Upload or paste a transcript (`.vtt`, `.srt`, plain text; up to 5 MB) | ✅ | ✅ |
| Automatic transcript import after the meeting | ✅ implemented, **not yet verified against a real meeting** | ❌ not yet |
| Live joining / live audio | ❌ | ❌ |
| Speaker identity | Google's display name only | Only what the file states |

## Why no live joining
Google's live-audio API (Meet Media API) is a limited developer preview that requires every participant to be enrolled;
Microsoft Teams live audio requires a separate Windows-hosted media bot service. Neither fits "free official APIs only", so the
UI never offers a "send assistant into the call" action unless a platform truly reports that capability.

## Administrator setup — Google Meet automatic import (optional)
Without this, everything still works with manual upload/paste.

1. **Google Cloud project**: create/choose one and enable the **Google Meet REST API**.
2. **OAuth consent screen**: add the scopes `openid`, `email` and `https://www.googleapis.com/auth/meetings.space.readonly`.
   Google classifies `meetings.space.readonly` as a *sensitive* scope; apps used outside your own Google Workspace
   organization need Google's OAuth verification — check Google's current rules for your situation.
3. **OAuth client** (type: Web application). Authorized redirect URI:
   `<FRONTEND_URL>/integrations/meeting-platforms/google-callback` (e.g. `https://app.example.com/integrations/meeting-platforms/google-callback`).
4. **Server configuration** (see `.env.example`):
   - `GOOGLE_MEET_OAUTH_CLIENT_ID`, `GOOGLE_MEET_OAUTH_CLIENT_SECRET`
   - `GOOGLE_MEET_OAUTH_REDIRECT_URI` (optional; defaults to `FRONTEND_URL` + the path above)
   - `ENCRYPTION_KEY` — **required**. Saved Google sign-ins are only stored encrypted; with no key the app refuses to save them.
5. Restart the backend, then in the app: **Integrations → Communication → Google Meet** → enable the platform →
   **Connect my Google account** → **Test connection**.

Why each person connects their own account: Google's Meet REST API supports user sign-in only. An import runs with the access of
the person who registered the meeting, so it can read only meetings that account can already access. There is no
organization-wide blanket access.

## Using it (everyone)
1. **Meeting Assistant → paste the link →** *Register meeting*. (Optional: choose a project or leave "Detect from discussion"; schedule a time.)
2. **Google Meet + connected account:** Prowosma checks for the transcript after the meeting ends. It only exists if someone turned on
   **transcription during the meeting**. Use **Check Google Meet now** to look immediately.
3. **Anything else, or if the import fails:** open the meeting → **Add a transcript** → choose a file or paste the text.
4. Open the **Transcript** tab to read it. "Unknown speaker" means the source didn't say who spoke — nothing is guessed.
5. Who can see a meeting: you, people you share it with, and admins (or the whole workspace if your admin chose that). Attending
   a meeting does not give access to its results.

## How the Google import works
- A background job per meeting polls Google (every few minutes) until the meeting has ended and Google has finalized the transcript.
  It is safe on multiple instances (atomic claim + lease) and recovers after a restart.
- Which meeting record? The earliest not-yet-imported record for that link near the registration/scheduled time — so a recurring
  link's evening session never re-imports the morning meeting.
- Partial capture: if the transcript covers under 90 % of the meeting (or starts late, or has gaps) the meeting is marked **partial**
  with the reason. Uploaded transcripts are labeled "completeness can't be verified".
- Nothing is truncated: a transcript over 50,000 lines is refused with a message, never silently cut. Long single lines are split.
- Failure → the meeting shows **Failed** with what happened and what to do (reconnect Google, ask the organizer, or upload the transcript).
  Temporary errors are retried; after 8 consecutive errors, or when no transcript appears within 24 h, the meeting fails with a message.

## Operations
- **Jobs** live in MongoDB (`meeting_jobs`) — no extra service. The poller runs inside the backend
  (`app.meeting-assistant.job-poll-ms`, default 15 000; disable with `app.meeting-assistant.jobs-enabled=false`).
  On a host that sleeps when idle (e.g. a free Render web service) imports only progress while the service is awake — use an always-on instance for reliable imports.
- **Retention**: transcript text is removed after the organization's configured days (default 90), checked every 6 hours. The meeting record and history stay, with a note.
- **Collections**: `meeting_sessions`, `meeting_integrations`, `meeting_assistant_settings`, `transcript_segments`, `meeting_jobs`,
  `meeting_user_connections` (encrypted tokens), `meeting_oauth_states` (self-expiring), `meeting_audit_events`. Indexes are created at startup; no data migration is needed.
- **Audit**: user actions go to the hash-chained activity log; background actions go to `meeting_audit_events` (needed because background work has no request context). Neither stores transcript text, tokens or meeting passcodes.
- **Security**: outbound calls go only to `meet.googleapis.com` / `oauth2.googleapis.com` over https (hard allow-list, no redirects); sign-in uses PKCE + a single-use state bound to the person and workspace; the OAuth callback is an ordinary signed-in page, so no public endpoint was added; transcript text is untrusted data and is never interpreted.
- **Cost**: the Google Meet REST API is free to call (within Google's quotas). Phase 2 adds no paid service. Storage is small text.
- Development fixtures: `app.meeting-assistant.dev-fixtures-enabled=true` lets admins create **[SIMULATED]** meetings to exercise the UI. Off by default.

## Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| "Connect my Google account" is disabled | Server lacks the Google client ID/secret or `ENCRYPTION_KEY`. Test connection says which. |
| Sign-in says "link expired or already used" | Start again from Meeting Platforms; each sign-in link works once for 10 minutes. |
| "Google didn't grant lasting access" | Remove Prowosma from your Google account's third-party access, then connect again. |
| Meeting fails: *No transcript* | Transcription wasn't on during the meeting (Google only creates one then). Upload the transcript. |
| Meeting fails: *access denied* | The connected account didn't organize/attend the meeting, or your Google admin blocks it. Connect the organizer's account or upload. |
| Meeting fails: *reconnect* | Google revoked/expired the sign-in. Reconnect, then **Retry**. |
| Transcript flagged *partial* | Transcription started late or was stopped. The note says how much was covered. |
| "Already assigned to this meeting occurrence" | The same meeting (same time/occurrence) is already registered; open it from the list. |

## Verification status (what is and isn't proven)
| Item | How verified |
|---|---|
| Link parsing, transcript parsing, state machine, conference matching, coverage | Unit-tested and run |
| Google request building, token handling, import logic, retries, recovery | Integration tests against a **scripted fake of Google** (`FakeGoogleHttp`) — proves our logic, **not** Google's real responses |
| Backend Java | Syntax-parsed; Spring tests are written but must be run with `./gradlew test` (not executable in the authoring sandbox) |
| **Real Google Meet import** | **Not yet verified.** Needs an authorized Google account and a real meeting with transcription on. Field names in `GoogleMeetApi` follow Google's reference and must be confirmed in that run. |
| Teams | No integration yet (upload/paste only) |

## Known limitations
- Google auto-import needs a standard `meet.google.com/abc-defg-hij` link (not `lookup/…` links) and transcription turned on in the meeting.
- Speakers from Google are display names only; matching to Prowosma users is a later phase and never automatic from names alone.
- A meeting stays "Transcript received" until later phases process it; delete or replace the transcript, or cancel the meeting.
- Upload limits: 5 MB per upload, 50,000 lines per transcript.
