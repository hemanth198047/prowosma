# Meeting Assistant — foundation (Phase 1)

## What works today
- Admins enable Google Meet and/or Microsoft Teams (**Integrations → Meeting Platforms**) and set policies:
  assistant name, who may send the assistant, default result visibility, retention, output language.
- People paste a meeting link; the server detects and validates the platform (no network request is ever made to the link).
- A meeting *session* is recorded per occurrence, with a lifecycle, history, per-meeting access control and audit entries.
- Duplicate requests for the same occurrence are rejected by a unique database index, including under concurrency.

## What does NOT work yet (by design — nothing is faked)
- **No live joining.** Google's live-audio API is a limited developer preview and Teams needs a separate Windows-hosted service.
- **No transcript collection yet.** Platform sign-in (OAuth), post-meeting transcript fetch and manual upload arrive in the next phases.
- No summaries, minutes, action extraction or task creation yet. "Automatic creation" is refused by the API until it exists.
- "Test connection" reports that sign-in isn't set up. "Connect" is disabled.

## API (all organization-scoped)
| Route | Who |
|---|---|
| `GET /api/meeting-assistant/capabilities` | any member |
| `POST /api/meeting-assistant/validate-url` | any member |
| `GET/POST /api/meeting-assistant/sessions`, `GET …/{id}` | members (viewers read-only); a meeting is visible only to its requester, people it is shared with, admins, or the workspace if so configured — attendance alone grants nothing |
| `POST …/{id}/cancel`, `POST …/{id}/retry`, `PUT …/{id}/access` | requester or admin |
| `/api/admin/meeting-assistant/**` | OWNER/ADMIN only (reads too — enforced by the `/api/admin/` rule in `RoleGuardFilter`) |

## Development fixtures
Set `app.meeting-assistant.dev-fixtures-enabled=true` (env: `APP_MEETING_ASSISTANT_DEV_FIXTURES_ENABLED=true`) to let admins
create **simulated** meetings (titled `[SIMULATED]`) and step them through the lifecycle to exercise the UI and recovery paths.
Off by default; the endpoints return 404 when off. Simulated meetings never contact a meeting platform.

## Operational notes
- New collections: `meeting_sessions`, `meeting_integrations`, `meeting_assistant_settings` (indexes are created at startup by
  `MeetingAssistantIndexConfig`; no data migration is needed).
- Passcodes and query strings in meeting links are discarded before storage and are never logged.
- When OAuth is added, tokens must be stored only via `FieldEncryptionService` and saving must fail if encryption is inactive.
