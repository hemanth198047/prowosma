package com.prowosma.backend.meetingassistant;

import java.time.Duration;
import java.time.Instant;

/**
 * The fixed rules for browser/uploaded meeting recordings: limits, what counts as audio, and how long audio is kept.
 * Pure and dependency-free so each rule is unit-tested.
 */
public final class RecordingRules {

    private RecordingRules() {}

    /** The browser starts a fresh, self-contained audio file this often. */
    public static final int SEGMENT_SECONDS = 180;
    public static final long MAX_CHUNK_BYTES = 6_000_000L;          // a 3-minute speech segment is ~1 MB
    public static final long MAX_UPLOAD_BYTES = 25_000_000L;        // the usual limit of speech-to-text services
    public static final long MAX_SESSION_BYTES = 400_000_000L;
    public static final int MAX_CHUNKS_PER_SESSION = 1000;
    public static final int DEFAULT_RETENTION_HOURS = 24;
    public static final int MAX_RETENTION_HOURS = 72;
    /** A recording that stops sending audio this long is treated as finished (closed tab, lost connection, crashed browser). */
    public static final Duration ABANDONED_AFTER = Duration.ofMinutes(10);

    public static final String TRACK_MIC = "MIC";       // the recording person's own microphone → "You"
    public static final String TRACK_TAB = "TAB";       // the meeting tab's audio → "Other participants"
    public static final String TRACK_MIXED = "MIXED";   // an uploaded file: speakers unknown

    public static String track(String raw) {
        if (raw == null) return null;
        String t = raw.trim().toUpperCase(java.util.Locale.ROOT);
        return t.equals(TRACK_MIC) || t.equals(TRACK_TAB) || t.equals(TRACK_MIXED) ? t : null;
    }

    /** Audio kept for between 0 (delete as soon as it's been turned into text) and 72 hours; anything else falls back to the default. */
    public static int clampRetentionHours(Integer requested) {
        if (requested == null) return DEFAULT_RETENTION_HOURS;
        return Math.max(0, Math.min(MAX_RETENTION_HOURS, requested));
    }

    /** When the audio is due to be deleted: {@code hours} after the recording finished (0 = right away). */
    public static Instant expiryAfter(Instant finishedAt, int hours) {
        return finishedAt.plus(Duration.ofHours(Math.max(0, hours)));
    }

    /**
     * Recognises real audio from the file's first bytes, so the server never stores arbitrary files. Returns an extension
     * (webm, ogg, wav, mp3, m4a, flac, aac) or null when it isn't audio we accept.
     */
    public static String audioKind(byte[] b) {
        if (b == null || b.length < 12) return null;
        if (u(b, 0) == 0x1A && u(b, 1) == 0x45 && u(b, 2) == 0xDF && u(b, 3) == 0xA3) return "webm";
        if (b[0] == 'O' && b[1] == 'g' && b[2] == 'g' && b[3] == 'S') return "ogg";
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'A' && b[10] == 'V' && b[11] == 'E') return "wav";
        if (b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') return "m4a";
        if (b[0] == 'f' && b[1] == 'L' && b[2] == 'a' && b[3] == 'C') return "flac";
        if (u(b, 0) == 0xFF && (u(b, 1) == 0xF1 || u(b, 1) == 0xF9)) return "aac";
        if (b[0] == 'I' && b[1] == 'D' && b[2] == '3') return "mp3";
        if (u(b, 0) == 0xFF && (u(b, 1) & 0xE0) == 0xE0) return "mp3";
        return null;
    }

    public static String mimeOf(String kind) {
        if (kind == null) return "application/octet-stream";
        return switch (kind) {
            case "webm" -> "audio/webm";
            case "ogg" -> "audio/ogg";
            case "wav" -> "audio/wav";
            case "mp3" -> "audio/mpeg";
            case "m4a" -> "audio/mp4";
            case "flac" -> "audio/flac";
            case "aac" -> "audio/aac";
            default -> "application/octet-stream";
        };
    }

    private static int u(byte[] b, int i) { return b[i] & 0xFF; }
}
