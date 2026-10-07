package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * One run of action extraction. The first run is applied straight away. A LATER run never touches what exists: it waits as
 * PENDING_REVIEW with a summary of what is new / still there / no longer found, until a person applies or discards it.
 */
@Data
@Document(collection = "meeting_extractions")
public class MeetingExtraction {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String requestId;
    private int transcriptGeneration;
    private String status = "APPLIED";             // APPLIED | PENDING_REVIEW | DISCARDED
    private int newCount;
    private int matchedCount;
    private int goneCount;
    private List<String> warnings = new ArrayList<>();
    private List<Map<String, Object>> items = new ArrayList<>();      // pending run only: validated actions
    private List<Map<String, Object>> proposals = new ArrayList<>();
    private List<Map<String, Object>> withdrawn = new ArrayList<>();
    private Instant createdAt = Instant.now();
    private Instant decidedAt;
}
