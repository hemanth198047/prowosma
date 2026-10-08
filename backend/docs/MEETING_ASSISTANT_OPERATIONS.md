# Meeting Assistant — deployment, operations and troubleshooting

Companion to `MEETING_ASSISTANT.md` (what it does) and the two setup guides (`GOOGLE_MEET_SETUP.md`, `TEAMS_SETUP.md`).

## 1. How it runs (nothing new to deploy)
The feature lives inside the existing backend. Background work uses a **job queue in MongoDB** (`meeting_jobs`): each job is claimed with one atomic update and a lease, so **several backend instances can run safely** — a job runs on exactly one at a time, and a job whose worker died is re-claimed automatically. There is no extra service, queue or cron. Every instance polls every 15 seconds.

| Piece | Where |
|---|---|
| API + background poller | the backend (same process) |
| State | MongoDB (`meeting_*`, `transcript_segments`) |
| Integrations | Google Meet REST API, Microsoft Graph, your AI provider — all outbound HTTPS, allow-listed hosts only |
| Metrics / alerts | existing Prometheus + Alertmanager (`backend/observability`) |

## 2. Where to deploy
| Platform | Verdict |
|---|---|
| **VPS with Docker Compose** (`backend/docker-compose.yml`) | **Recommended.** Always-on, so imports and generation keep progressing. Use `restart: unless-stopped`. Put settings in `backend/.env`. |
| **Render** | Works **only on an always-on (paid) instance.** A free web service sleeps when idle, so polling stops — imports and generation stall until the next request wakes it. Free tier is fine for trying the UI. |
| **Kubernetes** (`backend/k8s`) | Fine, including the HPA: multiple pods are safe. Put settings in the Secret that `backend-deployment.yaml` already reads. |

Sizing: at ~2 meeting-hours a day the load is tiny (a handful of jobs an hour). The cost driver is the AI provider, not the servers.

## 3. Configuration reference
| Setting | Purpose | Default |
|---|---|---|
| `GOOGLE_MEET_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Google import (`GOOGLE_MEET_SETUP.md`) | off |
| `TEAMS_GRAPH_CLIENT_ID` / `_SECRET` | Teams import (`TEAMS_SETUP.md`) | off |
| `ENCRYPTION_KEY` | **Required** for saved Google sign-ins. Never change an existing key. | empty |
| `FRONTEND_URL` | Must be the address people use; builds the Google redirect | `http://localhost:5173` |
| `app.meeting-assistant.jobs-enabled` | Turn the background poller off on an instance | true |
| `…job-poll-ms` | Poll interval | 15000 |
| `…auto-create-delay-minutes` | Wait before automatic task/project creation | 10 |
| `…ai-max-generations-per-hour` | Per-workspace AI runs/hour (documents + actions) | 20 |
| `…ai-single-pass-chars` / `…ai-chunk-chars` / `…ai-max-output-tokens` | Long-meeting splitting and output size | 90000 / 60000 / 8000 |
| `…stuck-after-minutes` | When a meeting with no live job counts as stranded | 10 |
| `…audit-retention-days` | Keep audit events this long | 730 |
| `…dev-fixtures-enabled` | Allow **[SIMULATED]** meetings (never in production) | false |
The AI provider, key and model are set **in the app** (AI Settings), per workspace — not here.

**Where these settings live:** the backend reads a `.env` file itself (`/etc/secrets/.env` first — a Render Secret File — then `./.env`). Real environment variables, if set, override the file. The listening port follows the host's `PORT` automatically (default 9090). `.env` is git-ignored; never commit it.

