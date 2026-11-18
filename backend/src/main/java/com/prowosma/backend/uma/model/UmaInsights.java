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
    private List<ProjectItem> projects = new ArrayList<>();   // projects the meeting asked for, suggested or referred to
    private Automation automation;                 // what was done automatically after the analysis (from saved records)
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
        private String dependsOn;                  // what it waits for, as said ("after the API specifications are finalised"); null = none said
        private boolean ownerVerified;             // owner identity confirmed (invited by email / organiser), not only a name match
        private String ownerBasis;                 // why the owner is (or isn't) treated as verified
        private boolean automatic;                 // the task was created automatically (not by a person approving it)
        private String reviewReason;               // why it waits for a person, when it does
        private java.time.LocalDate dueSuggested;  // the likely date when the spoken deadline is ambiguous ("next Friday"); never used without a person
        private String dueNote;                    // why the deadline needs confirming
    }

    /** A project the meeting asked for (CREATE), suggested (PROPOSAL) or referred to by name (EXISTING). */
    @Data
    public static class ProjectItem {
        private String id;                         // "p" + hash of the name; source key = "uma:" + meetingId + ":" + id
        private String name;
        private String description;
        private String intent;                     // CREATE | PROPOSAL | EXISTING
        private String requestedBy;                // only as said
        private List<Integer> evidence = new ArrayList<>();
        private String status = "PROPOSED";        // PROPOSED | CREATED | LINKED | DISMISSED | FAILED
        private String projectId;                  // the created or matched project
        private boolean automatic;
        private String decidedBy;
        private Instant decidedAt;
        private String failureReason;
        private String reviewReason;
    }

    /** The automation report. Every number is counted from saved records after the run, never from what the model said. */
    @Data
    public static class Automation {
        private Instant ranAt;
        private String ranAs;                      // the meeting's owner: their permissions applied
        private boolean tasksEnabled;
        private boolean projectsEnabled;
        private int tasksCreated;
        private int tasksAssigned;
        private int projectsCreated;
        private int projectsLinked;
        private int needsReview;
        private int failed;
        private List<String> notes = new ArrayList<>();
    }
}
