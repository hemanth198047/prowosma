package com.prowosma.backend.integration;

import java.util.List;

/** Turns one piece of audio into timed text, using whichever speech-to-text server an admin configured. */
public interface SpeechToTextClient {

    /** {@code apiKey} may be blank (many self-hosted servers need none); {@code language} may be blank (auto-detect). */
    record Settings(String baseUrl, String apiKey, String model, String language) {}

    /** {@code speaker} is a neutral label from speaker separation ("Speaker 1"), never a name; null when the server doesn't separate speakers. */
    record Segment(long startMs, long endMs, String text, Double noSpeechProb, String speaker) {
        public Segment(long startMs, long endMs, String text, Double noSpeechProb) { this(startMs, endMs, text, noSpeechProb, null); }
    }

    record Result(String language, List<Segment> segments) {}

    Result transcribe(Settings settings, byte[] audio, String mimeType, String fileName);
}