## 4. First-time checklist
1. Backend running with a valid `JWT_SECRET`, `MONGODB_URI`, `FRONTEND_URL`.
2. (Optional) Google: `GOOGLE_MEET_SETUP.md`. (Optional) Teams: `TEAMS_SETUP.md`.
3. App: **AI Settings** → provider/key/model + feature on. (Check the Meeting Assistant page: the AI banner disappears.)
4. App: **Integrations → Meeting Platforms** → enable platforms; set retention, who can send, default visibility; review the two automatic-creation switches (leave **off** until you've verified quality).
5. Open **Meeting Platforms → Health**: "Background work is flowing."
6. Run the verification runbook (section 5).

## 5. Verification runbook (real, authorized test meetings)
Everything automated so far used **scripted** versions of Google, Microsoft and the AI model. These steps prove the real thing. Use meetings whose participants agreed to be recorded/transcribed, and a test project.

**Google Meet**
1. Connect a Google account (organizer), Test connection = healthy.
2. Start a Meet, **turn on transcription**, say ~10 sentences including: a clear commitment with a named owner and "by Friday"; a "we could maybe…" suggestion; a withdrawn item ("actually, scrap that"); a deadline "next Friday". End the call.
3. In Meeting Assistant paste the link → Register. Wait or **Check now**.
4. Expect: transcript appears (speaker names as Google shows them); status → Transcript received → documents generated (if AI configured).
5. Check: Summary/MOM/Notes cite real lines; the "next Friday" deadline is flagged ambiguous; the suggestion isn't a commitment; the withdrawn item is marked; owners match only exact full names.
6. Record: time from meeting end to transcript import (expect minutes), any error code.

**Microsoft Teams**
1. Complete `TEAMS_SETUP.md` including Part C; Test connection = healthy.
2. Start a Teams meeting **as the covered organizer**, start transcription, speak as above, end.
3. Register with the invitation's "Join the meeting" link; wait or **Check Microsoft Teams now**.
4. Expect the same as Google. If it fails with "access denied", the application access policy isn't applied yet (wait ~30 min) or not granted to that organizer.
5. Also verify: restart transcription mid-meeting → both transcripts joined; a second meeting on the same link is not mixed up with the first.

**Sign-off table** (copy and fill in): provider · date · organizer · result (pass/fail) · import delay · issues · who verified. **Do not enable automatic creation until both providers you use have passed and you've reviewed several meetings' extracted actions.**

## 6. Monitoring
Prometheus metrics (all tags are small fixed sets — never an organization, meeting or person):
| Metric | Meaning |
|---|---|
| `prowosma_meeting_queue_due` | jobs due now (should be ~0) |
| `prowosma_meeting_queue_oldest_due_seconds` | how long the longest-waiting due job waited |
| `prowosma_meeting_queue_expired_leases` | running jobs whose worker went silent |
| `prowosma_meeting_jobs_total{type,outcome}` | job runs (`done` / `retry` / `fail`) |
| `prowosma_meeting_job_duration_seconds{type}` | job duration |
| `prowosma_meeting_llm_tokens_total{kind,direction}` | AI tokens (`OUTPUTS`/`ACTIONS`) |
| `prowosma_meeting_generation_duration_seconds{kind,status}` | AI run duration |
| `prowosma_meeting_sessions_created_total{provider}`, `prowosma_meeting_transcripts_received_total{source}` | volume |
Alerts (`backend/observability/alert-rules.yml`, group `meeting-assistant`): `MeetingJobBacklog`, `MeetingJobStalled`, `MeetingWorkerLeasesExpired`, `MeetingJobFailureRate`, `MeetingAiTokenSpike`. Admins also have **Meeting Platforms → Health** (queue, failures by reason, AI usage, last import per source).

## 7. Runbooks
### Job backlog or stalled queue
Symptoms: `MeetingJobBacklog`/`MeetingJobStalled`; Health says "stalled"; meetings sit in "Waiting" or "Processing".
1. Is a backend instance running and awake? (Render free tier sleeps.) Is `app.meeting-assistant.jobs-enabled` accidentally `false` everywhere?
2. Check backend logs for "Meeting job tick failed". Is MongoDB reachable?
3. `expired leases > 0`: a worker crashed mid-job — jobs are re-claimed automatically after 5 minutes; nothing to do unless it persists.
4. Meetings stuck in PROCESSING with no job are failed automatically after 10 minutes with a **Retry** button (recovery sweep).
### High failure rate
1. Health → "Most common reasons" tells you which code. 2. Codes: see section 8.
### AI cost spike
1. Health/usage shows tokens. 2. Look for repeated **Regenerate**/**Extract** presses or an unusually long meeting. 3. Lower `ai-max-generations-per-hour`; switch off automatic generation/extraction (Settings) until understood.
### After an outage
Nothing to replay: polling jobs continue; failed items show a reason and **Retry**; uploads always work.

## 8. Failure codes (what people see → what to do)
| Code | Meaning | Fix |
|---|---|---|
| `NO_TRANSCRIPT`, `TRANSCRIPT_TIMEOUT` | Transcription wasn't on / nothing appeared in 24 h | Upload the transcript |
| `GOOGLE_REAUTH_REQUIRED`, `GOOGLE_NOT_CONNECTED` | Google sign-in expired/missing | Person reconnects Google, Retry |
| `GOOGLE_ACCESS_DENIED` | Connected account didn't organize/attend | Connect the organizer's account |
| `TEAMS_CONSENT_MISSING`, `TEAMS_BAD_SECRET`, `TEAMS_TENANT_NOT_FOUND`, `TEAMS_NOT_CONFIGURED`, `TEAMS_AUTH` | Microsoft app setup | `TEAMS_SETUP.md`; Test connection |
| `TEAMS_ACCESS_DENIED` | No application access policy for the organizer (or not applied yet) | Part C, wait, Retry |
| `TEAMS_TRANSCRIPTS_DISABLED` | Tenant disabled Graph transcript access | Admin allows it |
| `TENANT_MISMATCH`, `UNSUPPORTED_LINK` | Other organization's meeting / link lacks organizer | Upload; use the invitation link |
| `TRANSCRIPT_TOO_LONG` | > 50,000 lines | Upload in parts |
| `AI_NOT_CONFIGURED`, `AI_AUTH` | AI off / bad key | AI Settings |
| `AI_BAD_OUTPUT`, `AI_INPUT_TOO_LARGE` | Model reply unusable / model too small | Retry; choose a more capable model |
| `AI_UNAVAILABLE`, `TEMPORARY_PROBLEM` | Provider outage after retries | Retry later |
| `PROCESSING_STOPPED` | Work was lost (restart) | Retry |

## 9. Security & privacy summary
- Every endpoint requires sign-in (tested); admin endpoints require OWNER/ADMIN; every record is scoped to its workspace; a meeting is visible only to its requester, people it's shared with, admins, or the workspace if chosen — attendance grants nothing.
- Outbound calls: hard host allow-lists (Google, Microsoft, first-party AI hosts; custom AI endpoints must be public https). No redirects. Response size caps.
- Secrets: Google tokens encrypted at rest (refuse to save without `ENCRYPTION_KEY`); Microsoft app secret only in server settings; Microsoft tokens only in memory; no secret, token, passcode or transcript text in logs, audit events, metrics or API responses (tested).
- Transcript text is untrusted: never executed, fenced in prompts, outputs validated; the people directory is never sent to the AI.
- **Be aware:** transcripts and prompts go to your chosen AI provider; the AI key in AI Settings is stored in plain text by the existing AI Settings feature (outside this feature) — consider encrypting it; Google's "Testing" mode expires sign-ins after ~7 days.
- Retention: transcripts (default 90 d) and generated content (365 d) are removed on schedule; finished jobs after 30 d; audit events after 730 d.

## 10. Limits and performance
| Limit | Value |
|---|---|
| Transcript upload | 5 MB; 50,000 lines |
| Single AI pass | ≈ 90,000 characters; longer meetings are split (nothing dropped) |
| AI runs per workspace | 20 per hour (configurable) |
| Poll interval / import delay | 15 s poll; import usually minutes after the meeting ends |
Load test: `backend/load-tests/meeting-assistant-load-test.js` (k6) — run against staging; thresholds: list p95 < 600 ms, 4,000-line transcript upload p95 < 3 s. **Not yet executed**; record your baseline.

## 11. Cost assumptions (≈ 2 meeting-hours a day)
Google and Microsoft APIs: no per-call charge for this use (within their quotas). Infrastructure: none added. AI: roughly 0.8 M input + 0.3 M output tokens/month for documents, about as many input tokens again for action extraction — **multiply by your model's price** (usage is in Health). Estimates, not measurements.

## 12. Known limitations
No live joining (platform APIs don't allow it without paid/preview access). Google needs transcription on and each person's own sign-in; Teams needs the invitation link, an admin-approved app and an access policy. Speaker names are what the platform shows; people matching needs an exact unique full name. English output only. Real-world behavior of both platform integrations and of the AI model is **unverified until the runbook in section 5 has been run.**
