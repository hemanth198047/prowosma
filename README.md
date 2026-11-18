This is Prowosma Project Management Application Source Code

## Start everything on your computer

One command starts MongoDB, the speech-to-text server (for the AI Meeting Assistant), the backend and the frontend, installing or
preparing whatever is missing on the first run. Each one is skipped if it is already running.

| | Start | Stop |
|---|---|---|
| Windows | double-click `start-all.bat` (or run it in a terminal) | `stop-all.bat` |
| macOS / Linux | `./start-all.sh` | `./stop-all.sh` |

Options: `-LocalAI` / `--local-ai` also runs a free local AI model with Ollama; `-NoSpeech` / `--no-speech` skips speech-to-text.

What the first run does:
- checks for Java 21, Node.js, Python 3.10-3.12 and ffmpeg (on Windows it offers to install missing ones with `winget`);
- creates `backend/.env` from `backend/.env.example` if it doesn't exist, and fills in `JWT_SECRET` and `ENCRYPTION_KEY` only if they are
  empty - values you already have are never changed. Keep `ENCRYPTION_KEY` once you have data: it encrypts saved keys and sign-ins;
- starts MongoDB locally (Windows service, an installed `mongod`, or Docker) unless `MONGODB_URI` in `backend/.env` points to a cloud database;
- sets up `tools/stt-server` in its own Python environment (the speech model, ~500 MB, downloads the first time a recording is transcribed);
- prints the address to open, http://localhost:5173 (add `-OpenBrowser` on Windows to have it opened for you).

**"Port 5173 is already in use" but nothing is using it (Windows):** Windows (Hyper-V, WSL or Docker Desktop) reserves blocks of ports;
`netsh interface ipv4 show excludedportrange protocol=tcp` lists them. `start-all.bat` notices this and uses a free port instead
(it prints the address to open), or choose one with `start-all.bat -FrontendPort 5180`. To get 5173 back, run PowerShell as Administrator:
`net stop winnat` then `net start winnat`. The backend accepts the app on any `localhost` port, so sign-in works whichever port it's on.

Windows opens a window per service; macOS/Linux writes logs to `.prowosma-run/logs/`. The older `start.bat` / `stop.bat` still work and
start only the backend and frontend.

The AI Meeting Assistant also needs an admin to turn it on once: Admin Centre -> Feature flags -> "AI Meeting Assistant (new)".
Fireflies and Google Meet: see `backend/docs/universal-meeting-assistant/09-CONNECTIONS-SETUP.md`.
