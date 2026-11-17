# AI Meeting Assistant — Setting up Google Meet, Fireflies and browser recording

Three ways to get a meeting in without uploading anything afterwards:

| | Works with | Setup |
|---|---|---|
| **Record from the browser** | Any meeting app open in Chrome or Edge | None |
| **Fireflies notetaker** (joins live) and **Import from Fireflies** | Google Meet, Zoom, Teams, Webex | An admin pastes the Fireflies API key once |
| **Google Meet transcript** (read automatically after the meeting) | Google Meet | A one-time Google Cloud setup by your Google Workspace admin, then each person clicks *Connect Google account* |

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

## 3. Google Meet (your company's Google Workspace)

How it works: after a Meet meeting where **transcription was turned on**, Google keeps a transcript. Prowosma reads it through the Google account of the person who added the meeting, matches it to the meeting link and time, and imports it with participants' names. If you add a Meet link while your Google account is connected, this happens **automatically after the meeting**; otherwise press **Get transcript from Google Meet** on the meeting.

### 3.1 Requirements on your side
- Google Workspace edition that includes Meet **transcripts** (Business Standard or higher, Enterprise, Education Plus…).
- In the Google Admin console: **Apps → Google Workspace → Google Meet → Meet video settings → Transcripts**: allowed.
- In each meeting, someone turns on **Transcripts** (Activities → Transcripts). No transcript = nothing to import (then use the Fireflies notetaker or browser recording).
- The person who connects must have been **in the meeting or own it**.

### 3.2 One-time Google Cloud setup (Workspace admin, ~15 minutes)
1. Go to **console.cloud.google.com** → create a project, e.g. "Prowosma Meeting Assistant".
2. **APIs & Services → Library** → enable **Google Meet REST API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** (only your company's accounts can connect; no Google review needed).
   - App name "Prowosma", support email, your domain.
   - Scopes: add `openid`, `email`, and `https://www.googleapis.com/auth/meetings.space.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorised redirect URI**: `https://<your Prowosma address>/integrations/meeting-platforms/google-callback`
     (for local testing: `http://localhost:5173/integrations/meeting-platforms/google-callback`).
   - Copy the **Client ID** and **Client secret**.
5. Send the client ID and secret to whoever runs the server through your normal secret channel — **not by chat or email in plain text**.

### 3.3 Server settings
```
GOOGLE_MEET_OAUTH_CLIENT_ID=<client id>
GOOGLE_MEET_OAUTH_CLIENT_SECRET=<client secret>
FRONTEND_URL=https://<your Prowosma address>          # the redirect URI is built from this
ENCRYPTION_KEY=<openssl rand -base64 32>               # sign-ins are stored encrypted
# optional, only if the redirect URI must differ from FRONTEND_URL + /integrations/meeting-platforms/google-callback
GOOGLE_MEET_OAUTH_REDIRECT_URI=
```
These are the same settings the existing Meeting Assistant uses, so one Google client serves both. On Windows (PowerShell), set them with `$env:NAME="value"` before starting the backend.

### 3.4 Each person connects once
**AI Meeting Assistant → Connections → Connect Google account** → choose the company account → allow "See your Google Meet conferences". Google sends you back to Prowosma's *Meeting Platforms* page, which confirms the connection; return to the AI Meeting Assistant from the sidebar. (This reuses the existing, unchanged sign-in page.)

Prowosma only asks for read access to Meet conference records and transcripts — not Calendar, Drive, Gmail or recordings.

### 3.5 What we could and couldn't verify
Built and tested against a scripted Google API (meeting in progress → waiting; ended → transcript read with participants' names → summary). **Not yet run against your real Google Workspace** — that needs the client ID/secret above and one real Meet meeting with transcription on. Once you have them, run one meeting through it; the Meet card then moves from "Built in" to "Works — tested".

---

## 4. Still not available (and why)

| | Why | Alternative |
|---|---|---|
| Prowosma's own bot joining live | Each platform needs its own bot infrastructure and approval (Zoom app review, a Windows media bot for Teams, Google's Meet Media API is a limited preview, Webex has none) | Fireflies notetaker or browser recording |
| Teams / Zoom / Webex transcripts after the meeting | Need an app registered with each vendor and admin approval (see the earlier list) | Fireflies import, browser recording, upload the recording |
| Meet *recordings* (Drive) and calendars | Need extra Google permissions (Drive, Calendar) and a review for the Drive scope | Meet transcripts, Fireflies, browser recording |
