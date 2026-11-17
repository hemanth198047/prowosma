"""
Prowosma self-hosted speech-to-text server.

Speaks the OpenAI "audio transcriptions" API (POST /v1/audio/transcriptions, multipart `file`), which is exactly what the
backend's OpenAiCompatibleSttClient calls - so Prowosma can use this $0 server, or OpenAI / Groq / any compatible service,
by changing one setting. Runs faster-whisper (CTranslate2) on CPU or GPU.

Speaker diarization is NOT done here: every segment is returned without a speaker. The app shows "Unknown speaker"
rather than guessing names.

Environment:
  STT_MODEL        whisper model size or path (default "small"; "medium"/"large-v3" are more accurate, slower)
  STT_DEVICE       "cpu" (default) or "cuda"
  STT_COMPUTE      "int8" (default on CPU), "float16" on GPU
  STT_API_KEY      optional; when set, requests must send "Authorization: Bearer <key>"
  STT_MAX_MB       largest upload accepted (default 500)
"""
import os
import tempfile
import time

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("STT_MODEL", "small")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE", "int8" if DEVICE == "cpu" else "float16")
API_KEY = os.environ.get("STT_API_KEY", "").strip()
MAX_BYTES = int(os.environ.get("STT_MAX_MB", "500")) * 1024 * 1024

app = FastAPI(title="Prowosma speech-to-text", version="1.0")
_model = None


def model():
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
    return _model


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "device": DEVICE, "loaded": _model is not None}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model", "owned_by": "local"}]}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form("whisper-1", alias="model"),
    language: str = Form(""),
    response_format: str = Form("json"),
    prompt: str = Form(""),
    authorization: str = Header(""),
):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail={"error": {"message": "Invalid API key"}})
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": {"message": "The audio file is empty."}})
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail={"error": {"message": "The audio file is too large."}})

    suffix = os.path.splitext(file.filename or "")[1] or ".audio"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        started = time.time()
        try:
            segments, info = model().transcribe(
                tmp.name,
                language=(language or None),
                initial_prompt=(prompt or None),
                vad_filter=True,                 # skips long silences / background noise
                beam_size=5,
            )
            segs = []
            for i, s in enumerate(segments):     # a generator: transcription happens while iterating
                segs.append({
                    "id": i, "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                    "no_speech_prob": round(s.no_speech_prob, 4), "avg_logprob": round(s.avg_logprob, 4),
                })
        except Exception as e:                   # corrupt / unsupported audio
            raise HTTPException(status_code=400, detail={"error": {"message": f"Could not read that audio: {type(e).__name__}"}})

    text = " ".join(s["text"] for s in segs).strip()
    if response_format in ("text",):
        return JSONResponse(content=text)
    body = {"text": text, "language": info.language, "duration": round(info.duration, 2)}
    if response_format == "verbose_json":
        body["segments"] = segs
        body["processing_seconds"] = round(time.time() - started, 2)
    return body
