# Meeting Assistant

Status: **Phase 6 — Google Meet and Microsoft Teams import, operational hardening** (deployment, monitoring and troubleshooting: `MEETING_ASSISTANT_OPERATIONS.md`). Approved actions become real tasks and projects (review mode and optional automatic mode). Meetings can be registered, transcripts can be
uploaded/pasted (any platform) or imported automatically from Google Meet, and an AI model turns a transcript into three
editable, versioned documents whose statements link back to transcript lines. Structured
actions are then extracted and resolved for review, and approved items are created as real tasks and projects. The assistant **cannot join meetings live** (see "Why no live joining").

## What works today
| Capability | Google Meet | Microsoft Teams |
|---|---|---|
| Register a meeting by link (validated, duplicate-safe, recurring-aware) | ✅ | ✅ |
| Upload or paste a transcript (`.vtt`, `.srt`, plain text; up to 5 MB) | ✅ | ✅ |
| Automatic transcript import after the meeting | ✅ implemented, **not yet verified against a real meeting** (each person connects their own Google account) | ✅ implemented, **not yet verified against a real tenant** (organization-wide app + admin consent + access policy — `TEAMS_SETUP.md`) |
| Live joining / live audio | ❌ | ❌ |
| Speaker identity | Google's display name only | Only what the file states |
| Summary, MOM and Notes from the transcript (English) | ✅ implemented, **not yet verified with a real model** | ✅ same |

## Summary, Minutes of Meeting and Notes
**Which AI?** The provider an administrator configured in **AI Settings** (Anthropic, OpenAI, Gemini, or a custom OpenAI-compatible
endpoint). This feature uses its own *strict* client, not the general `AIService`: if AI is off, the key is missing, the feature is
switched off, or the model name doesn't match the provider, nothing is generated and the page says exactly why — it never
produces placeholder text. Transcript text is sent to that provider, so check it fits your privacy commitments.

