package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A meeting-originated action item, kept as its own top-level record (the
 * same pattern already used by {@link RaidEntry} and {@link Decision}) so
 * that carrying an item forward across many meetings never creates a
 * duplicate business record — meetings only ever reference this id.
 *
 * This is intentionally lighter-weight than {@link Task}: it does not carry
 * sprint/epic/checklist/SLA machinery. When an item becomes real tracked
 * work, the existing manual "convert to Task" flow (already present in the
 * frontend Meetings page) sets {@link #convertedTaskId} — conversion stays
 * an explicit human decision, not automatic.
 */
@Data
@Document(collection = "meeting_action_items")
public class MeetingActionItem {
    @Id private String id;
    private String organizationId;

    // A list rather than a single id so one action can legitimately span
    // multiple projects (e.g. "infra to upgrade auth for Projects A, B, C")
    // without being duplicated per project.
    private List<String> projectIds = new ArrayList<>();

    private String title;
    private String description;
    private String owner; // email — intentionally independent of meeting attendees

    private String priority = "MEDIUM"; // LOW | MEDIUM | HIGH
    private String status   = "OPEN";   // OPEN | IN_PROGRESS | COMPLETED | DEFERRED | DISMISSED

    private LocalDateTime dueDate;

    // Only meaningful when status = DEFERRED. A deferred item is
    // intentionally postponed and should not read as "stuck" the way an
    // overdue OPEN item does.
    private LocalDateTime deferredUntil;

    // Provenance / continuity tracking
    private String sourceMeetingId;              // the meeting that first raised this item
    private List<String> meetingIds = new ArrayList<>(); // append-only; every meeting this item was
                                                           // carried into (including the source meeting).
                                                           // meetingIds.size() - 1 = carry-forward count —
                                                           // derived, not a separate counter to keep in sync.

    private String convertedTaskId; // set once this item is promoted to a real Task

    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private LocalDateTime completedAt;
}
