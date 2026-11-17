package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** A unit of background work, claimed with a lease (collection {@code uma_jobs}; separate from the old assistant's queue). */
@Data
@Document(collection = "uma_jobs")
public class UmaJob {
    @Id private String id;
    private String organizationId;
    private String meetingId;
    private String type;                 // TRANSCRIBE | ANALYZE
    private String jobKey;               // type + ":" + meetingId — at most one live job per meeting and type
    private String status = "QUEUED";   // QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED | DEAD
    private String requestedBy;
    private Instant runAfter = Instant.now();
    private Instant leaseUntil;
    private String lockedBy;
    private int attempts;
    private int maxAttempts = 5;
    private String lastCode;             // error code of the last failure (no content)
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