**What is produced** (three documents, English; the output-language setting is passed to the model but only English is tested):
- **Summary** — purpose, main topics, outcomes, key decisions, next steps.
- **Minutes of Meeting** — date/time/timezone/duration, participants *as named in the transcript* (attendance isn't verified),
  agenda (what was *stated* vs topics *inferred*), discussion by topic, decisions, action items **as discussed** (owner and
  deadline exactly as spoken, labelled agreed / suggested / unresolved), risks, blockers, dependencies, open questions,
  corrected/withdrawn items, and a follow-up meeting only if one was actually discussed.
- **Notes** — detailed notes by topic, plus open questions and risks.

**Trust rules built in**
- Every statement must cite transcript line numbers (`[#12]`, `[#9-11]`). The server checks the citations against the real
  transcript and **removes any statement without valid evidence** (the meeting's status line says how many).
- Transcript text is treated as untrusted data: it is fenced in the prompt, forged fence tags are neutralised, the model has no
  tools, and its reply is parsed and validated, never executed. Words like "assign this to X" inside a meeting can't change owners,
  access or settings.
- "We could do X" stays *suggested*; unknown kinds default to *unresolved*; corrections and withdrawals are listed.
- Owners and deadlines are shown exactly as spoken — matching to people and dates is a later phase and never guessed.
- Long meetings are split into parts (every line goes to exactly one part, line numbers stay global) and merged; if merging
  fails the parts are joined without dropping anything; an answer cut off at the model's limit is redone on smaller pieces.

**Review & versions**
- First generation becomes the current version. **Regenerating never replaces what you have**: the new version waits as
  *pending*; compare it, then "Use new version" or "Keep mine". Edits and restores always create a new version — nothing is deleted
  until retention removes it. Saving an edit needs the version you were looking at (otherwise: "someone else changed this").
- If the transcript is replaced after documents exist, they're marked *out of date* (old text stays for comparison).
- Who may do what: readers (including shared people) can read; the requester or an admin can generate, edit, accept and restore.

**Operations & cost**
- Runs as a background job (same MongoDB queue): lease-protected, bounded retries, and a finished request can't run twice.
  Failures end as **Failed** with a reason and "Retry" (which regenerates — it doesn't re-fetch the transcript).
- Settings: **Meeting Platforms → Summaries, minutes and notes**: automatic generation on/off (default on, only if AI is ready).
  Limits: `app.meeting-assistant.ai-max-generations-per-hour` (20), `ai-single-pass-chars` (90 000), `ai-chunk-chars` (60 000),
  `ai-max-output-tokens` (8 000).
- **Usage** is recorded per run in tokens (`GET /api/admin/meeting-assistant/usage`, shown on the settings page). Money isn't
  computed because it depends on your model's prices. *Planning estimate (not measured):* about 150 spoken words/min ≈ 9 000 words
  ≈ 12 000 tokens per meeting-hour, so one single-pass run is roughly 13 000 input + 3 000–6 000 output tokens. At about 2 meeting-hours
  a day that is on the order of 0.8 M input and 0.3 M output tokens per month; long meetings add a merge step, edits/regeneration add more.
  Multiply by your model's per-token prices.
- Retention: generated documents and run records are removed after "Keep summaries and minutes for (days)".
- Finding: `ai_settings.apiKey` is stored in plain text by the existing AI Settings feature (outside this feature). Consider
  encrypting it; the new client already decrypts values written with `FieldEncryptionService`.

## Actions, people and projects (review before anything is created)
After the documents are ready (or on demand with **Extract actions**), a second AI pass lists the action items. The model is asked
only for what was **said** — title, owner and deadline *as spoken*, whether it was agreed, the cited transcript lines. Everything
that decides a person, a project or a date is then done **in code**, so it is predictable and testable:

- **Owners** are matched to your directory only on an **exact, unique full name** (or exact email). A first name or partial name is
  only a *suggestion* to confirm; two people with the same name are *ambiguous*; outsiders, read-only members and groups ("the team")
  stay **unassigned**, with a plain reason and a picker. "I will handle it" uses only the label the *source* gave that speaker
  (Google's display name) — never a guess from a voice. Nobody is ever created from a name. The directory is **never sent to the model**.
- **Projects**: the project you selected is the default; a project the discussion clearly named (it must be an exact existing name)
  wins but is flagged to confirm; otherwise the action stays unresolved. A **new project** is only *proposed* when the discussion
  supports a distinct initiative, and never if a project with that name exists.
- **Deadlines** are resolved against the meeting's date and timezone: "by Friday", "tomorrow", "in two weeks", "12 October" resolve;
  "end of week" is *approximate*, "next Friday" / "12/10" / "next week" are *ambiguous* and must be chosen by a person; "ASAP" has no date.
- **Priority** is kept only if the discussion stated it (with cited lines); otherwise the application default (Medium) is used and labelled "default".
- **Agreed vs suggested** — "we could…" is *suggested*, not a commitment; withdrawn or corrected actions are marked *withdrawn*;
  near-duplicates are flagged (merge, or "keep both"); each action has evidence links, a confidence level and plain review reasons.
- **Review**: edit anything, approve, reject, restore, merge, approve selected, or **Approve all valid**. *Valid* = agreed, not withdrawn,
  not a suspected duplicate, attached to a project (existing, or a new one that has been approved), and with a reliable-or-absent deadline.
  An unassigned owner is allowed. Editing an approved action sends it back for approval. The **Projects and Tasks** tab previews exactly
  what would be created and holds the **Create approved items** button (next section).
- **Re-running** never overwrites reviewed work: it waits as "N new, M still present, K no longer found" for you to apply or discard;
  items no longer found are flagged, never deleted.
- **Required fields** (decision): a task needs a title and a project; a new project needs a name **and a description** (the app itself
  only requires a name). Assignees are workspace members (team-member ids) who are not read-only.
- **Cost**: extraction is one more pass over the transcript — roughly the same input tokens as the documents again (long meetings are
  split, with earlier action titles passed forward). Switch: **Meeting Platforms → Summaries, minutes and notes → extract action items automatically**.
- **Failure** of extraction never fails the meeting; the Actions tab shows the reason and a retry.

## Creating tasks and projects
**Review mode (default).** On **Projects and Tasks**, **Create approved items** creates *every* approved project and task at once, **as the
person who pressed it** (they are the creator). It uses the application's existing task and project services, so the activity log, live
updates and the standard "Task Created" notification behave like for any other task. Only the requester or an admin can press it.
- **What is created:** title; description (+ what it depends on); project (an approved *new* project is created first, then its tasks attach
  to it); assignee (only the resolved owner, re-checked at that moment — someone who became read-only is not assigned); due date (the
  resolved calendar date); priority; type; tag `meeting`; acceptance criteria as the task's checklist.
- **Linked back, three ways:** structured fields on the task/project (`sourceMeetingId`, `sourceMeetingTitle`, `sourceActionKey`/`sourceProposalKey`,
  `sourceEvidence`), a footer in the description — *"Created from meeting “…”. Evidence: transcript lines [#1] [#3-4]. Open: /meeting-assistant?session=<id>"* —
  and that link opens the meeting. The meeting shows each created item and who created it.
- **Duplicate-proof:** each item is *claimed* atomically before anything is created, every created record carries the id of the item it
  came from, and a unique database index backs this up. Pressing Create twice, two people pressing it together, a retry, or a crash half-way
  can never produce the same task twice (a crash leftover is reused, not duplicated).
- **Partial success is explicit:** each item succeeds or fails on its own; failures keep a plain reason; **Create** again retries only what is
  not created yet. Items that are no longer true (e.g. their project was deleted after approval) go **back to review** instead of being created.
- **A created item is final in the meeting:** it can't be edited, re-decided or merged there (edit the task itself). Changing the meeting later
  never rewrites or deletes created records, and deleting a created task doesn't reopen the action.
- **Notifications:** Prowosma has no per-user notification system — notifications are workspace-wide records with a category. Each created task
  gets the standard "Task Created" notification (from the task service), and each *assigned* task also gets a **"Task assigned"** notification in the
  inbox's existing **ASSIGNMENT** category naming the assignee. These are visible to the workspace, not private to the assignee.

**Automatic mode (optional, admin).** *Meeting Platforms → Creating tasks and projects* has two separate switches. When on, after extraction
and a short wait (`app.meeting-assistant.auto-create-delay-minutes`, default 10) so corrections count, a background job creates items — **as the dedicated
Meeting Assistant system actor** (`meeting-assistant@system.prowosma`: a reserved identity with no login and no user record, bound to this one
workspace while it works, with the tenant guard still enforcing isolation) and records show it as the creator.
- It only creates items that pass strict rules: an **agreed** commitment with cited evidence, a **named owner who matches your directory**, a project
  (existing, or a new project that is itself automatic-eligible and ready), a reliable-or-absent deadline, not a suspected duplicate, not withdrawn,
  not missing from the latest analysis. Suggestions, unassigned/ambiguous items and anything a person **rejected** stay in review untouched.
- It **stands down** if changes from a re-run are waiting for review, if the requester can no longer act (e.g. now read-only), or if the switch was
  turned off after it was queued — each is recorded in the audit trail. Tasks and projects have independent switches (tasks on / projects off means
  tasks needing a new project wait for a person).

**Deletion:** deleting a transcript or generated documents never deletes tasks or projects created from them (they are independent records that keep
their link and evidence text). There is no "delete meeting" action yet.

## Why no live joining
Google's live-audio API (Meet Media API) is a limited developer preview that requires every participant to be enrolled;
Microsoft Teams live audio requires a separate Windows-hosted media bot service. Neither fits "free official APIs only", so the
UI never offers a "send assistant into the call" action unless a platform truly reports that capability.

## Administrator setup — Google Meet automatic import (optional)
Without this, everything still works with manual upload/paste. **Follow the step-by-step guide: [`GOOGLE_MEET_SETUP.md`](./GOOGLE_MEET_SETUP.md).**
In short: (1) create a Google Cloud project and enable the *Google Meet REST API*, (2) in *Google Auth Platform* add the scopes
`openid`, `email`, `meetings.space.readonly`, (3) create a *Web application* OAuth client whose redirect URI is
`<FRONTEND_URL>/integrations/meeting-platforms/google-callback`, (4) set `GOOGLE_MEET_OAUTH_CLIENT_ID`, `GOOGLE_MEET_OAUTH_CLIENT_SECRET`
and `ENCRYPTION_KEY` (never change an existing key), restart, then each person clicks **Connect my Google account**.
Note: an *External* app in Google's *Testing* mode may make sign-ins expire after about 7 days (people reconnect).

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
| Summary not generated: "AI isn't turned on / no key / model doesn't match" | Fix it under **AI Settings** (the message names the problem); the Meeting Assistant page shows the same reason. |
| Meeting failed with "AI service didn't respond" | Provider outage or rate limit after several tries. Press **Retry**. |
| Meeting failed with "reply wasn't in the expected format" | The model didn't return usable output twice. Retry; if it persists choose a more capable model in AI Settings. |
| Some statements missing from the minutes | They didn't cite real transcript lines and were removed on purpose (the status line says how many). |
| Actions tab: "AI isn't ready" / extraction failed | Same causes as summaries: fix **AI Settings**, then **Try again**. The meeting itself is unaffected. |
| An owner shows "Unassigned" although the name was said | Only an exact, unique full name is assigned. Pick the person (suggestions are shown). The directory name must match the spoken name. |
| "This can't be approved yet" | The card lists what's missing — usually a project, or an ambiguous deadline. Choose it, then approve. |
| Meeting fails: *reconnect* | Google revoked/expired the sign-in. Reconnect, then **Retry**. |
| Transcript flagged *partial* | Transcription started late or was stopped. The note says how much was covered. |
| "Already assigned to this meeting occurrence" | The same meeting (same time/occurrence) is already registered; open it from the list. |

## Verification status (what is and isn't proven)
| Item | How verified |
|---|---|
| Link parsing, transcript parsing, state machine, conference matching, coverage | Unit-tested and run |
| Google request building, token handling, import logic, retries, recovery | Integration tests against a **scripted fake of Google** (`FakeGoogleHttp`) — proves our logic, **not** Google's real responses |
| Backend Java | Syntax-parsed; Spring tests are written but must be run with `./gradlew test` (not executable in the authoring sandbox) |
| **Teams import (Graph)** | Written from Microsoft's published docs; integration tests use a **scripted Microsoft**. **Not yet verified against a real Microsoft 365 tenant** — run the Teams checklist in the operations guide. |
| **Operational hardening** (metrics, health, recovery, retention, route authentication, no secret in any response) | Integration tests written (not run here). |
| **Real Google Meet import** | **Not yet verified.** Needs an authorized Google account and a real meeting with transcription on. Field names in `GoogleMeetApi` follow Google's reference and must be confirmed in that run. |
| Teams | No integration yet (upload/paste only) |

## Known limitations
- Google auto-import needs a standard `meet.google.com/abc-defg-hij` link (not `lookup/…` links) and transcription turned on in the meeting.
- Speakers from Google are display names only; matching to Prowosma users is a later phase and never automatic from names alone.
- After review a meeting stays in "Ready for review" until later phases (task creation) complete it; you can cancel it, regenerate, or replace the transcript.
- English only for now.
- Created tasks/projects are independent copies: later edits in the meeting don't sync to them. Links open the Tasks / Projects lists (the app has no per-task page to deep-link to). Due dates are stored as the start of the resolved calendar day.
- Existing Task and Project records gained a few optional fields (listed above) and two partial unique indexes; nothing existing is changed.
- Upload limits: 5 MB per upload, 50,000 lines per transcript.
