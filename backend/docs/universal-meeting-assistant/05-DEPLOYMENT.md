# Universal AI Meeting Assistant — Deployment

Nothing here has been deployed. Main auto-deploys, so this branch is only merged when you say so.

## What a deploy changes

| Area | Change | Reversible by |
|---|---|---|
| Backend code | New package `uma` + `/api/v2/meeting-assistant` endpoints, a background worker (poll every 5 s) and an hourly retention job | Redeploying the previous build |
| Database | New collections `uma_*` and their indexes, created on start-up. No existing collection or document is modified. (The `tasks` index `uniq_task_meeting_source` is declared again with the identical definition; MongoDB treats that as a no-op.) | Dropping the `uma_*` collections (only if you want the data gone) |
| Backend image | `ffmpeg` added to the runtime image (~+80 MB) | Previous image |
| Frontend | New page `/ai-meeting-assistant`, a menu item shown only when the flag is on, one new row in Admin Centre → Feature flags | Previous build |
| Shared code | `FileStorageService.openStream` (new read method); `RequestLoggingFilter` skips `/api/v2/meeting-assistant` | Previous build |

The feature is **off in every workspace** after deploy. Nothing changes for users until an admin turns on the flag.

## Steps

1. **Speech-to-text** (skip if workspaces will only import transcripts, or will use a hosted engine):
   build and run `tools/stt-server` next to the backend (see 03-CONFIGURATION §4). Give it at least 2 vCPU / 2 GB RAM for `small`; more for `medium`.
2. **Backend environment** — at minimum:
   ```
   UMA_STT_BASE_URL=http://stt:8000
   UMA_STT_MODEL=small
   ```
   Optionally a self-hosted model (`UMA_LLM_BASE_URL`, `UMA_LLM_MODEL`). Otherwise each workspace's AI Settings provider is used.
3. **Deploy** backend and frontend as usual (merge to main → automatic).
4. **Check** with an admin account:
   ```
   GET /api/v2/meeting-assistant/status        → {"enabled": false, "transcriptionReady": true, "aiReady": true, ...}
   ```
5. **Pilot**: turn on *Admin Centre → Feature flags → AI Meeting Assistant (new)* in one workspace. Upload a short recording, check the summary, approve one action, confirm the task appears in Tasks.
6. **Watch**: backend log lines starting `uma pipeline` / `uma ai` / `uma retention`; `uma_jobs` documents in status `DEAD` mean a meeting failed permanently (the user sees why and can retry).

## Rollback

- **Fast (no deploy):** turn the workspace flag off, or set `UMA_ENABLED=false` and restart. The page disappears and the API refuses requests; data stays.
- **Full:** redeploy the previous build. The `uma_*` collections are simply unused; drop them if you want the data removed.

The existing Meeting Assistant is unaffected by either.

## Running several backend instances

Jobs are claimed with a lease (`findAndModify`), so any number of instances can run the worker safely. Set `UMA_JOBS_ENABLED=false` on instances that should not do heavy work. Transcription temp files live in the instance's temp directory and are removed after each piece.

## Local run (what was used for validation)

```bash
# MongoDB on 27017, then:
cd tools/stt-server && pip install -r requirements.txt && STT_MODEL=small uvicorn server:app --port 8765
cd backend && ./gradlew bootJar && \
  JWT_SECRET=<64+ random chars> UMA_STT_BASE_URL=http://127.0.0.1:8765 UMA_STT_MODEL=small \
  java -jar build/libs/prowosma-backend-0.0.1-SNAPSHOT.jar
```

On Windows (PowerShell) set the variables with `$env:UMA_STT_BASE_URL="http://127.0.0.1:8765"` before `java -jar`. Install ffmpeg (e.g. `winget install Gyan.FFmpeg`) so long recordings are split.
