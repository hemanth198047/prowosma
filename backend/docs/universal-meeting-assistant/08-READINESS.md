# Universal AI Meeting Assistant — Limitations, readiness and the legacy assistant

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 1. Assessment | **Done** | 01-ASSESSMENT |
| 2. Foundation (flag, routes, APIs, collections, provider abstraction, state machine, dashboard) | **Done** | 02-ARCHITECTURE; tests |
| 3. Vertical slice: upload → transcription → summary → decisions → actions → approval → existing task creation, without Fireflies or a meeting provider | **Done and validated with real engines** | 06-VALIDATION §2–4 |
| 4. Provider integrations | **Partly.** Browser recording (any app): built, pipeline verified with real Chromium audio; tab picking needs a person. Fireflies: import **verified with your real account**; live notetaker built (needs a running meeting to verify). Google Meet transcripts: built and tested against a scripted Google API; **needs your Google OAuth client to verify**. Teams/Zoom/Webex fetch and calendars: not started (need vendor apps and admin approval). | 06-VALIDATION §6, 09-CONNECTIONS-SETUP |
| 5. Ask AI (one meeting) | **Done** | 06-VALIDATION |
| 5. Cross-meeting intelligence (search and questions across meetings, recurring topics, open-action follow-up) | **Not started** | — |
| 6. UX and performance | **Partly** — new page, mobile layout, progress and recovery; no load test | 06-VALIDATION §5 |
| 7. Production validation | **Not done** — needs a pilot workspace on a deployed environment | checklist below |

## Known limitations

1. **Prowosma has no bot of its own that joins meetings.** Live capture works through the Fireflies notetaker (your subscription) or by recording the meeting tab in the browser.
2. **No speaker identification for recordings** (no diarization). Lines show "Unknown speaker"; owners still come from names said aloud.
3. **Quality depends on the AI model.** With the small self-hosted models we could test, the assistant missed some action items and occasionally labelled a statement as the wrong kind (e.g. a question as a decision). It did not invent owners or dates in any run. A hosted model (AI Settings) was not measured — no key was available.
4. **The executive summary is not line-checked** the way decisions and actions are; it is written from the same transcript but can over-state. Every other statement carries line references.
5. **Ask AI covers one meeting at a time.**
6. **Transcript import files up to 1 MB** through the file picker (the app's general upload limit); paste longer transcripts as text.
7. **Hindi, Telugu, Tamil, Kannada** are supported by Whisper but their accuracy was not measured here.
8. **No live progress push** — the page refreshes every 4 seconds while processing.
9. **Performance on CPU**: a 7B model needs several minutes per meeting on 4 shared vCPUs; a GPU or a hosted model is recommended for more than a handful of meetings a day.

## Production readiness checklist

- [x] Feature flag, off by default; server kill switch
- [x] Existing Meeting Assistant untouched (its 229 backend tests pass)
- [x] Full backend suite passes (718 tests) — frontend suite passes except 10 Login 2FA tests that also fail on `main`
- [x] Tenant isolation, private-by-default access, role checks tested
- [x] Idempotent task creation (unique index + race handling)
- [x] Failure messages with recovery hints; retry resumes; stuck jobs re-queued
- [x] Consent capture; recording retention; delete removes content
- [x] No meeting content in audit trail or request logs
- [x] Real end-to-end run with real speech-to-text and a real model (browser and API)
- [ ] **You decide the engines** for production: hosted AI provider vs self-hosted model; self-hosted vs hosted speech-to-text
- [ ] Deploy `tools/stt-server` (or configure a hosted engine) and set `UMA_*` variables
- [ ] Pilot in one workspace with real meetings for 1–2 weeks; review missed/incorrect items with the users
- [ ] Decide on the request-logging finding (07-SECURITY-REVIEW §1)
- [ ] Load test with long recordings (1–2 h) on the production engine
- [ ] Legal sign-off on recording consent wording for your regions
- [ ] Google Cloud OAuth client created by your Workspace admin (09-CONNECTIONS-SETUP §3) and one real Meet meeting fetched
- [ ] Fireflies key saved under Connections; one live meeting with the Fireflies notetaker
- [ ] One real browser recording of a meeting tab (Chrome/Edge)

## Proposal: the legacy Meeting Assistant

Not to be done without your explicit approval — nothing below has been changed.

1. **Now:** run both side by side. The new one is behind its own flag; the old one keeps its menu item and data.
2. **After a successful pilot:** add a "Try the new AI Meeting Assistant" link on the old page for workspaces where the flag is on.
3. **Optional data move:** a one-off, read-only copy of old sessions that have transcripts into `uma_*` (old data left in place). Only if users ask to see old meetings in the new view.
4. **Retire:** when no workspace uses the old page for, say, 60 days — hide its menu item first, keep its data and APIs for a further period, then remove the code. The new module already declares the task duplicate-protection index itself, so removing the old code does not weaken it.
5. **Keep from the old feature:** browser tab capture and the Fireflies import are worth porting to the new module as additional sources if users rely on them.
