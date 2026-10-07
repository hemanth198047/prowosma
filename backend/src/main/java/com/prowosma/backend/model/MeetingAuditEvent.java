package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Audit trail written with an EXPLICIT organization, so background work (which has no request/workspace
 * context) is recorded too. Never holds transcript text, tokens or meeting passcodes.
 */
@Data
@Document(collection = "meeting_audit_events")
public class MeetingAuditEvent {
    @Id private String id;
    private String organizationId;
    private String sessionId;     // null for events not tied to one meeting
    private String actor;         // an email, or "system"
    private String action;
    private String detail;
    private Instant at = Instant.now();
}
