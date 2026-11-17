package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** Who did what to a meeting. Content-free: never transcript text. Collection {@code uma_audit}. */
@Data
@Document(collection = "uma_audit")
public class UmaAuditEvent {
    @Id private String id;
    private String organizationId;
    private String meetingId;
    private String actor;
    private String action;               // e.g. MEETING_CREATED, RECORDING_UPLOADED, ACTION_APPROVED, EXPORTED, DELETED
    private String detail;               // short, content-free
    private Instant at = Instant.now();
}
