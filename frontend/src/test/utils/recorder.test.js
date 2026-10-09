import { describe, it, expect, vi, afterEach } from "vitest";
import { SegmentedRecorder, createUploadQueue, pickMimeType, formatClock, SEGMENT_SECONDS, SILENCE_PEAK } from "../../utils/recorder";

afterEach(() => { vi.useRealTimers(); });

/** A stand-in for MediaRecorder: records nothing real, but behaves like one (start / stop → dataavailable → stop events). */
class FakeMR {
  static instances = [];
  static supported = ["audio/webm;codecs=opus"];
  static isTypeSupported(m) { return FakeMR.supported.includes(m); }
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = "inactive"; FakeMR.instances.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    if (this.stream.bytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(this.stream.bytes)]) });
    this.onstop?.();
  }
}

/** A stand-in for the browser's loudness meter: the test says how loud each stream is. */
function fakeAudioContext() {
  return class {
    createMediaStreamSource(stream) { return { connect: (an) => { an.stream = stream; } }; }
    createAnalyser() {
      return {
        fftSize: 0, stream: null,
        getByteTimeDomainData(buf) { buf.fill(128); if (this.stream?.loud) buf[0] = 128 + Math.round(this.stream.loud * 127); },
      };
    }
    close() { return Promise.resolve(); }
  };
}

const stream = (over = {}) => ({ bytes: 1000, loud: 0.5, ...over });
const make = (tracks, extra = {}) => {
  const got = [];
  const rec = new SegmentedRecorder({ tracks, segmentMs: 180_000, onSegment: (s) => got.push(s), MediaRecorderCtor: FakeMR, AudioContextCtor: fakeAudioContext(), ...extra });
  return { rec, got };
};

describe("SegmentedRecorder", () => {
  it("cuts each track into self-contained pieces on a fixed rhythm, numbered from 0, placed on the meeting clock", async () => {
    FakeMR.instances = [];
    vi.useFakeTimers({ now: 1_000_000 });
    const { rec, got } = make([{ name: "TAB", stream: stream() }, { name: "MIC", stream: stream() }], { now: () => Date.now() });
    rec.start();
    vi.advanceTimersByTime(250);                                   // the loudness meter samples
    vi.advanceTimersByTime(180_000 - 250);                         // first piece complete
    expect(got.map((s) => `${s.track}${s.seq}`)).toEqual(["TAB0", "MIC0"]);
    expect(got[0].startMs).toBe(0);
    expect(got[0].durationMs).toBe(180_000);
    vi.advanceTimersByTime(180_000);
    expect(got.map((s) => `${s.track}${s.seq}`)).toEqual(["TAB0", "MIC0", "TAB1", "MIC1"]);
    expect(got[2].startMs).toBe(180_000);                          // the second piece begins three minutes in
    await rec.stop();
    expect(got.length).toBe(6);                                    // the last, partial piece is delivered too
    expect(got[4].seq).toBe(2);
    expect(got[4].durationMs).toBeLessThan(1);
  });

  it("uses the browser's speech-friendly audio format at a small bit rate", () => {
    FakeMR.instances = [];
    const { rec } = make([{ name: "TAB", stream: stream() }]);
    rec.start();
    expect(FakeMR.instances[0].options).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
    rec.stop();
    FakeMR.supported = [];
    FakeMR.instances = [];
    const { rec: r2 } = make([{ name: "TAB", stream: stream() }]);
    r2.start();
    expect(FakeMR.instances[0].options).toEqual({ audioBitsPerSecond: 32000 });             // unknown format: let the browser choose
    FakeMR.supported = ["audio/webm;codecs=opus"];
  });

  it("marks silent pieces so they aren't sent, and keeps loud ones", async () => {
    vi.useFakeTimers({ now: 0 });
    const { rec, got } = make([{ name: "MIC", stream: stream({ loud: 0 }) }, { name: "TAB", stream: stream({ loud: 0.4 }) }]);
    rec.start();
    vi.advanceTimersByTime(1000);
    await rec.stop();
    const byTrack = Object.fromEntries(got.map((s) => [s.track, s]));
    expect(byTrack.MIC.silent).toBe(true);
    expect(byTrack.TAB.silent).toBe(false);
    expect(SILENCE_PEAK).toBeGreaterThan(0);
  });

  it("a quiet piece stays judged by ITS OWN loudness even though the next piece has already started", async () => {
    vi.useFakeTimers({ now: 0 });
    const loud = stream({ loud: 0.6 });
    const { rec, got } = make([{ name: "TAB", stream: loud }]);
    rec.start();
    vi.advanceTimersByTime(60_000);
    loud.loud = 0;                                                 // goes quiet only AFTER the first piece has been loud
    vi.advanceTimersByTime(120_000);                               // → piece 0 ends; piece 1 starts quiet
    vi.advanceTimersByTime(60_000);
    await rec.stop();
    expect(got.map((s) => [s.seq, s.silent])).toEqual([[0, false], [1, true]]);
  });

  it("without a loudness meter nothing is ever treated as silent", async () => {
    const { rec, got } = make([{ name: "TAB", stream: stream({ loud: 0 }) }], { AudioContextCtor: undefined });
    rec.start();
    await rec.stop();
    expect(got[0].silent).toBe(false);
  });

  it("an empty piece is skipped, stop is safe to call twice, and recorder errors are reported", async () => {
    const errors = [];
    const { rec, got } = make([{ name: "TAB", stream: stream({ bytes: 0 }) }], { onError: (e) => errors.push(e) });
    rec.start();
    FakeMR.instances.at(-1).onerror({ error: new Error("device lost") });
    await rec.stop();
    await rec.stop();
    expect(got).toEqual([]);
    expect(errors[0].message).toBe("device lost");
  });

  it("reports each track's current loudness for a level indicator", () => {
    vi.useFakeTimers({ now: 0 });
    const { rec } = make([{ name: "TAB", stream: stream({ loud: 0.5 }) }]);
    rec.start();
    vi.advanceTimersByTime(250);
    expect(rec.levels().TAB).toBeGreaterThan(0.4);
    rec.stop();
  });
});

