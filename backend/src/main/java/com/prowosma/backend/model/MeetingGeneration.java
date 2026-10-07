package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** One AI run for a meeting: what was asked of which model, what it cost in tokens, and the validated analysis. */
@Data
@Document(collection = "meeting_generations")
public class MeetingGeneration {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String kind = "OUTPUTS";    // OUTPUTS | ACTIONS
    private String requestId;            // idempotency token for the job request
    private int transcriptGeneration;
    private String status;               // SUCCEEDED | FAILED
    private String errorCode;
    private String provider;
    private String model;
    private long inputTokens;
    private long outputTokens;
    private int calls;
    private int chunks;
    private long durationMs;
    private int dropped;                 // statements removed for lacking valid evidence
    private List<String> warnings = new ArrayList<>();
    private Map<String, Object> analysis; // the validated structure the three documents were rendered from
    private String requestedBy;
    private Instant createdAt = Instant.now();
}
