package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * One proposed action from a meeting. {@code stableId} never changes (it will key duplicate-proof task creation). Every resolved
 * fact records HOW it was resolved, and every unresolved one says why — nothing is guessed.
 */
@Data
@Document(collection = "meeting_actions")
public class MeetingAction {
    @Id private String id;
    @Version private Long version;
    private String organizationId;
    private String sessionId;
    private String stableId;

    private String title;
    private String description;
    private String type = "TASK";                  // TASK | BUG | FOLLOW_UP | RESEARCH | OTHER
    private String kind = "UNRESOLVED";            // COMMITMENT | SUGGESTION | UNRESOLVED (what was SAID)
    private boolean kindConfirmedByUser;
    private String status = "PROPOSED";            // PROPOSED | APPROVED | REJECTED | MERGED | WITHDRAWN
    private String mergedInto;
    private String duplicateOf;                    // suspected duplicate of another action (id)
    private boolean missingFromLatestRun;

    // owner
    private String ownerAsSpoken;
    private boolean ownerIsSpeaker;
    private String ownerSpeakerLabel;              // the label the SOURCE gave the speaker (never inferred from a voice)
    private String ownerState = "UNSPECIFIED";     // RESOLVED | AMBIGUOUS | SUGGESTED | NOT_IN_DIRECTORY | NOT_ELIGIBLE | TEAM | UNSPECIFIED | MANUAL
    private String ownerBasis;                     // EXACT_NAME | EMAIL | SPEAKER_LABEL | USER
    private String ownerUserId;                    // TeamMember id — only when resolved/confirmed
    private String ownerName;
    private String ownerEmail;
    private List<Person> ownerCandidates = new ArrayList<>();

    // project
    private String projectState = "UNRESOLVED";    // EXISTING | PROPOSED_NEW | AMBIGUOUS | UNRESOLVED | MANUAL
    private String projectBasis;                   // NAMED | SELECTED | USER
    private String projectId;
    private String projectName;
    private String proposedProjectName;
    private boolean projectDiffers;
    private List<Person> projectCandidates = new ArrayList<>();   // id + name of candidate projects

    // deadline & priority
    private String deadlineText;
    private LocalDate deadlineDate;                // calendar date in the meeting's timezone
    private String deadlineStatus = "UNRESOLVED";  // EXACT | RESOLVED | APPROXIMATE | AMBIGUOUS | UNRESOLVED | MANUAL
    private String deadlineNote;
    private String timezone;
    private String priority = "MEDIUM";
    private String priorityBasis = "DEFAULT";      // STATED (discussed) | DEFAULT (application default) | USER

    private List<String> dependencies = new ArrayList<>();
    private List<String> acceptanceCriteria = new ArrayList<>();
    private List<Integer> evidence = new ArrayList<>();
    private List<Integer> priorityEvidence = new ArrayList<>();

    private String confidence = "LOW";             // HIGH | MEDIUM | LOW — computed from facts
    private List<Reason> reasons = new ArrayList<>();
    private boolean valid;                         // eligible for bulk approval
    private boolean edited;
    private String extractionId;
    private String updatedBy;
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();

    @Data
    public static class Person {
        private String id;
        private String name;
        private String email;
    }

    @Data
    public static class Reason {
        private String code;
        private String message;
        private boolean blocking;
    }
}
