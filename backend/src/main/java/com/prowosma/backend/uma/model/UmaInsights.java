package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * What the AI found in one meeting. Collection {@code uma_insights}, one document per meeting (id = meeting id).
 * Every statement carries {@code evidence}: transcript line numbers that the server has checked exist.
 */
@Data
@Document(collection = "uma_insights")
public class UmaInsights {
    @Id private String id;                         // = meetingId
    private String organizationId;
    private String meetingId;
    private int version;
    private Instant generatedAt;
    private String provider;                       // which model answered
    private String model;
    private int inputTokens;
    private int outputTokens;

    private String summary;                        // executive summary, plain text
    private List<Topic> notes = new ArrayList<>();
    private List<Decision> decisions = new ArrayList<>();
    private List<ActionItem> actions = new ArrayList<>();
    private List<Finding> risks = new ArrayList<>();
    private List<Finding> questions = new ArrayList<>();
    private List<Finding> followUps = new ArrayList<>();
    private int droppedForMissingEvidence;         // statements the model made without valid line references
    private List<String> warnings = new ArrayList<>();

    @Data
    public static class Topic {
        private String title;
        private List<Point> points = new ArrayList<>();
    }

    @Data
    public static class Point {
        private String text;
        private List<Integer> evidence = new ArrayList<>();
    }

    @Data
    public static class Decision {
        private String id;
        private String text;
        private String decidedBy;                  // only as stated; null when not said
        private List<Integer> evidence = new ArrayList<>();
    }

    @Data
    public static class Finding {
        private String id;
        private String text;
        private String kind;                       // RISK | BLOCKER | DEPENDENCY | QUESTION | FOLLOW_UP
        private List<Integer> evidence = new ArrayList<>();
    }

    @Data
    public static class Candidate {
        private String memberId;
        private String name;
    }

    @Data
    public static class ActionItem {
        private String id;                         // stable within the meeting; task source key = "uma:" + meetingId + ":" + id
        private String title;
        private String description;
        private String ownerSpoken;                // exactly as said; null = nobody named
        private String ownerMemberId;              // set only when the name matches exactly one workspace member
        private String ownerNote;                  // why the owner is only a suggestion, when it is
        private String ownerState;                 // MATCHED | SUGGESTED | AMBIGUOUS | NOT_A_MEMBER | UNASSIGNED
        private List<Candidate> ownerCandidates = new ArrayList<>();   // shown to pick from; never auto-assigned
        private String dueSpoken;                  // exactly as said; null = no deadline mentioned
        private java.time.LocalDate dueDate;       // set only when the spoken deadline resolves reliably against the meeting date
        private String dueState;                   // EXACT | RESOLVED | UNCLEAR | UNSPECIFIED
        private String priority = "MEDIUM";        // LOW | MEDIUM | HIGH
        private String projectId;
        private String confidence = "MEDIUM";      // HIGH | MEDIUM | LOW - how clearly it was agreed
        private List<Integer> evidence = new ArrayList<>();
        private String status = "PENDING";         // PENDING | APPROVED | REJECTED | CREATED | FAILED
        private boolean edited;                    // a person changed it: regenerating keeps their version
        private String createdTaskId;
        private String decidedBy;
        private Instant decidedAt;
        private String failureReason;
    }
}
