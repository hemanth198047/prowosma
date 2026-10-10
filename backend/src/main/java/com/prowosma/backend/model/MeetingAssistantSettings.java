package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** One document per organization. Absent document = defaults below. */
@Data
@Document(collection = "meeting_assistant_settings")
public class MeetingAssistantSettings {
    @Id private String id;
    private String organizationId;

    private String assistantName = "Prowosma Meeting Assistant";

    /** Roles allowed to request the assistant. Viewers can never mutate (RoleGuardFilter). */
    private List<String> sendRoles = new ArrayList<>(List.of("OWNER", "ADMIN", "MEMBER"));
    /** Default visibility of a new session: PRIVATE (requester + admins) or WORKSPACE. */
    private String defaultVisibility = "PRIVATE";

    /** Generate summary, minutes and notes automatically when a transcript arrives (only if AI is configured). */
    private boolean autoGenerateOutputs = true;

    /** After the documents are ready, also extract structured actions (one more model pass). Needs AI to be ready. */
    private boolean autoExtractActions = true;

    private boolean autoCreateTasks = false;
    private boolean autoCreateProjects = false;

    private int transcriptRetentionDays = 90;
    private int generatedContentRetentionDays = 365;
    private boolean retainRawAudio = false;
    private int rawAudioRetentionDays = 0;
    private String outputLanguage = "en";

    // ── Recording and speech-to-text (OFF unless an admin turns it on; nothing here changes how Google Meet or Teams import works) ──
    private boolean recordingEnabled = false;
    private String sttBaseUrl;                  // an OpenAI-compatible speech-to-text server, e.g. a free Whisper server on the client's own VPS
    @com.fasterxml.jackson.annotation.JsonIgnore
    private String sttApiKeyEnc;                // encrypted; NEVER sent to the browser
    private String sttModel;
    private String sttLanguage;                 // blank = detect automatically
    private int audioRetentionHours = 24;       // audio is deleted this long after a recording ends; 0 = as soon as it has been turned into text

    /** What the settings page may know about the key: only that one is saved. */
    public boolean isSttKeySaved() { return sttApiKeyEnc != null && !sttApiKeyEnc.isBlank(); }

    // ── Fireflies.ai notetaker (OFF unless an admin turns it on) ──
    private boolean firefliesEnabled = false;
    @com.fasterxml.jackson.annotation.JsonIgnore
    private String firefliesApiKeyEnc;          // encrypted; NEVER sent to the browser

    public boolean isFirefliesKeySaved() { return firefliesApiKeyEnc != null && !firefliesApiKeyEnc.isBlank(); }

    private String updatedBy;
    private Instant updatedAt;
}
