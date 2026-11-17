#!/usr/bin/env bash
# Prowosma - start EVERYTHING on macOS or Linux (the Windows version is start-all.bat / start-all.ps1).
#
# Starts, skipping anything already running:
#   1. MongoDB         (installed mongod or Docker; skipped when backend/.env points to a cloud database)
#   2. Speech-to-text  (tools/stt-server, port 8765) - for the AI Meeting Assistant's recordings
#   3. Local AI model  (only with --local-ai: Ollama + qwen2.5:7b; otherwise the AI Settings provider is used)
#   4. Backend         (Spring Boot, port 9090)
#   5. Frontend        (Vite, port 5173)
# First run creates backend/.env from .env.example and fills JWT_SECRET / ENCRYPTION_KEY if empty; existing values are never changed.
# Logs: .prowosma-run/logs/*.log      Stop everything: ./stop-all.sh
#
#   ./start-all.sh [--local-ai] [--no-speech] [--speech-model small|medium|large-v3]
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"; FRONTEND="$ROOT/frontend"; STT="$ROOT/tools/stt-server"
RUN="$ROOT/.prowosma-run"; LOGS="$RUN/logs"; ENV_FILE="$BACKEND/.env"
LOCAL_AI=0; NO_SPEECH=0; SPEECH_MODEL="small"
while [ $# -gt 0 ]; do
  case "$1" in
    --local-ai) LOCAL_AI=1 ;;
    --no-speech) NO_SPEECH=1 ;;
    --speech-model) SPEECH_MODEL="$2"; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done
mkdir -p "$LOGS"

