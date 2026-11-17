# Self-hosted speech-to-text for Prowosma (faster-whisper behind the OpenAI transcriptions API).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
ENV STT_MODEL=small STT_DEVICE=cpu HF_HUB_DISABLE_XET=1
EXPOSE 8000
# The model downloads on first use; mount /root/.cache to keep it between restarts.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
