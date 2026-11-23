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
    private FirefliesLink fireflies;
    private Instant meetingEndAt;             // when it is planned to end (scheduled / calendar meetings)
    private String calendarEventId;           // Google Calendar event this meeting came from or created
    private String calendarLink;              // the event in Google Calendar
    private List<String> attendees = new ArrayList<>();
    private String meetingType;                    // STANDUP | PLANNING | REVIEW | RETRO | CLIENT | ONE_ON_ONE | OTHER (optional)
    private String agenda;                         // optional, typed by a person (notes meetings)
    private boolean autoFireflies;            // send the Fireflies notetaker automatically when it starts
    private boolean firefliesOptOut;          // someone switched it off for this meeting on purpose: starting the meeting won't switch it back on
    // What Prowosma has seen of the meeting itself (from Google Meet, or from Fireflies being in it)
    private String liveState;                 // null (not seen yet) | IN_PROGRESS | ENDED
    private Instant startedAt;
    private Instant endedAt;
    private String liveSource;                // "Google Meet" | "Fireflies"
    private GoogleLink google;
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
        // Browser capture: short pieces per track, uploaded while the meeting runs. Empty for an uploaded file.
        private String recorderName;              // the person recording; their microphone lines are labelled with this name
        private Instant lastPieceAt;
        private List<Piece> pieces = new ArrayList<>();
    }

    @Data
    public static class GoogleLink {
        private String requestedBy;               // whose Google connection reads the transcript
        private String conferenceRecord;          // set once imported (a Meet session is imported into one meeting only)
        private Instant lastCheckAt;
        private int checks;
        private String lastNote;                  // what Google said at the last check, in plain words
    }

    @Data
    public static class FirefliesLink {
        private String transcriptId;              // set once the transcript was imported (a transcript is imported into one meeting only)
        private Instant notetakerSentAt;          // when the notetaker was asked to join
        private boolean inMeeting;                // Fireflies reported being in the call at the last check
        private String notetakerSentBy;
        private Instant lastCheckAt;
        private int checks;
        private boolean seen;                     // Fireflies has been in the call or listed a transcript at least once
        private Instant preparingSince;           // when Fireflies first listed the transcript without text (to stop waiting on it)
    }

    @Data
    public static class Piece {
        private String track;                     // MIC (the person recording) | TAB (the meeting's audio)
        private int seq;
        private long startMs;                     // on the meeting clock
        private long durationMs;
        private String fileKey;                   // null once deleted
        private long sizeBytes;
        private boolean transcribed;
        private List<Phrase> phrases = new ArrayList<>();   // speech-to-text result, kept until the pieces are merged
    }

    @Data
    public static class Phrase {
        private long startMs;                     // relative to the piece
        private long endMs;
        private String text;
        private Double noSpeechProb;
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
