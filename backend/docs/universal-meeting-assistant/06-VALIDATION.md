# Universal AI Meeting Assistant — Validation, tests and benchmarks

Everything below was run in this work session on a 4 vCPU / 16 GB Linux container with no GPU. "Simulated" means a scripted stand-in replaced an engine; "real" means the actual engine ran.

## 1. Automated tests

| Suite | Result | Notes |
|---|---|---|
| New backend tests `uma.UmaApiTest` (14) | **14 passed** | Full HTTP API + embedded MongoDB. Speech-to-text and AI are *simulated* (scripted replies), so these prove our pipeline, validation, permissions and task creation — not engine quality. |
| New backend tests `uma.UmaLogicTest` (10) | **10 passed** | State machine, evidence/owner/deadline rules, nearby-owner suggestion, wrong-line correction, stable IDs, provider detection, operator address rules, splitter plan, exports. |
| Whole backend suite (regression), final code | **718 passed, 0 failed** | Includes **229 tests of the existing Meeting Assistant**, unchanged. |
| New frontend tests (10) | **10 passed** | Page (simulated API): empty state, setup warnings, consent gate, line references, owners never pre-assigned, task only on approval, failure + retry, "not in transcript" answers. Sidebar: item hidden when flag off or on error, shown when on; old item still there. |
| Whole frontend suite | **494 passed, 10 failed** | The 10 failures are `Login.twoFactor.test.jsx`; they fail identically on `main` without these changes. |

What the API tests cover: flag off → 404 and nothing stored · upload → transcribe → analyse → review → approve → **a real task in the existing task module** (once, even when approved twice) → edit owner → bulk approve → meeting completed · exports (Markdown with line refs, Word, JSON) · Ask AI with and without evidence · imported transcript keeps speakers and skips transcription · speech-to-text auth failure → plain message → retry resumes · AI failure → retry re-runs analysis only · unreadable AI output → one repair → reported · consent / file type / empty file rules (nothing half-created) · damaged audio → plain reason · meeting links (Zoom detected, `javascript:` refused) · other workspace gets 404 · private until shared, members can't approve · viewers can't add · delete keeps created tasks.

## 2. Real end-to-end: recording, API

