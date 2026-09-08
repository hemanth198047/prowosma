package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Data
@Document(collection = "automations")
public class Automation {
    @Id
    private String id;
    private String organizationId;
    private String name;
    private String description;
    private boolean enabled = true;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Trigger ─────────────────────────────────────────────────
    // TASK_STATUS_CHANGED | TASK_CREATED | TASK_OVERDUE | TASK_ASSIGNED
    // PROJECT_STATUS_CHANGED | GOAL_ACHIEVED | SPRINT_STARTED | SPRINT_COMPLETED
    // SCHEDULED | APPROVAL_APPROVED | APPROVAL_REJECTED
    private String triggerType;
    private Map<String, Object> triggerConfig; // e.g. {status: "DONE"}, {cronExpr: "0 9 * * MON"}

    // ── Conditions ──────────────────────────────────────────────
    private List<Condition> conditions = new ArrayList<>();
    private String conditionOperator = "AND"; // AND | OR

    // ── Actions ─────────────────────────────────────────────────
    private List<Action> actions = new ArrayList<>();

    // ── Execution history ───────────────────────────────────────
    private int runCount  = 0;
    private int failCount = 0;
    private LocalDateTime lastRunAt;
    private List<ExecutionLog> recentLogs = new ArrayList<>(); // keep last 20

    // ── Workflow versioning ───────────────────────────────────
    private int version = 1;
    private List<AutomationVersion> versionHistory = new ArrayList<>(); // last 10 versions

    @Data
    public static class AutomationVersion {
        private String id = java.util.UUID.randomUUID().toString();
        private int version;
        private String changedBy;
        private String changeNote;
        private String snapshot; // JSON snapshot of full automation at that version
        private LocalDateTime savedAt = LocalDateTime.now();
    }

    @Data
    public static class Condition {
        private String id;
        private String field;    // priority | status | assignee | project | tag | dueDate
        private String operator; // equals | not_equals | contains | greater_than | less_than | is_empty
        private String value;
    }

    @Data
    public static class Action {
        private String id;
        // SEND_NOTIFICATION | CHANGE_STATUS | CHANGE_PRIORITY | ASSIGN_TO
        // CREATE_TASK | ADD_TAG | REMOVE_TAG | POST_COMMENT
        // TRIGGER_WEBHOOK | REQUEST_APPROVAL | SEND_EMAIL
        private String type;
        private Map<String, Object> config; // action-specific config
    }

    @Data
    public static class ExecutionLog {
        private String id;
        private String entityType; // TASK | PROJECT | GOAL
        private String entityId;
        private boolean success;
        private String message;
        private LocalDateTime executedAt;
    }
}
