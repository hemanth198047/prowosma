# Fireflies.ai notetaker — Google Meet, Zoom, Teams, Webex (any account)

Google Meet and Microsoft Teams only hand Prowosma a transcript when the account has that feature, and Prowosma's own recording needs someone to start it. **Fireflies is a third way: its notetaker joins the meeting as a participant, transcribes it, and Prowosma brings the finished transcript back** — for Google Meet, Zoom, Teams and Webex, with any account (a personal Gmail included). It is **off until an admin turns it on**, and nothing about the Google Meet / Teams import or the recording feature changes.

## How it works
1. A person starts their meeting, pastes its link into Prowosma (Meeting Assistant → *Fireflies notetaker*) and presses **Send notetaker**. They confirm that everyone in the meeting knows a notetaker will join.
2. Prowosma asks Fireflies to send its notetaker into that running meeting. It appears as a participant (named "Fireflies" or "Fred"). **If you are the host, admit it** — it can't record until someone lets it in.
3. Prowosma checks Fireflies every few minutes (every 5 minutes at first, every 15 after two hours) for a transcript with the same meeting link. One Fireflies request serves every waiting meeting of the workspace.
4. When the meeting has ended and Fireflies has finished processing, the transcript is imported — **with Fireflies' real speaker names** — and goes through the normal pipeline: summary, minutes, action items, tasks.

Two more ways in:
- **Attach to a meeting you already registered.** On a waiting Google Meet / Teams meeting that has a link, open *No transcript? Send a Fireflies notetaker to this meeting*.
- **Import a meeting Fireflies already has** (for example one Fireflies joined from your calendar): *Already have a meeting in Fireflies? Import it* → load your recent meetings → *Import*. Nothing is sent to any meeting.

## Admin setup
1. In **Fireflies**, open *Integrations → Fireflies API* and copy your API key. (It uses *your* Fireflies account, so the notetaker's meetings count against your Fireflies plan.)
2. In Prowosma: Meeting Assistant → *Fireflies notetaker (admins)* → tick **Allow sending the Fireflies notetaker…**, paste the key, **Save**, then **Test connection** (it says which Fireflies account it reached).
3. The server needs **`ENCRYPTION_KEY`** set (the same key that protects Google tokens). The Fireflies key is stored encrypted and is never shown again. **Never change `ENCRYPTION_KEY`** while keys are saved.

## Fireflies' own limits (as documented by Fireflies when this was written — check their current pages)
| Limit | Value |
|---|---|
| Sending the notetaker | 3 requests per 20 minutes (Prowosma stops at 3 before wasting a request) |
| Free plan | about 50 API requests a day — enough for a few hours of waiting; busier workspaces should use a paid plan |
| Pro plan | about 500 requests a day |
| Business / Enterprise | about 60 requests a minute |
| Supported platforms | Google Meet, Zoom, Microsoft Teams, Webex |

When a limit is reached Prowosma **waits for the time Fireflies asks** and carries on — it never fails a meeting because of a rate limit.

## What is stored, and where
| What | Where | Notes |
|---|---|---|
| The Fireflies API key | Prowosma, encrypted | Used only to talk to Fireflies; never returned to the browser |
| The meeting link and title you give | Sent to Fireflies | So its notetaker can join |
| The transcript (speaker names, text, times) | Prowosma, like any transcript | Your transcript retention applies (90 days by default). Prowosma does **not** download the audio or video |
| Fireflies' own copy (audio, video, transcript, its summary) | **Fireflies** | Governed by Fireflies' terms and the settings of the connected account. Prowosma does not delete it — delete it in Fireflies if you wish |

## Good to know
- **The meeting has to be running** when you press Send. Fireflies refuses a meeting that hasn't started or has ended.
- **The host must admit the notetaker.** The most common reason for "no transcript" is that nobody let it in.
- The notetaker is **visible to everyone** in the meeting, and **everyone must know** it is transcribing. Prowosma makes the person confirm this.
- A transcript is matched to a meeting by its **meeting link** and its time. A transcript can only ever be imported into **one** Prowosma meeting.
- A meeting is marked as having no transcript after **6 hours** of nothing; you can then import it from your recent Fireflies meetings, upload a transcript, or send the notetaker again.

## When something goes wrong
| What the meeting or the form says | Meaning | What to do |
|---|---|---|
| "Fireflies has no transcript for this meeting yet… admitted to the meeting by the host" | The notetaker wasn't let in, or the meeting hasn't ended / finished processing | Admit it; wait a few minutes — Prowosma keeps looking |
| "has to be running right now" | The meeting hasn't started, or already ended | Start the meeting first, then send |
| "Fireflies can't join that kind of meeting" | An unsupported platform or link | Use a Google Meet, Zoom, Teams or Webex link |
| "Fireflies rejected the saved API key" | The key is wrong, was regenerated, or the account is inactive | An admin enters a new key, then **Retry** on the meeting |
| "Check the plan / account" | The Fireflies plan or account doesn't allow it | Check the Fireflies plan and that the account is active |
| "request limit was reached" | A Fireflies limit | Nothing — Prowosma waits as Fireflies asks and retries by itself |
| "3 times every 20 minutes" | Fireflies' send limit | Wait a few minutes |
| "already imported for another meeting" | That transcript is already attached to a different Prowosma meeting | Open that meeting |

## Not yet verified by the developers
This was tested against a **scripted** Fireflies, not the real service. Please run **one real test meeting and one import** before relying on it, and check in particular:
- that the transcript's **speaker names and timings** look right (the code assumes times in seconds and checks for milliseconds, but this wasn't confirmed against a real transcript),
- that Fireflies reports the **same meeting link** you pasted (this is how a transcript is matched to its meeting),
- that your Fireflies **plan** allows sending the notetaker through the API.
