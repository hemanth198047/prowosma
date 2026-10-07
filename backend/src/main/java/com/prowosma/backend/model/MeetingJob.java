package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** A durable unit of background work. Claimed atomically with a lease, so a crashed worker's job is picked up again. */
@Data
@Document(collection = "meeting_jobs")
public class MeetingJob {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String type;                 // e.g. FETCH_GOOGLE_TRANSCRIPT
    private String jobKey;               // unique: type + ":" + sessionId — at most one live job per session and type
    private String status = "QUEUED";   // QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED
    private String requestedBy;          // whose connection/permissions the job runs with
    private Instant runAfter;
    private Instant deadline;            // give up (with a clear message) after this
    private Instant leaseUntil;
    private String lockedBy;
    private int attempts;                // every run, including after a crash
    private int maxAttempts = 400;
    private int errorStreak;             // consecutive error retries (polling does not count)
    private String lastCode;
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