Fixture: an 83-second, two-voice English meeting (synthetic voices) containing: a status update; **Ravi will complete the authentication API by Friday**; **decided to launch on 20 November if the security review passes**; a risk (the image-delivery contract isn't signed); **an unowned follow-up with procurement this week**; **"I can draft the redirect plan… by Wednesday" — "Thank you Jordan"**; an open question (separate staging for marketing).

Engines: speech-to-text = `tools/stt-server` (faster-whisper `small`, int8, CPU), model = llama.cpp server. Backend run from the real jar with a real MongoDB.

Observed, in order:

1. Workspace flag off → `404 FEATURE_DISABLED` with "An admin can turn it on under Admin Centre → Feature flags".
2. Flag on → `/status`: transcription ready, AI ready, ffmpeg present.
3. First upload **failed with a clear message** — the speech-to-text client only accepted https; our own server was on `http://`. Fixed by giving operator-configured engines their own client (07-SECURITY-REVIEW). The user-facing failure and **Retry** worked as designed: retry → *Processing* → transcribed → analysed → "Your meeting summary is ready."
4. Transcript: 11 lines, accurate except one name ("Priya" → "Pre-Year").
5. Approve → task created in **Tasks** with the confirmed assignee, due 20 Nov, note "From the meeting … transcript lines #4, #5". Approving again returned the same task.
6. Ask AI "Who is drafting the redirect plan and when?" → "Jordan is drafting the redirect plan and will share it by Wednesday." [#8]. "What is the budget?" → "This meeting's transcript doesn't clearly answer that." (no guess).
7. Exports: Markdown, Word, JSON, text all downloaded and correct.

## 3. Real end-to-end: browser

Real Chromium → Vite dev server → the same live backend and engines (nothing mocked). Signed in through the login page, the **AI Meeting Assistant** menu item was present (flag on), uploaded the recording through the dialog (upload refused until the consent box was ticked), watched *Processing* → *Ready for review*, opened the action items, clicked a line reference (jumped to and highlighted line #5), asked a question, created a task from the UI, exported a Word file. **No console or page errors.** Screenshots: `img/`.

One Ask AI answer over-connected two facts ("depends on the security review passing **and the contract being signed**", citing #5 and #6). It is listed as a residual risk; the line references make it checkable.

## 4. Quality benchmark (real engines)

Two fixtures, scored by hand-written ground truth:
- **Recording** (above): 1 decision, 3 actions (2 with owner + date, 1 with neither), 1 risk, 1 question.
- **Import**: a WebVTT standup with named speakers: 1 decision ("we agreed yesterday to ship 2.4 on the 25th"), 2 actions (Jordan: regression suite by Thursday; Ravi: chase design today), 1 blocker, 1 open question.

| Model (self-hosted, CPU) | Fixture | Runs | Decisions | Actions found | Owners right / **wrong** | Dates right / **wrong** | Risks | Questions | Wrong-type items | Time per meeting |
|---|---|---|---|---|---|---|---|---|---|---|
| Qwen2.5-3B Q4 | Recording | 2 | 2/2 | 4/6 | 2 / **0** | 4 / **0** | 2/2 | 2/2 | 0 | 76–101 s |
| Qwen2.5-3B Q4 | Import | 2 | 0/2 | 2/4 | 0 / **0** | 0 / **0** | 2/2 | 1/2 | 4 (question or action labelled "decision") | 39–49 s |
| **Qwen2.5-7B Q4** | Recording | 2 | 2/2 | **6/6** | 4 / **0** | 4 / **0** | 2/2 | 2/2 | 0 | 130–177 s |
| **Qwen2.5-7B Q4** | Import | 2 | 0/2 | 2/4 | 2 / **0** | 1 / **0** | 2/2 | 2/2 | 0 | 55–73 s |

Earlier 3B runs on the recording before the grounding and prompt improvements found 1–2 of 3 actions, with owners present in 0–1 of them.

Reading the numbers:
- **No wrong owner and no wrong date in any run** — the main safety goal. When unsure, fields stay empty for a person to fill in.
- The 7B model found every action in the recording, with correct owners and dates. Both models missed the import's decision because it was phrased as something agreed "yesterday", and both missed one of its two actions. A hosted model is expected to do better; it could not be measured without a key.
- The validator's stricter grounding (cited lines must share words with the claim) corrected a wrong line reference from the 3B model (line 8 → line 4) and drops claims with no support.
- These are two short meetings; treat the numbers as a smoke test, not a benchmark of record. A pilot with real meetings is the real test.

## 5. Speed

| Step | Measured |
|---|---|
| Speech-to-text, faster-whisper `small` int8, 4 vCPU | 83 s of audio in **~15 s** (≈ 5.4× faster than real time), ~775 MB RAM |
| Recording upload → transcript ready (incl. queue poll) | 16–21 s |
| Qwen2.5-3B Q4 on 4 vCPU | ~46 prompt tokens/s, ~11 output tokens/s; analysis 30–60 s |
| Qwen2.5-7B Q4 on 4 vCPU | ~50 prompt tokens/s, ~5 output tokens/s; analysis 55–180 s |
| Same 3B model while a browser + dev server shared the CPUs | 1.8 output tokens/s (≈ 4 min) — give the model its own cores |
| Ask AI (3B), one question in the browser run, CPU shared with the browser | ~3 min (not timed with a free CPU) |

Not measured: 1–2 hour recordings, concurrent meetings, GPU, hosted engines.

## 6. Problems found by validation and fixed

| Found by | Problem | Fix |
|---|---|---|
| First integration test run | Spring couldn't create `UmaAi` (two constructors) — would have failed at start-up in production | Marked the injection constructor |
| Real run | Operator speech-to-text/model on `http://` refused | Separate client for operator-set addresses (http allowed, no redirects, HTTP/1.1) |
| Real run | Small models put deadlines in the description and cite the line next to the owner's name | Deadline taken from the description only if the cited line says it; owner in the adjacent line kept as a *suggestion* |
| Real import run | Small model cited a wrong line | Cited lines must share words with the claim; otherwise the clearly matching line is used or the claim is dropped |
| Browser run | Download named `meeting.docx` (filename header not readable cross-origin); title cut off on phones; dashboard listed meetings twice | Page names files from the title; layout fix; "Recent" only shows meetings not listed above |
| Code review during validation | The app's request logger would print transcripts and summaries | That path is excluded (wider finding reported) |
| Code review during validation | Duplicate-task protection relied on an index created by the old assistant | The new module declares the same index itself |
