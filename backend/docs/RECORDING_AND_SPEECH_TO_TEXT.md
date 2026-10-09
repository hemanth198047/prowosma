# Recording meetings and turning them into text (any platform, any account)

Google Meet and Microsoft Teams can only give Prowosma a transcript when the account has that feature. **Recording works for every account and every platform** — Meet, Teams, Zoom, a phone call, a meeting room — because Prowosma records the audio itself, in the browser, and turns it into text. It is **off until an admin turns it on**, and nothing about the Google Meet / Teams import changes.

## How it works
1. A person opens their meeting in one browser tab, then presses **Start recording** in Prowosma (Meeting Assistant page) and chooses the meeting tab in the box the browser shows, ticking **Share tab audio**. (Browsers never allow a page to skip that box — it is a browser privacy rule.)
2. The browser records the meeting's audio, and optionally the person's microphone, in pieces of about 3 minutes and sends each piece to Prowosma.
3. Prowosma stores each piece **encrypted**, sends it to the **speech-to-text server your admin chose**, and keeps only the resulting text.
4. When the recording ends, the text goes through the normal pipeline: summary, minutes, action items, tasks.
5. The audio is **deleted automatically 24 hours after the recording ends** (admin can change this: 0–72 hours; 0 = as soon as it has become text). The 24-hour window exists so a failed transcription can be retried.

A recording can also be **uploaded as a file** (up to 25 MB) for a new meeting, or for a meeting that already exists.

## What you need
- **`ENCRYPTION_KEY`** set on the server (the same key that protects Google tokens). Without it recording stays unavailable, because audio must never be stored unencrypted. **Never change this key** while audio is stored: stored audio could no longer be read.
- A **speech-to-text server** that speaks the OpenAI "transcriptions" API (below).
- The background job runner running (it is by default: `app.meeting-assistant.jobs-enabled=true`). It also does the automatic deletion, about every 5 minutes.

## Setting up a FREE speech-to-text server on your own VPS
Prowosma does not run speech recognition itself. Any server with an OpenAI-compatible `POST /v1/audio/transcriptions` endpoint works, so you can choose:

| Option | Cost | Notes |
|---|---|---|
| A **Whisper** server on your own VPS (e.g. projects built on *faster-whisper*, such as **speaches** or **ScribeCrate**) | $0 beyond the VPS | Runs in Docker. Check each project's own README and license for the current image name, settings and terms |
| OpenAI, Groq or another hosted service | Per hour of audio | Needs an API key; audio leaves your own infrastructure |

### Free server: the steps
1. **Install Docker** on the VPS.
2. **Start the Whisper server** by following the chosen project's README. Pick a model: smaller models (e.g. "small") run acceptably on an ordinary CPU; larger ones are more accurate but want a GPU. Project benchmarks put the "small" model several times faster than real time on a strong CPU, using roughly 1.5 GB of RAM — **but test on your own server** (see step 5).
3. **Put it behind HTTPS.** Prowosma only talks to `https://` addresses. A reverse proxy such as Caddy does this and fetches a free certificate. Example (adjust the domain and port; test it before relying on it):
   ```
   stt.your-company.com {
       @noauth not header Authorization "Bearer {env.STT_KEY}"
       respond @noauth 401
       reverse_proxy localhost:8000
   }
   ```
   The `@noauth` lines make the server refuse anyone who doesn't send your secret key, so strangers can't use your VPS. Choose a long random value for `STT_KEY`.
4. **Point Prowosma at it:** Meeting Assistant → *Recording & speech-to-text* (admins only):
   - **Address:** `https://stt.your-company.com`
   - **API key:** the `STT_KEY` value. It is stored encrypted and never shown again.
   - **Model name:** whatever your server expects (for the faster-whisper-based servers this is usually a name like `Systran/faster-whisper-small`; for OpenAI it is `whisper-1`).
   - **Language:** leave empty to detect automatically, or enter a code such as `en`.
   - **Keep the audio:** 24 hours recommended.
   - Tick **Allow recording…**, press **Save**, then **Test connection**.
5. **Time a real recording.** Record a 5-minute test meeting with several voices. If transcription takes much longer than the meeting, use a smaller model or a bigger server.

### If the server is on a private network
Prowosma refuses addresses that point at private, loopback or cloud-metadata ranges (a safety measure for admin-entered addresses). Only if your Prowosma backend itself runs inside the same private network, set `app.integrations.allow-private-hosts=true`. This setting is shared with custom AI endpoints. It is **not** needed for a normal public https address.

## Using it
- **Browser:** Chrome or Edge on a computer. Other browsers can't share a tab's audio.
- Keep the **meeting tab and the Prowosma page open** while recording. Closing either stops it. If the browser goes away, Prowosma finishes the recording automatically after 10 minutes of silence from it.
- **Everyone in the meeting must know** it is being recorded and turned into text. Prowosma makes the person confirm this, shows a "Recording" banner, and offers a *Copy announcement* button for the meeting chat.
- **Uploads** accept audio or video files (webm, ogg, wav, mp3, m4a/mp4, flac, aac) up to 25 MB. A one-hour meeting fits if you compress it, for example:
  `ffmpeg -i meeting.mp4 -vn -ac 1 -ar 16000 -b:a 48k meeting.mp3` (about 21 MB per hour).
- **Speakers:** a browser recording separates "You" (microphone) from "Other participants" (the meeting). It can't tell the other people apart; an uploaded file has no speaker information at all.

## What is stored, and for how long
| What | Where | How long |
|---|---|---|
| Audio pieces | Encrypted (AES-256-GCM) in the database's file storage | Admin's setting: default 24 h after the recording ends, then deleted. Anything left behind by a crash is also cleaned up |
| The text | Like any transcript | Your transcript retention (90 days by default) |
| Speech-to-text API key | Encrypted; never returned to the browser | Until removed |

A person can delete the audio at any time (*Delete audio now* on the meeting). The transcript already made from it stays.

## When something goes wrong
| Message | Meaning | What to do |
|---|---|---|
| "No meeting audio was shared…" | The *Share tab audio* box wasn't ticked, or a window/screen was chosen without audio | Start again; choose the meeting **tab** and tick *Share tab audio* |
| "The speech-to-text server rejected the API key" | Wrong or missing key | Fix it in the settings, then press **Retry** on the meeting — the same audio is used |
| "doesn't have that address or model" | Wrong address or model name | Fix in the settings, press **Retry** |
| "busy or unavailable" / "didn't respond after several tries" | The server is down or overloaded | Prowosma retries by itself with growing pauses; after several tries the meeting shows a failure — start the server, press **Retry** |
| "No speech was found in the recording" | Silence, or the meeting audio wasn't captured | Check the tab audio box; record again or upload a transcript |
| "The recording is no longer stored" | The audio passed its deletion time before it could be transcribed | Record again, or upload a transcript or recording |

## Limits
3-minute pieces; 6 MB per piece; 25 MB per uploaded file; 400 MB and 1000 pieces per recording. Speech recognition makes mistakes — more with accents, noise and crosstalk — and every generated statement still links back to the transcript line it came from so people can check it.

## Cost, honestly
Turning audio into text costs **$0** with your own Whisper server (beyond the VPS you already pay for) or per hour of audio with a hosted service. The summary/minutes/action step afterwards still uses your AI provider key, exactly as for any other transcript.

## Not yet verified by the developers
This was tested against **scripted** speech-to-text servers and a simulated browser. It has **not** been run against a real Whisper server, a real browser's tab capture, or a real meeting. Do one real test meeting (and one upload) before relying on it.
