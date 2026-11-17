# AI Meeting Assistant — Testing strategy

How to prove the AI Meeting Assistant works, from code to a real meeting, including **Meet now** (instant meetings). What is
automated runs on every change; what needs real Google / Fireflies accounts and people in a meeting is a short manual script.

## 1. Principles

- **Stand-ins prove our logic, never the outside service.** Automated tests use scripted Google, Fireflies, speech-to-text and AI
  (`Uma*Fake` classes, mocked API in the frontend). A feature is only called *working* after it has run against the real service (§6).
- **Every automatic step must be visible and recoverable**: each test checks what the person sees (status, message, next check) and that
  Retry / Check now / a second source can recover.
- **Safety properties are tested on every run**: no invented owners or dates, nothing created without approval, no cross-workspace access,
  secrets never returned or stored in plain text, one task per approved item, one meeting per calendar event.

## 2. Test levels

| Level | What | Tool | Where | When |
|---|---|---|---|---|
| Unit | Pure rules: evidence and owner/date checks, state machine, provider detection, operator URL rules, exports | JUnit | `backend/src/test/.../uma/UmaLogicTest.java` | every build |
| API integration | Whole flows through HTTP with a real embedded MongoDB and scripted outside services | Spring MockMvc + Flapdoodle | `.../uma/UmaApiTest.java` (+ `UmaFakes`, `UmaFirefliesFake`, `UmaGoogleFake`, `UmaGoogleHttpFake`) | every build |
| Regression | The whole backend, incl. 229 tests of the existing Meeting Assistant | Gradle | `backend` | every build |
| Frontend components | Pages and dialogs with a mocked API | Vitest + Testing Library | `frontend/src/test/pages/AiMeeting*.test.jsx`, `components/AiMeeting*.test.jsx`, `SidebarNav.aiMeetingAssistant.test.jsx` | every build |
| Browser, simulated | Real Chromium against the real frontend, API answered by a script - layout, flows, no console errors, phone width | Playwright | scripts in the session notes; add to CI as `e2e/` | before a release |
| Browser + engines, real | Real Chromium → real backend → real speech-to-text and AI model; real Fireflies import | Playwright + local `start-all` | 06-VALIDATION | before a release, after engine changes |
| Real services (UAT) | Real Google Workspace, real Fireflies, real people in a Meet | manual script §6 | your accounts | once per environment, then after changes to these integrations |
| Non-functional | Security, resilience, performance (§7) | mixed | | before production |

### How to run

```bash
cd backend && ./gradlew test --tests 'com.prowosma.backend.uma.*'   # the AI Meeting Assistant only (~1 min)
cd backend && ./gradlew test                                         # everything (~10 min)
cd frontend && npx vitest run                                        # all frontend tests
```
On Windows use `gradlew.bat`. Known unrelated failures: 10 tests in `Login.twoFactor.test.jsx` fail on `main` too.

## 3. What the automated tests cover

| Area | Covered by (test name) |
|---|---|
| Flag off → nothing reachable, nothing stored | `offByDefault_everyEndpointSaysSoAndNothingIsStored`; sidebar tests |
| Upload → transcribe → summary → approve → task (once) → export → Ask AI | `recordingToApprovedTask_withoutAnyMeetingProvider` |
| Imported transcript, speakers kept | `importedTranscript_isAnalysedWithSpeakers` |
| Failures explained and recoverable | `sttFailure_isExplainedAndRetryResumes`, `aiFailure_retryOnlyRedoesTheAnalysis`, `unparseableAiOutput_isRepairedOnceThenReported`, `damagedAudio_failsWithAPlainReason` |
| Browser recording | `browserRecording_*` (3), `AiMeetingRecorder.test.jsx` |
| Fireflies key, import, live notetaker | `fireflies_*` (3) |
| Google sign-in (PKCE, single use, encrypted tokens) | `signInGoogle()` inside the scheduling tests |
| Scheduling a Google Meet | `scheduleAMeetMeeting_firefliesJoinsAtTheStart_andTheTranscriptArrivesByItself`, `scheduling_needsGoogleCalendar` |
| **Meet now (instant)** | `instantMeeting_startsNow_invites_firefliesJoinsAfterAMinute_andTheSummaryArrives`, `instantMeeting_withoutFireflies_stillCreatesTheMeetAndWaitsForGoogle`; frontend `Meet now` (4 tests) |
| Calendar auto-import, reschedule, cancel, no duplicates | `calendarImport_addsUpcomingMeetMeetingsOnce_andFollowsChanges` |
| Fireflies waits until the meeting runs; can be switched off | `autoFireflies_waitsUntilTheMeetingHasReallyStarted`, `autoFireflies_canBeSwitchedOffForAMeeting` |
| Meeting ends early; label; Check now | `meetingThatEndsEarly_isCheckedSoon_labelledHonestly_andCanBeCheckedNow` |
| One source giving up doesn't fail the meeting | `oneCaptureRouteGivingUp_doesNotFailTheMeetingWhileTheOtherIsOnItsWay` |
| Access: tenants, private by default, viewers, approvals | `otherWorkspaceCannotSeeOrTouchIt`, `privateUntilShared_andOnlyTheAdderOrAnAdminCanApprove`, `viewerCannotAddMeetings` |
| No invented owners/dates; evidence must support claims | `UmaLogicTest` (ownersAndDeadlinesAreNeverInvented, citedLinesMustActuallySupportTheClaim, …) |

