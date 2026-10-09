/**
 * Browser-side meeting recording: turns live audio into short, self-contained files (about three minutes each) that can be sent one by one,
 * so a lost connection or a closed tab never loses the whole meeting, and the server can start work while the meeting is still going.
 * Everything that touches the browser (MediaRecorder, AudioContext, clocks) is injectable, so this is tested without a real browser.
 */

export const SEGMENT_SECONDS = 180;
/** Peak loudness (0–1) below which a stretch of audio counts as silence — it is not sent, which also avoids speech recognition "hearing" things in silence. */
export const SILENCE_PEAK = 0.01;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];

export function pickMimeType(MR = globalThis.MediaRecorder) {
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) || "";
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class SegmentedRecorder {
  /**
   * @param tracks   [{ name: "MIC" | "TAB", stream: MediaStream }]
   * @param onSegment ({ track, seq, startMs, durationMs, blob, silent }) — called when a piece is complete
   */
  constructor({ tracks, segmentMs = SEGMENT_SECONDS * 1000, onSegment, onError,
    MediaRecorderCtor = globalThis.MediaRecorder, AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
    now = () => Date.now() }) {
    this.MR = MediaRecorderCtor;
    this.AC = AudioContextCtor;
    this.now = now;
    this.segmentMs = segmentMs;
    this.onSegment = onSegment;
    this.onError = onError;
    this.mime = pickMimeType(MediaRecorderCtor);
    this.tracks = tracks.map((t) => ({ name: t.name, stream: t.stream, seq: 0, level: 0, analyser: null, buf: null, recorder: null, cur: null, finalizing: Promise.resolve() }));
    this.t0 = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.t0 = this.now();
    this.audio = null;
    if (this.AC) { try { this.audio = new this.AC(); } catch { this.audio = null; } }
    for (const t of this.tracks) { this._meter(t); this._begin(t); }
    this.rotateTimer = setInterval(() => this._rotate(), this.segmentMs);
    this.meterTimer = setInterval(() => this._sample(), 250);
  }

  _meter(t) {
    if (!this.audio) return;
    try {
      const src = this.audio.createMediaStreamSource(t.stream);
      const an = this.audio.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      t.analyser = an;
      t.buf = new Uint8Array(an.fftSize);
    } catch { t.analyser = null; }
  }

  _sample() {
    for (const t of this.tracks) {
      if (!t.analyser) continue;
      t.analyser.getByteTimeDomainData(t.buf);
      let peak = 0;
      for (let i = 0; i < t.buf.length; i++) peak = Math.max(peak, Math.abs(t.buf[i] - 128) / 128);
      t.level = peak;
      if (t.cur) t.cur.peak = Math.max(t.cur.peak, peak);
    }
  }

  _begin(t) {
    const chunks = [];
    const startMs = this.now() - this.t0;
    const cur = { peak: t.analyser ? 0 : 1 };                 // no loudness meter available → never treat audio as silent
    t.cur = cur;
    const options = this.mime ? { mimeType: this.mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 };
    const rec = new this.MR(t.stream, options);
    t.recorder = rec;
    t.finalizing = new Promise((resolve) => {
      rec.ondataavailable = (e) => { if (e?.data && e.data.size > 0) chunks.push(e.data); };
      rec.onerror = (e) => { if (this.onError) this.onError(e?.error || e); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: this.mime || "audio/webm" });
        const seq = t.seq++;
        if (blob.size > 0) this.onSegment({ track: t.name, seq, startMs, durationMs: this.now() - this.t0 - startMs, blob, silent: cur.peak < SILENCE_PEAK });
        resolve();
      };
    });
    rec.start();
  }

  _end(t) {
    if (t.recorder && t.recorder.state !== "inactive") t.recorder.stop();
    return t.finalizing;
  }

  _rotate() {
    if (!this.running) return;
    for (const t of this.tracks) { this._end(t); this._begin(t); }
  }

  /** How loud each track is right now (0–1), for a level indicator. */
  levels() {
    const out = {};
    for (const t of this.tracks) out[t.name] = t.level;
    return out;
  }

  /** Ends recording, delivering the last pieces. Resolves when every piece has been handed to onSegment. */
  async stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.rotateTimer);
    clearInterval(this.meterTimer);
    await Promise.all(this.tracks.map((t) => this._end(t)));
    if (this.audio && typeof this.audio.close === "function") { try { await this.audio.close(); } catch { /* already closed */ } }
  }
}

/** A client error that retrying can't fix (not 408/429). */
const isPermanent = (e) => {
  const s = e?.response?.status;
  return !!s && s >= 400 && s < 500 && s !== 408 && s !== 429;
};

/**
 * Sends pieces one at a time, in order, retrying temporary failures with a growing pause. A piece that keeps failing is recorded in {@code failed}
 * and the rest carry on — one bad moment on the network must not stop the meeting being recorded.
 */
export function createUploadQueue({ send, delays = [2000, 4000, 8000], sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress }) {
  const jobs = [];
  const failed = [];
  let sent = 0;
  let running = null;

  const report = () => { if (onProgress) onProgress({ sent, failed: failed.length, pending: jobs.length }); };

  const loop = async () => {
    while (jobs.length) {
      const job = jobs.shift();
      let ok = false;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try { await send(job); ok = true; break; }
        catch (e) {
          if (isPermanent(e) || attempt === delays.length) break;
          await sleep(delays[attempt]);
        }
      }
      if (ok) sent++; else failed.push(job);
      report();
    }
    running = null;
  };

  return {
    enqueue(job) { jobs.push(job); report(); if (!running) running = loop(); },
    drain() { return running || Promise.resolve(); },
    get failed() { return failed; },
    get sent() { return sent; },
    get pending() { return jobs.length + (running ? 1 : 0); },
  };
}
