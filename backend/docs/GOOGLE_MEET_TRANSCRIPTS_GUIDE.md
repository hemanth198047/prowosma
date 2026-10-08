# Getting a transcript out of Google Meet

(The same guide is built into Prowosma: on the **Add a meeting** form, and on any Google Meet meeting that is waiting for a transcript or failed because none existed.)

## The most common mistake
**Captions are not a transcript, and Gemini's "Take notes for me" is not a transcript.** Captions are live subtitles that are never saved. Gemini's notes are a summary document. Prowosma imports a *transcript* — and Google only creates one if someone clicks **Start transcription** during the meeting.

## The short version
1. Use a **computer** (not the Meet phone app) and a Google account that has Meet transcripts (a Google Workspace account).
2. In the meeting: **Activities → Transcripts → Start transcription → Start.**
3. Wait for the **"Transcribing"** badge at the top left. Hold your meeting.
4. At the end, **make sure everyone has left** the call. Prowosma imports the transcript a few minutes later.

## 1. Check you can use transcripts (once)
- **Account.** Saved transcripts are a Google Workspace feature — e.g. Business Standard/Plus, Enterprise, Education Plus, the Teaching and Learning Upgrade, Workspace Individual. Google has said they are **not available on personal Google accounts** (@gmail.com). If *Activities* shows no *Transcripts* option, your account doesn't have it.
- **Administrator.** Workspace admins can switch transcripts off. Ask your admin to check the Google Meet settings in the Admin console.
- **Language.** A limited set (English, French, German and a few others Google has added).
- **Device.** Start it from a computer in a browser; the mobile app can't.
- **Who can start it.** If host management is off, anyone in the host's organization; if on, only the host and co-hosts. Outsiders can't.
- **Storage.** Transcripts are saved to the organizer's Google Drive.

## 2. Use the right Google account in Prowosma
Google saves the transcript for the **organizer**; Prowosma reads it with the Google account *you connected* (Integrations → Meeting Platforms). Connect the organizer's account, or one that attended. If you start an instant meeting (e.g. meet.google.com/new) you are the organizer.

## 3. During the meeting — every click
1. Start or join the meeting in a browser on a computer.
2. Bottom right: click **Activities** (the icon of small shapes). If it isn't there, click the three dots **⋮ More options** first.
3. Click **Transcripts**.
4. Click **Start transcription**.
5. In the box, click **Start** (Meet tells everyone the meeting is being transcribed).
6. Check the **"Transcribing"** badge at the top left.
7. Hold your meeting.
8. **Activities → Transcripts → Stop transcription → Stop** (ending the meeting also stops it).
9. **End the meeting for everyone** and make sure every participant has left — including other tabs or phones. Google only marks a meeting finished when the last person leaves.

You can stop and start again; each start is a separate transcript and Prowosma joins them in order.

## 4. After the meeting
Google emails the organizer a link; the transcript is a Google Doc in the organizer's Drive (*Meet Recordings*), usually a few minutes after the meeting ends. Prowosma checks every few minutes, or press **Check Google Meet now** on the meeting. The meeting page shows exactly what Google answered at the last check.

## 5. Start automatically (optional)
Hosts can have transcription start by itself for scheduled meetings: open the event in Google Calendar → the Google Meet settings next to the link → turn on transcription if offered (depends on edition and admin settings).

## 6. If it didn't work
| What the meeting page says | Meaning | What to do |
|---|---|---|
| "Google has no record of this meeting under the connected Google account" | Wrong Google account connected, wrong link, or the meeting hasn't ended | Connect the organizer's account; check the link; wait a few minutes |
| "Google still shows this meeting as running" | Someone is still in the call (another tab, a phone) | Make sure everyone has left, then **Check Google Meet now** |
| "Google has no transcript for it" | A transcript wasn't started during the meeting | Upload the transcript, or start one next time |
| "Transcription is still running" | Transcript not stopped | Stop transcription / end the meeting for everyone |
| "Google is still preparing the transcript file" | Normal; a few minutes | Wait — Prowosma retries by itself |
| "personal Google account" note | Google doesn't offer saved Meet transcripts on personal accounts | Use a Workspace account or upload |
| "may be incomplete" on the transcript | Transcription started late / stopped early | Check the note; upload a fuller one if needed |

## 7. No transcript? Upload one
Open the transcript Google Doc → **File → Download → Plain text (.txt)** → in Prowosma open the meeting → **Add transcript** (upload or paste). Up to 5 MB; .txt, .vtt and .srt.

---
*Based on Google's help page "Use transcripts with Google Meet" (https://support.google.com/meet/answer/12849897). Google can change which accounts and menus have this feature.*