## 4. Meet now (instant meeting) — test cases

Prerequisites for the manual cases: flag on; your Google account connected under Connections with Calendar allowed; for the Fireflies
cases, Fireflies connected. "A" = automated (covered in §3), "M" = manual (§6).

| ID | Scenario | Steps | Expected | Type |
|---|---|---|---|---|
| IM-01 | Happy path | Meet now → invite one colleague → Start meeting | New tab opens on the Meet link; event in your Google Calendar starting now, 30 min; colleague receives Google's invitation; Prowosma shows the meeting as "Waiting for transcript" with "Open the meeting now. Fireflies' notetaker asks to join in about a minute - admit it." | A + M |
| IM-02 | Fireflies joins | Stay in the Meet ~1 minute | Fireflies asks to join; you admit it; in Prowosma the note changes to "Fireflies is in the meeting…" within ~5 min | M |
| IM-03 | Summary arrives | Talk 3–5 min, include a decision and "<name> will <do X> by <day>"; leave | Within ~5–10 min after the end: "Your meeting summary is ready."; decision listed; action with owner suggested and date resolved; each with line references | A + M |
| IM-04 | Ends early | Choose 60 min, end after 5 | Picked up a few minutes after the real end (not after 60 min); "Check now" fetches immediately | A + M |
| IM-05 | Nobody opens Meet | Start, close the new tab, don't join | Fireflies retries for 20 min, then the note says it couldn't join; no false "ready"; meeting can still get a recording/transcript added | A (retry) + M |
| IM-06 | Host doesn't admit Fireflies | Join, ignore Fireflies' request | Fireflies gives up on its side; Prowosma keeps waiting, then after 1 h says very short/unadmitted meetings may get no transcript; Google transcript still used if transcription was on | M |
| IM-07 | Fireflies off | Untick Fireflies → Start | No Fireflies join; Google transcript is looked for from 10 min after the start; "Record meeting" can be used instead | A |
| IM-08 | Fireflies not connected | (no key) Meet now | Dialog says to connect Fireflies or use Record meeting; meeting still starts | A |
| IM-09 | Google not connected | Meet now | Dialog: "Connect your Google account first" + Open Connections; nothing created | A |
| IM-10 | Calendar not allowed | Connect Google without ticking Calendar → Meet now | Dialog explains and asks to reconnect with Calendar | A |
| IM-11 | Popup blocked | Block popups for the site → Start meeting | Dialog "Your meeting is ready" with a Join button; meeting created once | A + M |
| IM-12 | Creation fails | Google down / revoke access → Start meeting | Empty tab closed; plain message (e.g. "Google asked for a new sign-in" → reconnect); nothing half-created | A (frontend) + M |
| IM-13 | Invalid invitee | Invite "abc" | "“abc” isn't an email address."; nothing created | A |
| IM-14 | Double click | Click Start meeting twice quickly | Button disabled while working; one meeting | M |
| IM-15 | Default title & time zone | Leave title empty (browser in IST) | Title "Instant meeting - 17 Nov, 19:40" in your local time; Calendar event in your time zone | A + M |
| IM-16 | Transcription on in Meet, Fireflies off | Turn on Meet transcripts, talk, leave | Google's transcript imported with participants' names | M |
| IM-17 | Both sources | Fireflies on + Meet transcription on | First transcript to arrive is used; the other stops quietly; no duplicate meeting or tasks | A (interplay) + M |
| IM-18 | Cancel while waiting | Meeting menu → Stop processing / Delete | Waiting checks stop; nothing joins afterwards | A (calendar-cancel path) + M |
| IM-19 | Permissions | A viewer, or a user of another workspace | Viewer can't start one; other workspace can't see it | A (general access tests) + M |
| IM-20 | Approve tasks | From the summary, approve one action | Task appears in Tasks with assignee/date/project; approving again doesn't duplicate | A + M |
| IM-21 | Phone width | Open the dialog on a phone | Fits the screen; no sideways scrolling | M (browser) |
| IM-22 | Join button | Open the meeting in Prowosma during its time | "Join meeting" button shown only between start and end | M |

The same matrix applies to **Schedule a Google Meet** (replace "starts now" by the chosen time; Fireflies joins at the start time instead
of after one minute) and to **calendar auto-import** (add: rescheduled → moves; cancelled → cancelled; colleague has the same event →
one meeting, shared).

