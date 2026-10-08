package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** One creation run (by a person pressing Create, or automatically). Kept as history: who, when, and exactly what happened to each item. */
@Data
@Document(collection = "meeting_creation_batches")
public class MeetingCreationBatch {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String mode;                 // REVIEW | AUTO
    private String actor;                // an email, or the Meeting Assistant system actor
    private int created;
    private int failed;
    private int skipped;
    private List<Map<String, Object>> items = new ArrayList<>();
    private Instant createdAt = Instant.now();
}
