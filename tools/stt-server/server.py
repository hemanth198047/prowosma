"""
Prowosma self-hosted speech-to-text server.

Speaks the OpenAI "audio transcriptions" API (POST /v1/audio/transcriptions, multipart `file`), which is exactly what the
backend's OpenAiCompatibleSttClient calls - so Prowosma can use this $0 server, or OpenAI / Groq / any compatible service,
by changing one setting. Runs faster-whisper (CTranslate2) on CPU or GPU.

Speaker separation (diarization) is OFF unless set up: then every segment is returned without a speaker and the app
shows "Unknown speaker". With STT_DIARIZE=1 and a Hugging Face token that has accepted the pyannote model's licence, each
segment gets a NEUTRAL label ("Speaker 1", "Speaker 2", numbered by first appearance) - never a person's name. Telling
who "Speaker 2" is stays with people (or with transcripts from Meet/Teams, which name signed-in speakers).

Environment:
  STT_MODEL        whisper model size or path (default "small"; "medium"/"large-v3" are more accurate, slower)
  STT_DEVICE       "cpu" (default) or "cuda"
  STT_COMPUTE      "int8" (default on CPU), "float16" on GPU
  STT_API_KEY      optional; when set, requests must send "Authorization: Bearer <key>"
  STT_MAX_MB       largest upload accepted (default 500)
  STT_DIARIZE      "1" to separate speakers (needs: pip install pyannote.audio, and HF_TOKEN)
  HF_TOKEN         Hugging Face token that accepted https://hf.co/pyannote/speaker-diarization-3.1 (only with STT_DIARIZE=1)
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

DIARIZE = os.environ.get("STT_DIARIZE", "").strip() in ("1", "true", "yes")
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()

app = FastAPI(title="Prowosma speech-to-text", version="1.1")
_model = None
_diarizer = None
_diarizer_error = None


def diarizer():
    """The pyannote pipeline, loaded once; None (with a reason) when it isn't set up or can't load."""
    global _diarizer, _diarizer_error
    if not DIARIZE or _diarizer is not None or _diarizer_error is not None:
        return _diarizer
    try:
        from pyannote.audio import Pipeline   # optional dependency
        if not HF_TOKEN:
            raise RuntimeError("HF_TOKEN is not set")
        _diarizer = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=HF_TOKEN)
        if DEVICE == "cuda":
            import torch
            _diarizer.to(torch.device("cuda"))
    except Exception as e:                    # not installed, no access to the gated model, no network...
        _diarizer_error = f"{type(e).__name__}: {e}"
    return _diarizer


def assign_speakers(segs, turns):
    """Gives each transcript segment the speaker who talks most during it, as "Speaker N" numbered by first appearance.

    segs:  [{"start": s, "end": e, ...}]   turns: [(start, end, raw_label)] from the diarizer
    A segment that overlaps no turn gets no speaker (it stays unknown rather than guessed).
    """
    order = {}
    for seg in segs:
        best, best_overlap = None, 0.0
        for (ts, te, label) in turns:
            overlap = min(seg["end"], te) - max(seg["start"], ts)
            if overlap > best_overlap:
                best, best_overlap = label, overlap
        if best is None:
            continue
        if best not in order:
            order[best] = f"Speaker {len(order) + 1}"
        seg["speaker"] = order[best]
    return segs


def model():
    global _model
    if _model is None:
        _model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
    return _model


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "device": DEVICE, "loaded": _model is not None,
            "diarization": ("ready" if _diarizer is not None else "unavailable: " + _diarizer_error if _diarizer_error else "not loaded yet")
            if DIARIZE else "off"}


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
        diarized = False
        if segs and diarizer() is not None:
            try:
                result = diarizer()(tmp.name)
                turns = [(t.start, t.end, label) for t, _, label in result.itertracks(yield_label=True)]
                assign_speakers(segs, turns)
                diarized = True
            except Exception:                    # separation failing never loses the transcript
                diarized = False

    text = " ".join(s["text"] for s in segs).strip()
    if response_format in ("text",):
        return JSONResponse(content=text)
    body = {"text": text, "language": info.language, "duration": round(info.duration, 2)}
    if response_format == "verbose_json":
        body["segments"] = segs
        body["processing_seconds"] = round(time.time() - started, 2)
        body["speakers_separated"] = diarized
    return body
