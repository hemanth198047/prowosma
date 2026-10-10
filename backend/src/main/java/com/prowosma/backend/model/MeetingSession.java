package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One occurrence of a meeting the assistant was asked to cover. A recurring
 * meeting that reuses one URL produces one session per occurrence.
 *
 * {@code activeKey} is set only while the session is non-terminal and carries a
 * sparse UNIQUE index (see MeetingAssistantIndexConfig). That index — not
 * application code — is what prevents two concurrent requests from creating two
 * assistants for the same occurrence.
 */
@Data
@Document(collection = "meeting_sessions")
public class MeetingSession {
    @Id private String id;
    @Version private Long version;

    private String organizationId;
    private String provider;            // GOOGLE_MEET | MS_TEAMS
    private String meetingKey;          // stable per link, shared by all occurrences
    private String meetingUrl;          // canonical; passcodes/query stripped
    private String title;
    private String requestedBy;         // email

    private String projectMode = "DETECT";  // SELECTED | DETECT
    private String projectId;

    /** TRANSCRIPT_AFTER_MEETING today. LIVE_ASSISTANT is reserved for a provider that can join live. */
    private String ingestionMode = "TRANSCRIPT_AFTER_MEETING";
    private String status = "SCHEDULED";
    private String statusDetail;        // plain-language, shown to the user
    private String failureCode;
    private String recoveryAction;      // plain-language next step

    private Instant scheduledFor;
    private String timezone;
    private Instant startedAt;
    private Instant endedAt;

    private String activeKey;           // null once terminal
    private String captureStatus = "NONE";          // NONE | PARTIAL | FULL | UPLOADED (completeness unverifiable)
    private String consentStatus = "NOT_APPLICABLE";// no audio is captured in transcript-only mode

    private String visibility = "PRIVATE";          // PRIVATE | WORKSPACE
    private List<String> sharedWith = new ArrayList<>();

    // Transcript bookkeeping (the text itself lives in transcript_segments)
    private String transcriptSource;        // UPLOAD | GOOGLE_MEET
    private int transcriptGeneration;       // 0 = none; bumped on every replacement
    private int segmentCount;
    private Instant transcriptReceivedAt;
    private String transcriptReceivedBy;
    private String transcriptNote;          // completeness / provenance, plain language
    private Instant transcriptPurgedAt;     // set when retention removed the text
    private String actionsStatus = "NONE";   // NONE | RUNNING | READY | FAILED  (action extraction; independent of the meeting status)
    private String actionsMessage;
    private Instant actionsExtractedAt;
    private boolean actionsPendingDiff;     // a re-run found differences waiting for review
    private Instant outputsGeneratedAt;    // last time summary/minutes/notes were produced
    private String conferenceRecord;        // the platform transcript/record this session was matched to (Google conference record, or Teams transcript id)
    // What the most recent check of the meeting platform found — shown to the person waiting, so the page never just repeats the registration text.
    // Recording (browser capture or an uploaded audio file). null = this meeting has no recording.
    // Fireflies notetaker. null = no notetaker was sent and no transcript came from Fireflies.
    private String platform;                    // GOOGLE_MEET | ZOOM | MS_TEAMS | WEBEX — what kind of meeting a Fireflies session is about
    private String firefliesState;              // SENT | IMPORTED
    private java.time.Instant notetakerSentAt;
    private String firefliesClaimKey;           // organization|ff|transcriptId — unique, so one transcript can only ever belong to one meeting
    private String recordingState;              // RECORDING | UPLOADED | TRANSCRIBING | DONE | DELETED | EXPIRED
    private java.time.Instant recordingStartedAt;
    private java.time.Instant recordingFinishedAt;
    private java.time.Instant audioExpiresAt;   // when the stored audio will be deleted
    private java.time.Instant audioDeletedAt;
    private java.time.Instant lastCheckAt;
    private String lastCheckCode;
    private String lastCheckMessage;
    private java.util.Map<String, Object> lastCheckFacts;
    private String organizerId;             // Microsoft Entra object id of the Teams organizer (from the invitation link), if present
    private String tenantHint;              // Microsoft tenant id found in the Teams link, if present

    private boolean simulated;          // development fixture — never a real meeting
    private int retryCount;
    private List<StatusEvent> history = new ArrayList<>();

    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();

    @Data
    public static class StatusEvent {
        private Instant at = Instant.now();
        private String from;
        private String to;
        private String by;
        private String note;
    }
}
