package com.prowosma.backend.uma.core;

import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Splits a recording into speech-to-text sized pieces with ffmpeg: mono, 16 kHz, 48 kbit/s MP3 (≈ 3.6 MB per 10 minutes, well under the
 * 25 MB limit of cloud transcription APIs). Pieces overlap by nothing and carry their start offset, so timestamps stay true to the
 * original. When ffmpeg isn't installed the recording is sent as one piece (fine for self-hosted servers; long files may exceed cloud limits).
 */
@Slf4j
public final class AudioSplitter {
    public static final int DEFAULT_CHUNK_SECONDS = 600;

    public record Piece(int index, long startMs, Path file, String mimeType) {}

    private AudioSplitter() {}

    public static boolean ffmpegAvailable() {
        try {
            Process p = new ProcessBuilder("ffmpeg", "-version").redirectErrorStream(true).start();
            p.getInputStream().readAllBytes();
            return p.waitFor(10, TimeUnit.SECONDS) && p.exitValue() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Duration in milliseconds, or null when it can't be read (corrupt or not audio/video). */
    public static Long durationMs(Path input) {
        try {
            Process p = new ProcessBuilder("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input.toString())
                    .redirectErrorStream(true).start();
            String out = new String(p.getInputStream().readAllBytes()).trim();
            if (!p.waitFor(60, TimeUnit.SECONDS) || p.exitValue() != 0) return null;
            double s = Double.parseDouble(out.split("\\R")[0]);
            return s > 0 ? Math.round(s * 1000) : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Start offsets (ms) of each piece for a recording of the given length. */
    public static List<Long> plan(long durationMs, int chunkSeconds) {
        List<Long> starts = new ArrayList<>();
        long step = chunkSeconds * 1000L;
        for (long t = 0; t < durationMs; t += step) starts.add(t);
        if (starts.isEmpty()) starts.add(0L);
        return starts;
    }

    /** Cuts one piece [startMs, startMs + chunkSeconds) into {@code outDir}. */
    public static Piece cut(Path input, int index, long startMs, int chunkSeconds, Path outDir) throws IOException {
        Path out = outDir.resolve("piece-" + index + ".mp3");
        List<String> cmd = List.of("ffmpeg", "-nostdin", "-loglevel", "error", "-y",
                "-ss", String.format(java.util.Locale.ROOT, "%.3f", startMs / 1000.0), "-t", String.valueOf(chunkSeconds),
                "-i", input.toString(), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", out.toString());
        try {
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            p.getInputStream().readAllBytes();
            if (!p.waitFor(10, TimeUnit.MINUTES)) { p.destroyForcibly(); throw new IOException("Audio conversion timed out"); }
            if (p.exitValue() != 0 || !Files.exists(out) || Files.size(out) == 0) throw new IOException("Audio conversion failed");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted");
        }
        return new Piece(index, startMs, out, "audio/mpeg");
    }
}