c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step() { echo; c "1;36" "== $1"; }
ok()   { c 32 "   [OK] $1"; }
warn() { c 33 "   [!]  $1"; }
fail() { c 31 "   [X]  $1"; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_port() { local p=$1 s=$2; for _ in $(seq 1 $((s / 2))); do port_open "$p" && { echo; return 0; }; printf '.'; sleep 2; done; echo; return 1; }
wait_http() { local u=$1 s=$2; for _ in $(seq 1 $((s / 3))); do curl -fs -o /dev/null -m 3 "$u" && { echo; return 0; }; printf '.'; sleep 3; done; echo; return 1; }
rand_b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
# start_bg NAME DIR CMD... : runs CMD in the background, detached from this terminal, logging to .prowosma-run/logs/NAME.log.
# The pid file holds the service's own pid (its process group too, where `setsid` exists - Linux; macOS has no setsid).
start_bg() {
  local name=$1 dir=$2; shift 2
  if has setsid; then ( cd "$dir" || exit 1; exec setsid "$@" >"$LOGS/$name.log" 2>&1 < /dev/null ) &
  else ( cd "$dir" || exit 1; exec nohup "$@" >"$LOGS/$name.log" 2>&1 < /dev/null ) &
  fi
  echo $! > "$RUN/$name.pid"
}

env_get() { [ -f "$ENV_FILE" ] && grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" | tail -1 | sed -E "s/^[^=]*=//; s/[[:space:]]+$//" || true; }
# Adds KEY=VALUE only if KEY is missing or empty. Never overwrites a value.
env_ensure() {
  local key=$1 value=$2 why=$3
  if grep -qE "^[[:space:]]*$key[[:space:]]*=" "$ENV_FILE" 2>/dev/null; then
    [ -n "$(env_get "$key")" ] && return 1
    local tmp; tmp=$(mktemp)
    awk -v k="$key" -v v="$value" '{ if ($0 ~ "^[[:space:]]*" k "[[:space:]]*=") print k "=" v; else print }' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  else
    printf '\n# %s (added by start-all)\n%s=%s\n' "$why" "$key" "$value" >> "$ENV_FILE"
  fi
  return 0
}

echo; c 1 "  Prowosma - starting everything"; c 90 "  Project: $ROOT"

step "Checking what's installed"
[ -f "$BACKEND/gradlew" ] || fail "backend/gradlew not found - run this from the project folder."
has java || fail "Java 21 is needed (https://adoptium.net, or: brew install temurin@21 / apt install openjdk-21-jdk)."
JV=$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)
[ -n "$JV" ] && [ "$JV" -lt 21 ] && fail "Java 21 or newer is needed (found $JV)."
ok "Java $JV"
has node || fail "Node.js is needed (https://nodejs.org)."
ok "Node.js $(node --version)"
if has ffmpeg; then ok "ffmpeg"; else warn "ffmpeg not found - long recordings can't be split (brew install ffmpeg / apt install ffmpeg)."; fi
PY=""
if [ $NO_SPEECH -eq 0 ]; then
  for v in python3.12 python3.11 python3.10 python3; do
    if has "$v" && "$v" -c 'import sys; exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then PY=$v; break; fi
  done
  if [ -n "$PY" ]; then ok "Python ($PY)"; else warn "Python 3.10-3.12 not found - starting without speech-to-text."; NO_SPEECH=1; fi
fi

step "Settings (backend/.env)"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$BACKEND/.env.example" ]; then cp "$BACKEND/.env.example" "$ENV_FILE"; ok "Created backend/.env from .env.example"; else : > "$ENV_FILE"; fi
fi
env_ensure JWT_SECRET "$(rand_b64 64)" "Signs sign-in sessions" && ok "Generated JWT_SECRET"
env_ensure ENCRYPTION_KEY "$(rand_b64 32)" "Encrypts saved keys and sign-ins - never change it once data exists" && ok "Generated ENCRYPTION_KEY"
if [ $NO_SPEECH -eq 0 ]; then
  env_ensure UMA_STT_BASE_URL "http://127.0.0.1:8765" "AI Meeting Assistant speech-to-text (tools/stt-server)" && ok "Speech-to-text address added"
  env_ensure UMA_STT_MODEL "$SPEECH_MODEL" "Speech-to-text model" || true
fi
ok "Settings ready (existing values left as they were)"

step "MongoDB"
MONGO_URI=$(env_get MONGODB_URI); MONGO_URI=${MONGO_URI:-${MONGODB_URI:-mongodb://localhost:27017}}
if ! [[ "$MONGO_URI" =~ ^mongodb://(localhost|127\.0\.0\.1)(:27017)?(/|$|\?) ]]; then
  ok "Using the database in backend/.env (not local) - nothing to start"
elif port_open 27017; then
  ok "Already running on port 27017"
else
  if has mongod; then
    mkdir -p "$RUN/mongo-data"
    start_bg mongod "$ROOT" mongod --dbpath "$RUN/mongo-data" --port 27017 --bind_ip 127.0.0.1
    ok "Started mongod (data in .prowosma-run/mongo-data)"
  elif has docker; then
    if docker ps -a --format '{{.Names}}' | grep -qx prowosma-mongo; then docker start prowosma-mongo >/dev/null
    else docker run -d --name prowosma-mongo -p 27017:27017 -v prowosma-mongo:/data/db mongo:7 >/dev/null; fi
    echo prowosma-mongo > "$RUN/mongo-docker"; ok "Started MongoDB in Docker (container prowosma-mongo)"
  else
    fail "MongoDB isn't running. Install it (brew install mongodb-community / https://www.mongodb.com/try/download/community), use Docker, or set MONGODB_URI in backend/.env."
  fi
  printf '   waiting for MongoDB'; wait_port 27017 60 || fail "MongoDB didn't start (see .prowosma-run/logs/mongod.log)."
  ok "MongoDB is ready"
fi

if [ $NO_SPEECH -eq 0 ]; then
  step "Speech-to-text (port 8765)"
  if port_open 8765; then ok "Already running"; else
    VENV="$STT/.venv"
    [ -x "$VENV/bin/python" ] || { echo "   Creating a Python environment (first run only)..."; "$PY" -m venv "$VENV" || fail "Couldn't create tools/stt-server/.venv"; }
    HASH=$(sha256sum "$STT/requirements.txt" 2>/dev/null || shasum -a 256 "$STT/requirements.txt"); HASH=${HASH%% *}
    if [ "$(cat "$VENV/.requirements.sha256" 2>/dev/null)" != "$HASH" ]; then
      echo "   Installing speech-to-text packages (first run takes a few minutes)..."
      "$VENV/bin/python" -m pip install -q --upgrade pip && "$VENV/bin/python" -m pip install -q -r "$STT/requirements.txt" || fail "Installing the speech-to-text packages failed."
      echo "$HASH" > "$VENV/.requirements.sha256"
    fi
    STT_MODEL="$SPEECH_MODEL" HF_HUB_DISABLE_XET=1 start_bg stt "$STT" "$VENV/bin/python" -m uvicorn server:app --host 127.0.0.1 --port 8765
    printf '   waiting for speech-to-text'
    if wait_http http://127.0.0.1:8765/health 120; then ok "Running (the $SPEECH_MODEL model downloads on first use, ~500 MB)"; else warn "Not answering yet - see .prowosma-run/logs/stt.log"; fi
  fi
fi

BACKEND_ENV=()
if [ $LOCAL_AI -eq 1 ]; then
  step "Local AI model (Ollama)"
  if has ollama; then
    port_open 11434 || { start_bg ollama "$ROOT" ollama serve; wait_port 11434 30 || true; }
    ollama list 2>/dev/null | grep -q 'qwen2.5:7b' || { echo "   Downloading qwen2.5:7b (~4.7 GB, first run only)..."; ollama pull qwen2.5:7b; }
    BACKEND_ENV=(UMA_LLM_BASE_URL=http://127.0.0.1:11434/v1 UMA_LLM_MODEL=qwen2.5:7b UMA_LLM_PREFER=self-hosted)
    ok "Ollama with qwen2.5:7b"
  else warn "Ollama not installed (https://ollama.com) - using the provider in AI Settings instead."; fi
fi

step "Backend (port 9090)"
if port_open 9090; then ok "Already running"; else
  start_bg backend "$BACKEND" env "${BACKEND_ENV[@]}" bash ./gradlew bootRun   # gradlew is not marked executable in git
  printf '   waiting for the backend (first run downloads dependencies)'
  if wait_http http://localhost:9090/actuator/health/liveness 600; then ok "Backend is up"; else warn "No answer within 10 minutes - see .prowosma-run/logs/backend.log"; fi
fi

step "Frontend (port 5173)"
if port_open 5173; then ok "Already running"; else
  if [ ! -f "$FRONTEND/node_modules/.package-lock.json" ] || [ "$FRONTEND/package-lock.json" -nt "$FRONTEND/node_modules/.package-lock.json" ]; then
    echo "   Installing frontend packages..."; (cd "$FRONTEND" && npm install --no-audit --no-fund --legacy-peer-deps) || fail "npm install failed."
  fi
  start_bg frontend "$FRONTEND" npm run dev
  printf '   waiting for the frontend'
  if wait_port 5173 120; then ok "Frontend is up"; else warn "Didn't start - see .prowosma-run/logs/frontend.log"; fi
fi

echo; c 32 "  Prowosma is running"
echo "    App:             http://localhost:5173"
echo "    Backend:         http://localhost:9090"
[ $NO_SPEECH -eq 0 ] && echo "    Speech-to-text:  http://127.0.0.1:8765/health"
c 90 "  AI Meeting Assistant: an admin turns it on once in Admin Centre -> Feature flags -> 'AI Meeting Assistant (new)'."
c 90 "  Fireflies / Google Meet: AI Meeting Assistant -> Connections (backend/docs/universal-meeting-assistant/09-CONNECTIONS-SETUP.md)."
c 90 "  Logs: .prowosma-run/logs    Stop everything: ./stop-all.sh"
echo
