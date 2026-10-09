package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One self-contained piece of a meeting's audio (about 3 minutes from the browser, or a whole uploaded file). The audio itself is
 * AES-256-GCM encrypted inside GridFS ({@code fileId}); this record holds only metadata and, once transcribed, the recognised phrases.
 * Deleted — audio and record — when the retention time passes, and never kept past it.
 */
@Data
@Document(collection = "meeting_audio_chunks")
public class MeetingAudioChunk {

    @Data
    public static class Phrase {
        private long startMs;
        private long endMs;
        private String text;
        private Double noSpeechProb;
    }

    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String track;                 // MIC | TAB | MIXED
    private int seq;                      // order within its track
    private long startMs;                 // where this piece begins on the meeting clock
    private long durationMs;
    private String kind;                  // webm | ogg | wav | mp3 | m4a | flac | aac
    private long sizeBytes;               // size of the audio before encryption
    private String fileId;                // GridFS id of the encrypted audio

    private String status = "PENDING";    // PENDING | DONE | FAILED
    private int attempts;
    private String error;                 // a plain reason, never the server's raw reply
    private String language;
    private List<Phrase> phrases = new ArrayList<>();

    private Instant createdAt = Instant.now();
    private Instant transcribedAt;
    private Instant expireAt;             // delete audio and record at this time
}
