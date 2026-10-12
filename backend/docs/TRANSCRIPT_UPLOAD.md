# Upload a transcript — no meeting link, no running meeting

For a meeting that is already over (a call on any platform, a room, a phone, someone else's recording, a Fireflies / Meet / Teams transcript you downloaded), **Meeting Assistant → Upload a transcript** turns the transcript into a meeting and runs the normal pipeline: summary, minutes and notes → action items and proposed projects → your review → tasks and projects.

Nothing here talks to a meeting platform, and it works whether or not Google, Teams, Fireflies or recording are set up. **AI must be set up** (Admin → AI Settings) for the summary, action items and tasks; without it the transcript is saved and can be processed later with *Generate* / *Extract actions*.

## What can be uploaded
| Format | Notes |
|---|---|
| `.txt`, `.md` | UTF-8, UTF-8 with BOM, UTF-16 and old Windows encodings are read correctly |
| `.vtt`, `.srt` | Speakers and timings are kept |
| `.docx` (Word) | What Google Meet transcripts saved in Drive (*File → Download → Microsoft Word*) and Teams transcripts usually are. One line per paragraph; a table row is one line |
| pasted text | Same as a `.txt` |

Refused with a message saying what to do instead: PDF, old `.doc`, `.rtf`, `.json`, spreadsheets. Limit: 5 MB per file (split longer transcripts). Speaker names are only what the file itself says ("Priya: …"); lines without a name show as unknown.

## How it behaves
- The file is read and checked **before** any meeting is created, so a bad file never leaves an empty meeting behind.
- Each upload is its own meeting (uploading the same transcript twice makes two meetings — delete/cancel the one you don't want).
- The title is the one you type, else the file name, else "Uploaded transcript". Choose a project, or leave *Detect from discussion*.
- The person must confirm they may use the transcript: its text is sent to the workspace's AI provider.
- Who can use it follows the Meeting Assistant's *who can send the assistant* setting (viewers can't). Visibility follows the workspace default and can be changed on the meeting.
- A `.docx` is only unzipped in memory (hard size cap), only its body text is read, and XML entities / DTDs are switched off.

## API
| Request | Use |
|---|---|
| `POST /api/meeting-assistant/transcripts` — JSON `{content, format?, filename?, title?, projectId?, consent}` | pasted text |
| `POST /api/meeting-assistant/transcripts/upload?filename=…&title=…&projectId=…&consent=true` — raw file bytes (`application/octet-stream`) | a file |

Both return `201` with the new meeting (and `warnings`). `GET /api/meeting-assistant/capabilities` reports `transcriptUpload: {enabled, maxBytes, formats}`.

## Not verified
The server code could not be compiled or run against MongoDB in the environment it was written in; run `TranscriptFileReaderTest` and `TranscriptUploadApiTest` (backend) and `UploadTranscriptPanel.test.jsx` (frontend) before relying on it, then try one real file of each kind you use.
