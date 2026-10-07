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

    private boolean autoCreateTasks = false;
    private boolean autoCreateProjects = false;

    private int transcriptRetentionDays = 90;
    private int generatedContentRetentionDays = 365;
    private boolean retainRawAudio = false;
    private int rawAudioRetentionDays = 0;
    private String outputLanguage = "en";

    private String updatedBy;
    private Instant updatedAt;
}
