package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** One meeting in the Universal Meeting Assistant. Collection {@code uma_meetings}; never shared with the old assistant. */
@Data
@Document(collection = "uma_meetings")
public class UmaMeeting {
    @Id private String id;
    private String organizationId;
    private String title;
    /** RECORDING_UPLOAD | TRANSCRIPT_IMPORT | MEETING_LINK | BROWSER_CAPTURE */
    private String source;
    /** GOOGLE_MEET | MS_TEAMS | ZOOM | WEBEX | OTHER | NONE */
    private String provider = "NONE";
    private String meetingUrl;
    private Instant meetingAt;                    // when it took place (defaults to when it was added)
    private String timezone;
    private String projectId;                     // optional: tasks default to this project
    private String createdBy;                     // email, lower-case
    private String visibility = "PRIVATE";       // PRIVATE | WORKSPACE
    private List<String> sharedWith = new ArrayList<>();

    private UmaStatus status = UmaStatus.CREATED;
    private String statusDetail;                  // plain-language line for people
    private String errorCode;                     // set while FAILED
    private String recoveryHint;                  // what the person can do
    private UmaStatus failedStage;               // where to resume on retry
    private int progressPercent;                  // 0-100 while working

    private boolean consentConfirmed;             // the uploader confirmed participants were told it was recorded / transcribed
    private String consentBy;
    private Instant consentAt;

    private Recording recording;
    private TranscriptInfo transcript;
    private int insightsVersion;

    private List<Transition> history = new ArrayList<>();
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();

    @Data
    public static class Recording {
        private String fileKey;                   // FileStorageService name; null once deleted
        private String fileName;                  // as uploaded
        private String mimeType;
        private long sizeBytes;
        private Long durationMs;
        private int chunksTotal;
        private int chunksDone;                   // transcription resumes from here after an interruption
        private Instant deletedAt;
    }

    @Data
    public static class TranscriptInfo {
        private String origin;                    // STT | IMPORT
        private String language;
        private int segmentCount;
        private String engine;                    // e.g. "openai-compatible"
        private String model;                     // e.g. "small"
        private Long processingMs;
        private boolean speakersKnown;            // false: speakers are "Unknown speaker" (no diarization)
        private boolean edited;
        private Instant updatedAt;
    }

    @Data
    public static class Transition {
        private Instant at = Instant.now();
        private UmaStatus from;
        private UmaStatus to;
        private String by;                        // email or "system"
        private String note;                      // content-free
    }
}
