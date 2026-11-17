# AI Meeting Assistant — Setting up Google Meet, Fireflies and browser recording

Three ways to get a meeting in without uploading anything afterwards:

| | Works with | Setup |
|---|---|---|
| **Record from the browser** | Any meeting app open in Chrome or Edge | None |
| **Fireflies notetaker** (joins live) and **Import from Fireflies** | Google Meet, Zoom, Teams, Webex | An admin pastes the Fireflies API key once |
| **Google**: schedule Meet meetings from Prowosma, add calendar meetings automatically, read Meet transcripts | Google Meet | A one-time Google Cloud setup by your Google Workspace admin, then each person clicks *Connect Google account* |

Everything is in **AI Meeting Assistant → Connections** (top right of the page).

---

## 1. Record from the browser (no setup)

1. Open the meeting in a tab of **Chrome or Edge** on a computer.
2. In Prowosma: **AI Meeting Assistant → Record meeting** (or, on a meeting you added by link, **Record it now**).
3. Tick that everyone knows the meeting is recorded, then **Start recording**.
4. The browser asks what to share: choose the **meeting tab** and switch on **Share tab audio**.
5. Leave both tabs open. When the meeting ends press **Stop and summarise**.

The meeting's sound and (optionally) your microphone are recorded separately, sent in 3-minute pieces while you record, and turned into text afterwards. Lines from your microphone are labelled with your name; everyone else is "Other participants" (the recording can't tell other speakers apart). If the page is closed by accident, what was already sent is processed automatically after 10 minutes.

Needs a speech-to-text server (see 03-CONFIGURATION). Desktop meeting apps: share the app window instead of a tab; whether its sound is included depends on the browser and operating system.

## 2. Fireflies.ai

You already have a subscription; the Fireflies API needs a paid plan.

**Connect (a workspace admin, once):**
1. In Fireflies: **Settings → Developer settings** → copy the **API key**. Use the key of an account that is in the team and can see the team's meetings.
2. In Prowosma: **AI Meeting Assistant → Connections → Fireflies.ai**, paste the key, **Connect**. The key is checked with Fireflies, stored encrypted, and never shown again.

The server must have `ENCRYPTION_KEY` set to store the key (generate one with `openssl rand -base64 32`). Alternatively an operator can set `UMA_FIREFLIES_API_KEY` on the server instead.

**Use:**
- **Send Fireflies notetaker** — on a meeting you added by link, while the meeting is running. Fireflies joins it; after it ends Prowosma checks every few minutes and imports the transcript by itself (gives up after 24 hours and tells you).
- **Add → Import from Fireflies** — pick any recent Fireflies meeting. Each Fireflies meeting can be imported once.

Note from our test with your account: for 6 of your 10 most recent Fireflies meetings, Fireflies' API returned **no transcript text** even with an admin key (the other 4 imported fine). Those are usually meetings kept private to another member or that weren't transcribed. Prowosma tells you when this happens; in Fireflies, share the meeting with the team (or with the key's owner) and import again.

## 3. Google (your company's Google Workspace): schedule Meet meetings, use your calendar, read Meet transcripts

What each person gets after connecting their Google account (**AI Meeting Assistant → Connections → Connect Google account**):

- **Schedule a Google Meet** (Add → Schedule a Google Meet): title, time, length, people to invite, agenda. Prowosma creates the event in
  *your* Google Calendar with a Meet link; Google emails the invitations. Tick **Send the Fireflies notetaker when it starts** and nothing
  else is needed: Fireflies joins at the start time (Prowosma retries for 20 minutes if the meeting hasn't started yet), and after the meeting
  the transcript arrives by itself → "Your meeting summary is ready."
- **Calendar auto-import** (Connections → "Add my upcoming Google Meet meetings…"): every 10 minutes Prowosma looks at the next 7 days of your
  calendar and adds each meeting with a Meet link. If you also tick "…and send the Fireflies notetaker to them", every one of those meetings is
  recorded by Fireflies with no clicks at all. Rescheduled meetings move; meetings cancelled in Google Calendar are cancelled here. A meeting
  several colleagues have in their calendars is added once and shared with them.
- **Google Meet's own transcript**: for Meet meetings with transcription turned on, Google's transcript is read after the meeting (an
  alternative or backup to Fireflies).

Prowosma asks Google for: your email, read access to Meet conference records and transcripts (`meetings.space.readonly`), and access to
calendar *events* (`calendar.events`) — to create meetings and read upcoming ones. Not Drive, Gmail, or other calendars' settings.

### 3.1 Requirements on your side
- Google Workspace. Meet **transcripts** need an edition that includes them (Business Standard or higher, Enterprise, Education Plus…), allowed
  in the Google Admin console (Apps → Google Workspace → Google Meet → Meet video settings → Transcripts). Scheduling and calendar import work on
  any edition.
- Fireflies: for the notetaker to be let in, the Meet host may need to admit it (or allow guests from outside the organisation).

### 3.2 One-time Google Cloud setup (Workspace admin, ~15 minutes)
1. **console.cloud.google.com** → create a project, e.g. "Prowosma Meeting Assistant".
2. **APIs & Services → Library** → enable **Google Calendar API** and **Google Meet REST API**.
3. **OAuth consent screen**: User type **Internal** (only your company's accounts; no Google review). App name "Prowosma", support email,
   your domain. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/meetings.space.readonly`, `https://www.googleapis.com/auth/calendar.events`.
4. **Credentials → Create credentials → OAuth client ID → Web application**. **Authorised redirect URIs** — add both:
   - `https://<your Prowosma address>/ai-meeting-assistant/google-callback` (the AI Meeting Assistant)
   - `https://<your Prowosma address>/integrations/meeting-platforms/google-callback` (the existing Meeting Assistant, if you use it)
   - for local testing also `http://localhost:5173/ai-meeting-assistant/google-callback`
   Connections shows the exact address the server expects if you're unsure.
5. Copy the **Client ID** and **Client secret** and give them to whoever runs the server through your secret channel (not chat or email).

### 3.3 Server settings
```
GOOGLE_MEET_OAUTH_CLIENT_ID=<client id>
GOOGLE_MEET_OAUTH_CLIENT_SECRET=<client secret>
FRONTEND_URL=https://<your Prowosma address>     # redirect = FRONTEND_URL + /ai-meeting-assistant/google-callback
ENCRYPTION_KEY=<openssl rand -base64 32>          # start-all creates one locally
```
Locally, put these in `backend\.env` and run `start-all.bat`.

### 3.4 What we could and couldn't verify
Built and tested against a scripted Google (sign-in with PKCE and single-use links; creating the event with a Meet link and invitations;
calendar import, reschedule, cancel; Fireflies joining at the start time and retrying until the meeting has started; transcript arriving
afterwards). **Not yet run against your real Google Workspace** — that needs the OAuth client above. Then: connect, schedule a 5-minute test
meeting with the Fireflies box ticked, join it, and check the summary arrives.

## 4. Still not available (and why)

| | Why | Alternative |
|---|---|---|
| Prowosma's own bot joining live | Each platform needs its own bot infrastructure and approval (Zoom app review, a Windows media bot for Teams, Google's Meet Media API is a limited preview, Webex has none) | Fireflies notetaker or browser recording |
| Teams / Zoom / Webex transcripts after the meeting | Need an app registered with each vendor and admin approval (see the earlier list) | Fireflies import, browser recording, upload the recording |
| Meet *recordings* (Drive) | Needs Drive access, which Google reviews separately | Meet transcripts, Fireflies, browser recording |
