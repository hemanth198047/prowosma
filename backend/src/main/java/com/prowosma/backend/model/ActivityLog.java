package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

@Data
@Document(collection = "activity_logs")
public class ActivityLog {
    @Id private String id;
    private String organizationId;

    /* ── Core audit fields (used by ActivityLogController) ── */
    private String actor;           // user email who performed the action
    private String action;          // e.g. "task.created", "TASK_COMPLETED"
    private String entityType;      // "task", "project", "goal", etc.
    private String entityId;
    private String entityTitle;     // display name of the entity (used by controller)
    private String details;         // extra JSON / description (used by controller)
    private String ipAddress;

    /* ── Extended fields required by ActivityLogService ──── */
    private String entityName;      // alias / display name (used by service)
    private String oldValue;        // before-state for change tracking
    private String newValue;        // after-state for change tracking
    private String projectId;       // entity scope
    private String taskId;
    private String goalId;
    private String userAgent;       // browser / client agent string
    private String severity;        // INFO | WARN | ERROR | CRITICAL
    private String riskLevel;       // LOW | MEDIUM | HIGH | CRITICAL
    private String performedBy;     // performer email (service uses this)
    private String performedByName; // display name of performer
    private String humanReadable;   // plain English sentence e.g. "Alice created task X"
    private String correlationId;   // groups related log entries into a session

    private String entryHash;       // SHA-256(previousHash + core fields) — see ActivityLogService's hash-chain comment
    private String previousHash;    // this org's chain — null only for the very first entry in a given org

    // Truncated to millisecond precision (not the JVM's nanosecond-precision
    // LocalDateTime.now()) because that's the precision MongoDB actually
    // stores a Date as. The hash chain in ActivityLogService includes
    // createdAt in its canonical string both when the hash is first
    // computed (in-memory, pre-save) and again when verifyChainIntegrity()
    // recomputes it from data read back out of Mongo — if those two values
    // differ by sub-millisecond nanoseconds, every entry's hash mismatches
    // on verification even though nothing was tampered with. Truncating up
    // front keeps the pre-save and post-round-trip values identical.
    private LocalDateTime createdAt = LocalDateTime.now().truncatedTo(ChronoUnit.MILLIS);
}