describe("createUploadQueue", () => {
  const nap = () => Promise.resolve();

  it("sends pieces in order, one at a time", async () => {
    const order = [];
    const q = createUploadQueue({ send: async (j) => { order.push(j.n); await nap(); }, sleep: nap });
    [1, 2, 3].forEach((n) => q.enqueue({ n }));
    await q.drain();
    expect(order).toEqual([1, 2, 3]);
    expect(q.sent).toBe(3);
    expect(q.failed).toEqual([]);
  });

  it("retries a temporary failure with growing pauses, then succeeds", async () => {
    let tries = 0;
    const pauses = [];
    const q = createUploadQueue({ send: async () => { tries++; if (tries < 3) throw Object.assign(new Error("net"), { response: { status: 503 } }); }, sleep: async (ms) => { pauses.push(ms); } });
    q.enqueue({ n: 1 });
    await q.drain();
    expect(tries).toBe(3);
    expect(pauses).toEqual([2000, 4000]);
    expect(q.sent).toBe(1);
  });

  it("gives up on a piece that keeps failing but carries on with the rest — one bad moment must not stop the recording", async () => {
    const q = createUploadQueue({ send: async (j) => { if (j.n === 2) throw new Error("offline"); }, sleep: nap });
    [1, 2, 3].forEach((n) => q.enqueue({ n }));
    await q.drain();
    expect(q.sent).toBe(2);
    expect(q.failed.map((j) => j.n)).toEqual([2]);
  });

  it("does not retry what retrying cannot fix (a refused or invalid piece), but does retry 'too many requests'", async () => {
    let calls = 0;
    const refused = createUploadQueue({ send: async () => { calls++; throw Object.assign(new Error("x"), { response: { status: 415 } }); }, sleep: nap });
    refused.enqueue({ n: 1 });
    await refused.drain();
    expect(calls).toBe(1);
    calls = 0;
    const limited = createUploadQueue({ send: async () => { calls++; if (calls < 2) throw Object.assign(new Error("x"), { response: { status: 429 } }); }, sleep: nap });
    limited.enqueue({ n: 1 });
    await limited.drain();
    expect(calls).toBe(2);
  });

  it("reports progress, accepts pieces while busy, and drain resolves immediately when idle", async () => {
    const seen = [];
    const q = createUploadQueue({ send: async () => nap(), sleep: nap, onProgress: (p) => seen.push(p) });
    await q.drain();
    q.enqueue({ n: 1 });
    q.enqueue({ n: 2 });                                           // added while the first is in flight
    await q.drain();
    expect(q.sent).toBe(2);
    expect(seen.at(-1)).toEqual({ sent: 2, failed: 0, pending: 0 });
    expect(q.pending).toBe(0);
  });
});

describe("small helpers", () => {
  it("formats the running time", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("picks the first supported audio format, or none", () => {
    expect(pickMimeType({ isTypeSupported: (m) => m === "audio/ogg;codecs=opus" })).toBe("audio/ogg;codecs=opus");
    expect(pickMimeType({ isTypeSupported: () => false })).toBe("");
    expect(pickMimeType(undefined)).toBe("");
    expect(SEGMENT_SECONDS).toBe(180);
  });
});
