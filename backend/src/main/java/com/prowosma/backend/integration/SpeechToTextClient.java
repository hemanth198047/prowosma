package com.prowosma.backend.integration;

import java.util.List;

/** Turns one piece of audio into timed text, using whichever speech-to-text server an admin configured. */
public interface SpeechToTextClient {

    /** {@code apiKey} may be blank (many self-hosted servers need none); {@code language} may be blank (auto-detect). */
    record Settings(String baseUrl, String apiKey, String model, String language) {}

    record Segment(long startMs, long endMs, String text, Double noSpeechProb) {}

    record Result(String language, List<Segment> segments) {}

    Result transcribe(Settings settings, byte[] audio, String mimeType, String fileName);
}