## 5. Other entry points — key cases

| Entry | Must prove | Type |
|---|---|---|
| Upload recording | Consent required; formats accepted/refused; long file split; retry resumes; recording deleted after retention | A + real engines |
| Import transcript | VTT/SRT/TXT/DOCX/paste; speakers kept when labelled ≥2 times | A + real |
| Record meeting (browser) | Tab + mic in pieces; pieces after Stop refused; abandoned recording finished after 10 min; real tab picking works in Chrome and Edge | A + **M** |
| Import from Fireflies | Each Fireflies meeting once; private/empty ones explained | A + real (done) |
| Add meeting link | Honest "how it gets captured" text; Fireflies auto-join choice; Google checks if connected | A |
| Review | Owners only suggested from first names; dates only when said; nothing created without approval; edits kept on regenerate | A |
| Ask AI | Answers cite lines; "doesn't clearly answer" when not in the meeting | A + real |
| Export | Word/PDF/Markdown/text/JSON contain line refs; file named after the meeting | A + browser |
| Sharing | Private by default; share with workspace; only creator/admin manage | A |

## 6. Real-service acceptance script (UAT)

Run on the target environment with real accounts. Record date, environment, who, pass/fail and notes.

**Setup check (5 min)**
1. Admin Centre → Feature flags → AI Meeting Assistant (new) is on; the menu item appears; log out and in → still there.
2. Connections → Google: "Connected as …", Calendar allowed. Fireflies: connected.
3. Status: `GET /api/v2/meeting-assistant/status` shows transcription and AI ready (or accept that recordings can't be transcribed).

**Meeting script** — read aloud by two people (gives a known ground truth for scoring):
> A: "This is the launch check-in. Decision: we ship version 2.4 on the 25th."
> B: "I'll run the regression suite by Thursday."  A: "Ravi, can you chase design for the screenshots today?"
> B: "Risk: the app store screenshots aren't ready." A: "Open question: do we need a legal review for the new terms?"

**Runs**
| # | Run | Pass when |
|---|---|---|
| U1 | IM-01 → IM-03 with the script | Summary ready ≤ 10 min after the end; decision, 2 actions, risk, question found; no wrong owner or date |
| U2 | IM-04 (end early) | Picked up within ~5 min of the real end |
| U3 | IM-06 (don't admit Fireflies), transcription off | Meeting says what happened; nothing invented |
| U4 | IM-16 (Meet transcription on, Fireflies off) | Google transcript with names |
| U5 | Schedule a Google Meet 5 min ahead with Fireflies | Fireflies joins at the start time |
| U6 | Calendar auto-import: create a Meet event in Google Calendar directly | Appears in Prowosma within 10 min (or after "Check my calendar now"); reschedule and cancel follow |
| U7 | Record meeting in Chrome and in Edge, choose the Meet tab, share tab audio | Transcript with your name on your lines |
| U8 | Approve two actions | Two tasks in Tasks; approve again → still two |

## 7. Non-functional

| Area | Checks |
|---|---|
| Security | Run the security review checklist (07-SECURITY-REVIEW): tokens/keys never in API responses or logs (search logs for a known test key); OAuth state single-use and expiring; redirect URI exact; private-by-default; cross-workspace 404; request-logging exclusion of `/api/v2/meeting-assistant` |
| Resilience | Stop the speech-to-text server mid-transcription → retries, then plain failure + Retry resumes; restart the backend while jobs wait → they continue (lease); Fireflies/Google return 429/5xx → retried later |
| Performance | 60-minute recording on the production engines: time to summary; 20 meetings processed in parallel; dashboard with 300 meetings loads < 2 s; job polling doesn't load MongoDB (check slow-query log) |
| Accessibility | Keyboard-only: open Meet now, fill, start; screen reader labels on dialogs, tabs, check buttons; colour contrast in light and dark |
| Compatibility | Chrome, Edge (recording needs these); Safari/Firefox for everything except recording; phone width 390 px |

## 8. Quality measurement (AI output)

Use the meeting script above (and 3–5 real, consented meetings). For each run count: decisions found / expected, actions found /
expected, **owners wrong**, **dates wrong**, items in the wrong category, statements dropped for missing evidence. Release bar we
propose: **0 wrong owners, 0 wrong dates**, ≥ 80 % of actions found with the production AI model. 06-VALIDATION has the numbers so far
(self-hosted 3B/7B models on CPU).

## 9. Release gate

- [ ] All automated tests green (apart from the known `Login.twoFactor` failures on `main`)
- [ ] UAT U1–U8 passed on the target environment and recorded
- [ ] Security checks of §7 passed; the request-logging decision taken
- [ ] Quality bar of §8 met with the production AI model
- [ ] Rollback rehearsed: flag off hides everything; previous build redeploys cleanly
