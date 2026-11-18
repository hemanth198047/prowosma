# Universal AI Meeting Assistant

A new, independent AI Meeting Assistant: start or schedule a **Google Meet or Microsoft Teams** meeting from Prowosma, and afterwards it writes
the notes and **creates the clearly agreed tasks (and explicitly requested projects) by itself**, assigned to the invited people - the rest
waits for review. Recordings, transcripts and Fireflies work too; nothing depends on Fireflies. It runs alongside the existing Meeting Assistant, which is unchanged.

Behind the workspace feature flag **`universalMeetingAssistant`** (off by default).

| Document | Contents |
|---|---|
| [01-ASSESSMENT](01-ASSESSMENT.md) | Phase 1: the codebase, the existing assistant, the honest provider capability matrix, plan, risks |
| [02-ARCHITECTURE](02-ARCHITECTURE.md) | Diagram, states, pipeline, data model, API, module layout |
| [03-CONFIGURATION](03-CONFIGURATION.md) | Flag, environment variables, choosing and running the engines |
| [04-USER-GUIDE](04-USER-GUIDE.md) | How people use it (with screenshots) |
| [05-DEPLOYMENT](05-DEPLOYMENT.md) | What a deploy changes, steps, rollback |
| [06-VALIDATION](06-VALIDATION.md) | Tests, real end-to-end runs, quality and speed benchmarks |
| [07-SECURITY-REVIEW](07-SECURITY-REVIEW.md) | Controls, findings that need a decision, residual risks |
| [08-READINESS](08-READINESS.md) | Phase status, limitations, production checklist, proposal for the legacy assistant |
| [09-CONNECTIONS-SETUP](09-CONNECTIONS-SETUP.md) | **Google Meet, Fireflies and browser recording: what to set up and how** |
| [10-TESTING-STRATEGY](10-TESTING-STRATEGY.md) | **How it is tested: automated levels, Meet now test cases, real-account acceptance script, release gate** |
| [11-NATIVE-MEETING-INTELLIGENCE](11-NATIVE-MEETING-INTELLIGENCE.md) | **Capability assessment, gap report, automatic tasks/projects, Teams, provider matrix, acceptance scenario** |

## Files changed outside the new module

| File | Change | Why |
|---|---|---|
| `backend/.../service/FileStorageService.java` | + `openStream(fileName)` (read a stored file) | The worker reads the uploaded recording. Nothing existing changed. |
| `backend/.../config/RequestLoggingFilter.java` | skips `/api/v2/meeting-assistant` | Keep transcripts and summaries out of the logs |
| `backend/src/main/resources/application.properties` | + `app.uma.*` block | Configuration with safe defaults |
| `backend/Dockerfile` | runtime image installs `ffmpeg` | Split long recordings, detect damaged files |
| `frontend/src/App.jsx` | + 2 routes, page title | New page |
| `frontend/src/components/shell/navConfig.js`, `SidebarNav.jsx` | + menu item with a `flag` gate | Shown only when the flag is on |
| `frontend/src/pages/AdminCenter.jsx` | + flag row; flags marked `offByDefault` show off until turned on | Admins can turn it on. Also fixes the toggle for flags that have never been saved (it used to write the same value back). |
| `frontend/src/test/utils/navConfig.test.js` | allows the one new, flag-gated route | The test pins the menu |

New: `backend/src/main/java/com/prowosma/backend/uma/**`, `backend/src/test/java/com/prowosma/backend/uma/**`, `frontend/src/pages/AiMeetingAssistant.jsx`, `frontend/src/api/aiMeetingAssistant.js`, `frontend/src/hooks/useAiMeetingAssistantEnabled.js`, `frontend/src/styles/pages/ai-meeting-assistant.css`, two frontend test files, `tools/stt-server/**`, these docs.

Not changed: anything under the existing Meeting Assistant (`/api/meeting-assistant`, `MeetingAssistant*`, `meeting_*` collections, Fireflies code).
