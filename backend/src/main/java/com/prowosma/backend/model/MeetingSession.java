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
    private String captureStatus = "NONE";          // NONE | PARTIAL | FULL
    private String consentStatus = "NOT_APPLICABLE";// no audio is captured in transcript-only mode

    private String visibility = "PRIVATE";          // PRIVATE | WORKSPACE
    private List<String> sharedWith = new ArrayList<>();

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
