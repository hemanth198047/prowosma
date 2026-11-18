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
- Fireflies: the notetaker is a guest from outside your company, so in Google Meet **the host (or someone from your company already in the
  call) has to admit it** when it asks to join. If nobody who can admit it is in the meeting, it waits and then gives up.
- Prowosma sends Fireflies **at the scheduled start time** (and keeps trying for 20 minutes until the meeting is running) - not when people
  join. If you join early, it arrives at the start time; to bring it in earlier, press **Send Fireflies notetaker** on the meeting.
- Very short meetings (under a minute or two) may not get a Fireflies transcript at all. For a test, talk for a few minutes.
- After Fireflies is sent, Prowosma checks for its transcript 3 minutes later and then every few minutes, so a meeting that ends early is
  picked up soon after - you don't have to wait for the planned end. **Check now** on the meeting checks immediately.

### 3.2 One-time Google Cloud setup, step by step (~10 minutes)

First, in **console.cloud.google.com** → **APIs & Services → Library**, switch on **Google Calendar API** and **Google Meet REST API** in your project.

**Part A - tell Google about the app**
1. console.cloud.google.com → click the project name at the top → pick the project where the two APIs are on.
2. ☰ menu → **APIs & Services → OAuth consent screen** (newer consoles call it **Google Auth Platform**; click **Get started** if shown).
3. App information: App name `Prowosma`, User support email = yours → **Next**.
4. Audience: **Internal** → **Next**. (Only your company's Google accounts can use it; no Google review.)
   If *Internal* is greyed out, the project isn't inside your company's Google Workspace: choose **External** and add yourself under
   **Audience → Test users** (in that mode Google signs you out of Prowosma every 7 days).
5. Contact information: your email → **Next** → tick the agreement → **Create**.

**Part B - say what Prowosma may look at**
6. Left: **Data Access** (older: *Edit app → Scopes*) → **Add or remove scopes**.
7. At the bottom, in **Manually add scopes**, paste:
   ```
   openid
   email
   https://www.googleapis.com/auth/meetings.space.readonly
   https://www.googleapis.com/auth/calendar.events
   ```
   → **Add to table** → **Update** → **Save**.

**Part C - make the key**
8. Left: **Clients** → **+ Create client** (older: *APIs & Services → Credentials → + Create credentials → OAuth client ID*).
9. Application type **Web application**, name `Prowosma`. Leave *Authorised JavaScript origins* empty.
10. **Authorised redirect URIs → + Add URI**, exactly (http, port 5173, no `/` at the end):
    `http://localhost:5173/ai-meeting-assistant/google-callback`
    (optional, for the existing Meeting Platforms page: `http://localhost:5173/integrations/meeting-platforms/google-callback`;
    once Prowosma is online, also `https://<your address>/ai-meeting-assistant/google-callback`)
11. **Create** → copy the **Client ID** and **Client secret** (or **Download JSON** - newer consoles show the secret only once).

### 3.3 Give the key to Prowosma

**On your computer:**
1. Open `backend\.env` in Notepad (run `start-all.bat` once if it doesn't exist yet).
2. Add at the bottom - no spaces, no quotes:
   ```
   GOOGLE_MEET_OAUTH_CLIENT_ID=paste-the-client-id-here
   GOOGLE_MEET_OAUTH_CLIENT_SECRET=paste-the-client-secret-here
   ```
3. Check `ENCRYPTION_KEY=` has a long value (start-all fills it in). Leave `FRONTEND_URL` as `http://localhost:5173`.
4. Save, then `stop-all.bat` and `start-all.bat` (settings are read at start-up only).

**On a server:** the same two values, plus `FRONTEND_URL=https://<your address>` and an `ENCRYPTION_KEY` (`openssl rand -base64 32`),
and the matching https redirect URI added in step 10.

**Try it:** AI Meeting Assistant → **Connections → Connect Google account** → choose the company account → **Allow** (tick Calendar if
it's a tick box) → "Connected as …". Then **Add → Schedule a Google Meet** for 5 minutes from now with the Fireflies box ticked, join it,
and wait for "Your meeting summary is ready."

| What you see | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` | The address in step 10 isn't exactly the same (http / 5173 / no trailing `/`) |
| "Access blocked … only within its organisation" | Sign in with the company Google account |
| "Google hasn't verified this app" | You chose External: click Continue; your account must be a Test user |
| Connections: "Google sign-in isn't set up on the server yet" | Check the two lines in `backend\.env`, then stop-all + start-all |
| Connections: "Calendar access wasn't allowed" | Disconnect, connect again, and tick Calendar |

### 3.4 What we could and couldn't verify
Built and tested against a scripted Google (sign-in with PKCE and single-use links; creating the event with a Meet link and invitations;
calendar import, reschedule, cancel; Fireflies joining at the start time and retrying until the meeting has started; transcript arriving
afterwards). **Not yet run against your real Google Workspace** — that needs the OAuth client above. Then: connect, schedule a 5-minute test
meeting with the Fireflies box ticked, join it, and check the summary arrives.

## 4. Microsoft Teams (your company's Microsoft 365): start and schedule Teams meetings, read Teams transcripts

Same experience as Google Meet: each person connects their own Microsoft 365 work account once (**Connections → Connect Microsoft account**),
then chooses **Microsoft Teams** in *Meet now* or *Schedule* (or makes it their default in **Settings**).

### 4.1 Requirements on your side
- Microsoft 365 with Teams, and work accounts (not personal Microsoft accounts).
- For transcripts: Teams **transcription turned on in the meeting**, and the meeting **organised by the person who connected** (Microsoft only
  lets an organiser's own sign-in read the transcript this way).
- A Microsoft 365 / Entra **admin** for the one-time steps below (admin consent is required for reading transcripts).

### 4.2 One-time Microsoft Entra setup, step by step (~10 minutes, an admin)
1. Go to **https://entra.microsoft.com** and sign in as an admin.
2. In the left menu: **Applications → App registrations → New registration**.
3. **Name**: `Prowosma Meetings`. **Supported account types**: *Accounts in this organizational directory only* (or *any organisational
   directory* if several companies use the same Prowosma server).
4. **Redirect URI**: choose **Web** and type your Prowosma address followed by `/ai-meeting-assistant/microsoft-callback`
   (for example `https://app.yourcompany.com/ai-meeting-assistant/microsoft-callback`, or `http://localhost:5173/ai-meeting-assistant/microsoft-callback`
   for a local test). Click **Register**.
5. On the app's page, copy the **Application (client) ID** and the **Directory (tenant) ID** - you'll need them in 4.3.
6. **Certificates & secrets → New client secret** → description `Prowosma`, expiry 24 months → **Add**. Copy the **Value** right away
   (it is shown once). Put a reminder in your calendar to renew it before it expires.
7. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, tick:
   `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `OnlineMeetingTranscript.Read.All`, `User.Read`, `offline_access`, `openid`, `email`
   → **Add permissions**.
8. Click **Grant admin consent for <your company>** → **Yes**. All rows should show a green tick.

### 4.3 Give the IDs to Prowosma
On the server (or in `backend\.env` locally), add - **never paste the secret into chat or email**:
```
UMA_MS_CLIENT_ID=<Application (client) ID>
UMA_MS_CLIENT_SECRET=<the secret Value>
UMA_MS_TENANT=<Directory (tenant) ID>
```
`UMA_MS_TENANT` limits sign-in to your company; leave it out to allow any work account. Restart the backend. Then each person:
**AI Meeting Assistant → Connections → Connect Microsoft account**.

### 4.4 What we could and couldn't verify
Built and tested against a scripted Microsoft (sign-in with PKCE, single-use links that only the Microsoft sign-in accepts, admin-consent
errors, creating the Teams meeting with invitations in the right time zone, finding the meeting and reading its transcript with Teams'
speaker names, waiting while there is no transcript yet, a meeting the account didn't organise). **Not yet run against a real Microsoft 365
tenant** - no tenant was available. Acceptance: connect, *Meet now* with Teams, turn on transcription, talk for 3 minutes, end it, and check
the summary arrives (it is looked for from 5 minutes after the start; *Check now* looks immediately).

Not available for Teams: knowing exactly when the call starts and ends (Microsoft only tells apps with organisation-wide call permissions -
Prowosma looks for the transcript after the planned end instead), and Prowosma's own bot joining the call (needs a separate Windows media bot).

## 5. Speaker labels for uploaded and browser recordings (optional)

Google Meet and Teams transcripts already name the signed-in speakers. For recordings, our speech-to-text server can separate speakers into
neutral labels ("Speaker 1", "Speaker 2") - it never guesses names:
1. Create a free Hugging Face account, open https://hf.co/pyannote/speaker-diarization-3.1 and https://hf.co/pyannote/segmentation-3.0 and accept
   the conditions on both pages.
2. Create a read token (Hugging Face → Settings → Access Tokens).
3. In the speech-to-text server's environment: `pip install pyannote.audio`, then set `STT_DIARIZE=1` and `HF_TOKEN=<token>`; restart it.
   `http://127.0.0.1:8765/health` shows `"diarization": "ready"`.
A GPU is recommended for long recordings. Not validated here (needs the gated model); only the matching step is unit-tested.

## 6. Still not available (and why)

| | Why | Alternative |
|---|---|---|
| Prowosma's own bot joining live | Each platform needs its own bot infrastructure and approval (Zoom app review, a Windows media bot for Teams, Google's Meet Media API is a limited preview, Webex has none) | Fireflies notetaker or browser recording |
| Zoom / Webex transcripts after the meeting | Need an app registered with each vendor and admin approval | Fireflies import, browser recording, upload the recording |
| Meet *recordings* (Drive) | Needs Drive access, which Google reviews separately | Meet transcripts, Fireflies, browser recording |
