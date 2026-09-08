package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "raid_entries")
public class RaidEntry {
    @Id private String id;
    private String organizationId;
    private String projectId;
    // RISK | ASSUMPTION | ISSUE | DEPENDENCY
    private String type;
    private String title;
    private String description;
    private String owner;
    private String impact;       // HIGH | MEDIUM | LOW
    private String probability;  // HIGH | MEDIUM | LOW (for risks)
    private String status;       // OPEN | IN_PROGRESS | CLOSED | MITIGATED
    private String mitigation;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private LocalDateTime dueDate;

    // ── Meeting Continuity linkage (nullable — most RaidEntries won't
    // originate in or be touched by a meeting at all) ──────────────────
    private String sourceMeetingId; // the meeting that first raised this entry, if any
    private String lastMeetingId;   // the most recent meeting that discussed/updated this entry
}
