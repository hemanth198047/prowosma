package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.List;

@Data
@Document(collection = "tasks")
public class Task {
    @Id
    private String id;
    private String organizationId;
    @jakarta.validation.constraints.NotBlank(message = "Task title is required")
    private String title;
    private String description;
    private String projectId;
    private String status= "TODO"; // TODO, IN_PROGRESS, DONE
    private String priority = "MEDIUM"; // LOW, MEDIUM, HIGH
    private LocalDateTime startDate;  // F08 Gantt
    private LocalDateTime dueDate;
    private List<String> tags;
    private String recurrence; // NONE, DAILY, WEEKLY, MONTHLY
    private String createdBy;   // email of user who created this task
    private Integer storyPoints;  // C-2: story points for sprint planning
    private String  sprintId;     // C-1: which sprint this task belongs to
    private List<Comment> comments = new java.util.ArrayList<>();
    private List<TimeLog> timeLogs = new java.util.ArrayList<>();
    private java.util.List<Attachment> attachments = new java.util.ArrayList<>();
    private java.util.List<String> blockedByTaskIds = new java.util.ArrayList<>();
    private java.util.Map<String, String> customFieldValues = new java.util.HashMap<>();
    private java.util.List<String> assigneeIds = new java.util.ArrayList<>();
    private LocalDateTime lastRecurred;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Subtasks / nested tasks ────────────────────────────────
    private String  parentTaskId;                                   // null = root task
    private java.util.List<String> subtaskIds = new java.util.ArrayList<>();

    // ── Checklists ─────────────────────────────────────────────
    private java.util.List<ChecklistItem> checklist = new java.util.ArrayList<>();

    // ── Severity ───────────────────────────────────────────────
    private String  severity = "NONE";    // NONE | LOW | MEDIUM | HIGH | CRITICAL
    private String  type     = "TASK";    // TASK | BUG | STORY | EPIC | FEATURE | IMPROVEMENT

    // ── Watchers ───────────────────────────────────────────────
    private java.util.List<String> watcherIds = new java.util.ArrayList<>();  // emails

    // ── SLA ────────────────────────────────────────────────────
    private Integer slaHours;             // SLA target in hours from creation
    private java.time.LocalDateTime slaDeadline;
    private String  slaStatus = "NONE";   // NONE | ON_TRACK | AT_RISK | BREACHED
    private boolean slaBreach = false;

    // ── Task relationships ──────────────────────────────────────
    private java.util.List<TaskRelationship> relationships = new java.util.ArrayList<>();

    // ── Goal contribution ───────────────────────────────────────
    private String  linkedGoalId;          // which goal this task contributes to
    private int     goalContributionWeight = 1; // 1-10 weight

    // ── Epic linkage ────────────────────────────────────────────
    private String  epicId;               // parent epic task id

    @lombok.Data
    public static class ChecklistItem {
        private String  id      = java.util.UUID.randomUUID().toString();
        private String  text;
        private boolean checked = false;
        private String  assignee;
        private java.time.LocalDateTime dueDate;
    }

    @lombok.Data
    public static class TaskRelationship {
        private String id     = java.util.UUID.randomUUID().toString();
        private String type;    // BLOCKS | BLOCKED_BY | RELATES_TO | DUPLICATE_OF | DUPLICATED_BY | CAUSED_BY
        private String targetTaskId;
        private String note;
    }
}

