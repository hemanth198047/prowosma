# Universal AI Meeting Assistant — Security and privacy review

Scope: the new module (`uma`), its endpoints, the self-hosted speech-to-text server, and the small shared-code changes. Reviewed by reading the code and by tests; no external penetration test was done.

## Controls in place

| Risk | Control | Tested by |
|---|---|---|
| Feature reachable before approval | Off by default per workspace (`universalMeetingAssistant`); server kill switch; `/status` is the only endpoint that answers while off | `offByDefault_everyEndpointSaysSoAndNothingIsStored` |
| Cross-tenant access | Every query includes `organizationId`; IDs from another workspace answer 404 (not 403) | `otherWorkspaceCannotSeeOrTouchIt` |
| Over-sharing inside a workspace | Meetings are private by default (creator + admins). Attending a meeting grants nothing. Restricted (department) profiles never get workspace-wide access. Viewers can't add meetings | `privateUntilShared_…`, `viewerCannotAddMeetings` |
| Unauthorised task creation | Only the meeting's creator or an admin can approve; tasks are created through the existing `TaskService.create`, which applies the normal task permissions (including restricted-profile capability checks) | `privateUntilShared_…` |
| Duplicate tasks | Unique index on `(organizationId, sourceActionKey)` + race handling | `recordingToApprovedTask_…` (approve twice → one task) |
| Fabricated owners, dates, facts | Every item must cite transcript lines that exist and share words with it; owners must be named in (or beside) those lines; first-name matches are suggestions; deadlines must be said; Ask AI answers without valid evidence are replaced by "doesn't clearly answer" | `UmaLogicTest`, `askAi_saysSoWhenTheTranscriptDoesNotAnswer` |
| Prompt injection from transcript text | Transcript fenced as data, angle brackets neutralised, instructions to ignore embedded instructions; output is parsed as JSON and validated — the model cannot call tools or write anywhere | review |
| Consent | Upload refused without the "everyone knew it was recorded" confirmation; who confirmed and when is stored | `uploadRules` |
| Malicious uploads | Extension allow-list; size cap enforced while streaming (no full-file buffering); stored via `FileStorageService` (virus-scan hook, blocked executable types, random file names, no path traversal); `ffprobe` rejects non-audio before processing | `uploadRules`, `damagedAudio_failsWithAPlainReason` |
| SSRF via meeting links | Links are only parsed (https only, host matched to a known platform, otherwise "Other"); the server never fetches them | `providerDetection`, `meetingLink_detectsProviderHonestly` |
| SSRF via engine addresses | Workspace-entered addresses keep the existing rule (public https only). Only operator environment variables may point at private/http addresses; no redirects followed; no credentials in URLs | `operatorAddressesAllowHttpButNothingOdd` |
| Data retention | Recording files deleted 24 h after transcription (configurable); deleting a meeting removes transcript, insights, questions and file | `deleteRemovesTranscriptAndInsightsButKeepsCreatedTasks` |
| Content in logs | Audit trail stores actions only, never meeting content. The app's request logger is told to skip `/api/v2/meeting-assistant` (see finding 1) | `recordingToApprovedTask_…` asserts the audit has no transcript text |
| Secrets | No keys in code or config; operator keys come from environment variables; workspace keys stay encrypted (`FieldEncryptionService`) and are only decrypted in memory to call the engine | review |
| Third-party disclosure | The upload dialog says where audio and text are sent. With the self-hosted engines, nothing leaves your servers | review |

### Connections (added later)

| Risk | Control |
|---|---|
| Fireflies key exposure | Only workspace admins can save or remove it; it is checked with Fireflies first, stored encrypted (refused if the server has no `ENCRYPTION_KEY`), and never returned to the browser. The Fireflies client only ever sends it to `api.fireflies.ai`. |
| Google account access | Each person connects their own account (OAuth with PKCE, existing service). Only `meetings.space.readonly` is requested — no Drive, Calendar or Gmail. Tokens are stored encrypted; "Disconnect" removes them. A transcript is read with the connection of the person who added the meeting; a Meet session is imported into one meeting only. |
| Browser recording | The browser itself asks the person what to share; consent box required; pieces are checked to be audio before storing; per-recording size and length caps; pieces after Stop are refused; cancelling deletes them; audio files deleted after transcription (retention). |
| Third-party processing | Fireflies and Google already hold these meetings; importing copies the transcript text into Prowosma. Workspaces using a hosted AI provider send that text on to it. |

## Findings (outside the new module) — need your decision

1. **The app logs every API response body to stdout** (`RequestLoggingFilter`, active in all environments, first 1 000 characters). This includes the **login response with the session token**, and content such as tasks, documents and the existing Meeting Assistant's transcripts. I only excluded the new feature's path. Recommendation: limit this filter to a local/dev profile, or log status and timing only. *Not changed — it affects the whole app.*
2. **The 10 `Login.twoFactor` frontend tests fail on `main`** as well as on this branch (unrelated to this work). Worth fixing so CI catches real 2FA regressions.

## Residual risks

- A small self-hosted model can still state something that a cited line only loosely supports (seen once: "the launch depends on the contract being signed" citing the lines about the launch and the contract). Mitigations: line references on every statement, nothing becomes a task without approval, user guide tells people to check.
- Speaker identity is not verified (no diarization); names come only from imported transcripts.
- If a workspace uses a hosted AI provider or hosted speech-to-text, meeting content goes to that vendor under the workspace's own agreement.
- No rate limit specific to Ask AI beyond the app's general rate limiting; each question costs one model call.
