# Universal AI Meeting Assistant — Configuration

## 1. Turning it on

The feature has two switches. **Both** must be on.

| Switch | Where | Default |
|---|---|---|
| Server kill switch `app.uma.enabled` (env `UMA_ENABLED`) | server configuration | `true` (the code is present but does nothing without the workspace flag) |
| Workspace flag **`universalMeetingAssistant`** | Admin Centre → Feature flags → AI → "AI Meeting Assistant (new)" | **off** |

While the workspace flag is off: the menu item is hidden, every `/api/v2/meeting-assistant` endpoint except `/status` answers `404 FEATURE_DISABLED`, and nothing is stored. The existing Meeting Assistant is unaffected either way.

## 2. Server settings (environment variables)

All optional. Shown with their defaults.

| Variable | Default | Meaning |
|---|---|---|
| `UMA_ENABLED` | `true` | Server-wide kill switch. `false` disables the feature for every workspace. |
| `UMA_JOBS_ENABLED` | `true` | Run the background worker in this instance. Set `false` on instances that should only serve the API. |
| `UMA_MAX_UPLOAD_MB` | `500` | Largest recording accepted. |
| `UMA_RECORDING_RETENTION_HOURS` | `24` | Recording files are deleted this long after they were transcribed (the transcript is kept). |
| `UMA_STT_BASE_URL` | *(empty)* | Speech-to-text server run by the operator, e.g. `http://stt:8000`. Empty = use the workspace's speech-to-text setting from the existing Meeting Assistant admin page (read only). |
| `UMA_STT_API_KEY` | *(empty)* | Bearer key for that server, if it needs one. |
| `UMA_STT_MODEL` | `whisper-1` | Model name sent to the server (`small`, `medium`, `large-v3` for `tools/stt-server`; `whisper-1` for OpenAI). |
| `UMA_STT_LANGUAGE` | *(empty = detect)* | Force a language, e.g. `en`, `hi`, `te`. |
| `UMA_STT_CHUNK_SECONDS` | `600` | Length of each piece sent for transcription. |
| `UMA_LLM_BASE_URL` | *(empty)* | Self-hosted, OpenAI-compatible model, e.g. `http://llm:8080/v1` (llama.cpp server), `http://ollama:11434/v1`. |
| `UMA_LLM_MODEL` | *(empty)* | Its model name, e.g. `qwen2.5-7b`. |
| `UMA_LLM_API_KEY` | *(empty)* | Key for it, if any. |
| `UMA_LLM_PREFER` | `workspace` | Which model is tried first: `workspace` (the provider in AI Settings, then the self-hosted one as fallback) or `self-hosted`. |

| `UMA_FIREFLIES_API_KEY` | *(empty)* | Fireflies key for the whole server. Usually an admin saves it in the app instead (Connections). |
| `ENCRYPTION_KEY` | *(empty)* | Needed to store the Fireflies key and Google sign-ins (`openssl rand -base64 32`). Existing app setting. |
| `GOOGLE_MEET_OAUTH_CLIENT_ID` / `GOOGLE_MEET_OAUTH_CLIENT_SECRET` | *(empty)* | Google OAuth client for reading Meet transcripts — see 09-CONNECTIONS-SETUP. Existing app settings, shared with the old assistant. |
| `FRONTEND_URL` | `http://localhost:5173` | Used to build the Google redirect URI. Existing app setting. |

Advanced (properties only): `app.uma.job-poll-ms` (5000), `app.uma.ai.single-pass-chars` (60000), `app.uma.ai.chunk-chars` (40000), `app.uma.ai.max-output-tokens` (4000), `app.uma.ai.ask-context-chars` (24000), `app.uma.retention-check-ms` (3600000).

**Addresses set by the operator** (`UMA_STT_BASE_URL`, `UMA_LLM_BASE_URL`) may be plain `http` and private network addresses — only someone with access to the server configuration can set them. Addresses typed into the app by workspace admins (AI Settings, the existing assistant's speech-to-text setting) keep the stricter rule: public `https` only.

Never put keys in the repository. Use your deployment's secret store for `UMA_STT_API_KEY` / `UMA_LLM_API_KEY`.

## 3. Choosing engines

### Speech-to-text (needed for recordings; not for imported transcripts)

| Option | Cost | Notes |
|---|---|---|
| **Self-hosted `tools/stt-server`** (faster-whisper) | your server only | Recording audio never leaves your infrastructure. Measured: `small` on 4 vCPU transcribes 83 s of audio in ~15 s. Use `medium`/`large-v3` for better accuracy (slower on CPU; fast on a GPU). |
| OpenAI `whisper-1` / Groq / other OpenAI-compatible | per minute of audio | Set `UMA_STT_BASE_URL=https://api.openai.com`, key, `UMA_STT_MODEL=whisper-1`. Audio is sent to that vendor — tell your users. |

`ffmpeg`/`ffprobe` must be installed where the backend runs (the backend Docker image now includes them). Without them, a recording is sent in one piece (works for files up to the engine's own limit, e.g. 25 MB for OpenAI) and damaged files are only detected by the engine.

### Language model (needed for summaries, action items and Ask AI)

| Option | Quality (measured, see 06-VALIDATION) | Notes |
|---|---|---|
| **The workspace's AI Settings provider** (Claude, OpenAI, Gemini, …) | not measured here — no key was available in testing; expected to be clearly better than small local models | Transcript text is sent to that provider. |
| Self-hosted 7B model (e.g. Qwen2.5-7B-Instruct, llama.cpp/Ollama) | see 06-VALIDATION | Needs ~6 GB RAM and dedicated CPU, or a GPU. |
| Self-hosted 3B model (Qwen2.5-3B-Instruct) | weak recall; never wrong owners/dates in our runs | Minimum viable; fine for a pilot, not recommended for production. |

A CPU model must have its own cores: when the browser and dev server shared the same 4 vCPUs, generation slowed from 11.8 to 1.8 tokens/s.

## 4. Running the self-hosted speech-to-text server

```bash
cd tools/stt-server
docker build -t prowosma-stt .
docker run -d --name stt -p 8000:8000 -e STT_MODEL=small prowosma-stt
curl http://localhost:8000/health
```

Then set `UMA_STT_BASE_URL=http://<host>:8000` and `UMA_STT_MODEL=small` on the backend. Environment variables of the server: `STT_MODEL` (tiny/base/small/medium/large-v3), `STT_DEVICE` (`cpu`/`cuda`), `STT_COMPUTE` (`int8`, `float16` on GPU), `STT_MAX_MB` (upload cap, default 200), `STT_API_KEY` (optional bearer key). The first start downloads the model from Hugging Face; set `HF_HUB_DISABLE_XET=1` if the download fails behind a proxy.

## 5. Running a self-hosted language model (optional)

```bash
pip install "llama-cpp-python[server]"
python -m llama_cpp.server --model qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf --model_alias qwen2.5-7b \
  --host 0.0.0.0 --port 8080 --n_ctx 8192
```

Then `UMA_LLM_BASE_URL=http://<host>:8080/v1`, `UMA_LLM_MODEL=qwen2.5-7b`. Ollama works the same way (`http://<host>:11434/v1`).
