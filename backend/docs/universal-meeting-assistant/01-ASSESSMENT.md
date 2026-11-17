# Universal AI Meeting Assistant — Phase 1: Repository assessment

Date: 2026-11-17 · Branch: `feature/universal-meeting-assistant` · Status of the existing assistant: **untouched**.

## 1. The application

| Area | What is there | Notes for the new assistant |
|---|---|---|
| Backend | Spring Boot 4 (Java 21), Gradle, MongoDB (Spring Data + `MongoTemplate`), Redis (rate limiting/cache), actuator + Prometheus + OpenTelemetry | Same stack. No relational migrations: new **collections** are additive. |
| Frontend | React 19 + Vite + React Router 7, plain CSS with design tokens (`styles/base.css`, `page-kit.css`), lucide icons, Vitest + Testing Library + axe, Playwright (`frontend/e2e`) | New route + page; reuse `PageHeader`, `StatusPill`, `ActionMenu`, page-kit classes. |
| Auth | JWT (`JwtFilter`) with per-session ids, SAML/SCIM/Auth0 SSO, API keys | New endpoints are authenticated by default (`SecurityConfig.anyRequest().authenticated()`). |
| Authorization | `RoleGuardFilter` (OWNER/ADMIN/MEMBER/VIEWER; viewers can't write), `AccessGatePolicy` (restricted "department" users only reach listed areas), `VisibilityService` (per-record visibility) | New area is closed to restricted users by default (not in their allow-list). Meeting-level access: owner, people it is shared with, whole workspace if chosen, admins. |
| Tenant isolation | `WorkspaceContext` (X-Workspace-Id → validated by `WorkspaceFilter`), `TenantGuardBeanPostProcessor` wraps repositories of `organizationId` entities | The old assistant uses `MongoTemplate` with an explicit `organizationId` in every query (`MeetingSessionStore`). The new one does the same. |
| Background work | `MeetingJobService` + `MeetingJobRunner`: a MongoDB job queue with leases (no extra infrastructure, safe with several instances) | Pattern reused, **separate collection** (`uma_jobs`): the old runner claims every job in `meeting_jobs` and would fail unknown types. |
| Run as a user in a job | `MeetingSystemContext.run(workspace, actor, …)` binds workspace + principal so existing services (e.g. `TaskService.create`) work from a job, with the tenant guard still on | Reused as-is (read-only use). |
| Speech-to-text | `SpeechToTextClient` / `OpenAiCompatibleSttClient`: `POST {base}/v1/audio/transcriptions` (OpenAI, Groq, self-hosted faster-whisper servers). Configured per workspace in `MeetingAssistantSettings` (admin) | Reused as the transcription engine interface. Settings are **read**, not changed. A self-hosted server is added in `tools/stt-server`. |
| LLM | `LlmClient` / `ConfiguredLlmClient`: workspace **AI Settings** (Anthropic, OpenAI, Gemini, custom OpenAI-compatible over HTTPS). Strict: never returns made-up fallback text | Reused as one provider. A second, operator-configured provider (self-hosted OpenAI-compatible, e.g. Ollama / llama.cpp, may be on localhost) is added behind a new `MeetingAiModel` interface with fallback. |
| Transcript tools | `TranscriptParser` (VTT/SRT/text with speakers), `TranscriptFileReader` (.docx etc.), `TranscriptChunker`, `PromptBuilder.neutralize` (prompt-injection fencing), `DeadlineResolver` ("by Friday" → date, never guessed), `NameMatcher` (spoken name → member, ambiguity kept) | Pure functions — reused unchanged. |
| Tasks | `TaskService.create` + `Task.sourceMeetingId/sourceActionKey` (duplicate-proof creation, used by the old assistant) | Reused. New key prefix `uma:` so the two features can never collide. |
| Files | `FileStorageService` (local or S3, virus scan, signed URLs) | Reused for recordings. **One additive method** (`openStream`) is needed: S3 files can't be read back today. |
| Feature flags | `WorkspaceConfig.featureFlags` (map per workspace), edited in Admin Centre → Feature flags (`/api/admin/features`) | New flag `universalMeetingAssistant`, **off by default**. |
| Notifications / audit | `NotificationService`, `ActivityLogService`, meeting audit (`MeetingAuditEvent`) | New audit collection `uma_audit` (content-free events). |

## 2. The existing meeting assistant (left exactly as it is)

- Endpoints: `/api/meeting-assistant/**`, `/api/admin/meeting-assistant/**`, `/api/meeting-action-items/**`, `/api/meetings/**`. Page: `/meeting-assistant`.
- Data: `meeting_sessions`, `transcript_segments`, `meeting_artifacts`, `meeting_jobs`, `meeting_audio_chunks`, `meeting_actions`, … (≈ 25 model classes, ≈ 7 000 lines of services).
- **Fireflies is not a requirement of the old feature.** It is one optional source (18 classes reference it). Without Fireflies the old assistant already supports: transcript upload/paste, in-browser recording + self-hosted speech-to-text, Google Meet and Teams transcript import, AI documents, action extraction, task/project creation.
- What makes it confusing: many capture paths and admin settings on one screen, three documents (Summary/MOM/Notes) plus Actions plus Projects tabs, and several integrations that its own documentation marks as **not yet verified** (Google/Teams import, real-model output).

**Decision:** build the new assistant as a separate module (`com.prowosma.backend.uma`, `/api/v2/meeting-assistant`, collections `uma_*`, page `/ai-meeting-assistant`) that **reuses the pure building blocks** above and shares no mutable state with the old one. Nothing in the old feature is modified, renamed or removed.

## 3. Provider capability matrix (honest)

Legend: **Verified** = run successfully by us against the real service · **Implemented** = code + simulated tests, not yet run against a real account · **Possible** = officially supported by the provider, not built · **No** = not offered officially.

| Capability | Google Meet | Microsoft Teams | Zoom | Webex | Any platform |
|---|---|---|---|---|---|
| Upload a recording (MP3/WAV/M4A/MP4/WebM) → our transcription | n/a | n/a | n/a | n/a | **Verified** (self-hosted faster-whisper, see §5) |
| Import a transcript (paste / .vtt / .srt / .txt / .docx) | n/a | n/a | n/a | n/a | **Verified** (WebVTT with speakers, real model — see 06-VALIDATION) |
| Fetch the provider's own transcript after the meeting | Possible — Meet REST API `conferenceRecords.transcripts` (Workspace editions with transcription; user OAuth) — old feature has an unverified implementation | Possible — Graph `onlineMeetings/{id}/transcripts` (app permission + admin consent + application access policy) — old feature has an unverified implementation | Possible — Cloud Recording API (`/meetings/{id}/recordings`, audio transcript on paid plans; webhook `recording.completed`) | Possible — Meetings API `meetingTranscripts` (requires transcription enabled) | — |
| Fetch the recording file after the meeting | Possible (recordings saved to Drive) | Possible (Graph recordings, same permissions) | Possible (Cloud Recording download) | Possible (Recordings API) | — |
| Join live as a bot | No general bot API (Meet Media API is in limited preview) | Only with a Windows-hosted real-time media bot (Graph Communications) | Meeting SDK bot — needs Zoom app review for external meetings | Limited | — |
| Capture in the user's browser (tab audio, with consent) | Technically possible for any tab (Chrome/Edge `getDisplayMedia` with tab audio) — the old feature has it; not yet part of the new one | same | same | same | — |
| Calendar discovery | Google Calendar API (OAuth) — Possible | Microsoft Graph calendar — Possible | via the user's calendar | via the user's calendar | — |

The new assistant labels each provider in its UI with exactly one of these states. **No provider is shown as "live" until it is verified.**

## 4. Plan

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 | This assessment | Written, reviewed |
| 2 — Foundation | Feature flag; `/api/v2/meeting-assistant`; collections; state machine; job queue; provider adapter interface + capability registry; dashboard | Backend tests green; old-feature regression tests green |
| 3 — Core vertical slice | Upload recording → transcribe → summary, notes, decisions, actions, risks, questions → review → approve → **existing task created** (idempotent) → export (Markdown, text, JSON, Word, PDF) · transcript import · Ask AI (grounded) | Works with a real self-hosted STT and a real local LLM, end to end, without Fireflies or any meeting provider |
| 4 — Providers | Adapters for Google Meet, Teams, Zoom, Webex (post-meeting transcript/recording fetch first), calendar connect | Each provider verified against a real account before it is labelled "supported" — **needs your accounts/credentials** |
| 5 — Intelligence | Cross-meeting search and Q&A, follow-ups, recurring meetings, project insights | |
| 6 — UX/perf | Polish, load tests | |
| 7 — Production validation | Security review, perf, E2E, regression, rollout checklist | Your approval |

## 5. Engine choices (measured where stated)

- **Transcription:** faster-whisper (CTranslate2) behind the OpenAI-compatible API (`tools/stt-server`). Measured here (4 vCPU, no GPU, model `small`, int8): 83 s English recording → **15.4 s** (≈ 5.4× real time), ~775 MB RAM, 1 mis-heard name in 13 segments. `medium`/`large-v3` are more accurate and slower; a GPU makes them real-time. Whisper supports Hindi, Telugu, Tamil, Kannada (quality on these is not yet measured).
- **Speaker diarization:** not available in the self-hosted MVP (needs pyannote + a gated model and accepted licence). Recordings show **"Unknown speaker"**; imported transcripts keep the speaker names the file states. Names are never invented.
- **LLM:** workspace AI Settings provider (any vendor) and/or an operator-hosted OpenAI-compatible model (Ollama, llama.cpp, vLLM). Primary + fallback, JSON output validated against a schema, evidence line numbers checked against the transcript.

## 6. Risks and assumptions

1. **Provider integrations need real accounts** (Google Workspace with transcription, a Microsoft 365 tenant + admin consent, Zoom paid plan + app review, Webex with transcription). Until you provide them, providers stay "Possible/Implemented", never "Supported".
2. **Live bots** are expensive and policy-restricted on every platform; the recommended path is post-meeting import + upload + browser capture.
3. Local LLMs that fit a CPU are noticeably weaker than hosted models; output is still validated, so weak output is dropped rather than invented.
4. Recordings are large; uploads are limited (default 500 MB) and transcribed in chunks.
5. Legal: recording consent is required by law in many places; the UI requires the uploader to confirm participants were informed.
