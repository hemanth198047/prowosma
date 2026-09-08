package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "sprints")
public class Sprint {
    @Id
    private String id;
    private String organizationId;
    private String projectId;       // optional — sprint can span a project
    private String name;            // e.g. "Sprint 1"
    private String goal;            // sprint goal statement
    private String status = "PLANNING"; // PLANNING | ACTIVE | COMPLETED | CANCELLED
    private LocalDateTime startDate;
    private LocalDateTime endDate;
    private List<String> taskIds = new ArrayList<>(); // tasks in this sprint
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Sprint goal milestones ─────────────────────────────────
    private List<SprintGoalMilestone> goalMilestones = new ArrayList<>();
    private int    capacityPoints  = 0;   // planned capacity in story points
    private String linkedEpicId;          // primary epic this sprint advances

    // C-3: Retrospective (embedded, not a separate collection)
    private Retrospective retrospective;

    @Data
    public static class SprintGoalMilestone {
        private String  id        = java.util.UUID.randomUUID().toString();
        private String  milestone;         // e.g. "Complete auth module"
        private boolean achieved  = false;
        private String  linkedGoalId;
    }

    @Data
    public static class Retrospective {
        private List<String> wentWell     = new ArrayList<>();
        private List<String> improvements = new ArrayList<>();
        private List<String> actionItems  = new ArrayList<>();
        private String mood = "NEUTRAL"; // GREAT | GOOD | NEUTRAL | BAD
        private String completedBy;
        private LocalDateTime completedAt;
    }
}
