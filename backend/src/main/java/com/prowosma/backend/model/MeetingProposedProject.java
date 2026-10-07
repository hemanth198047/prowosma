package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** A NEW project the discussion supports. It does nothing until a person approves it; the app's mandatory fields are enforced first. */
@Data
@Document(collection = "meeting_proposed_projects")
public class MeetingProposedProject {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String stableId;
    private String name;
    private String description;
    private String rationale;
    private List<Integer> evidence = new ArrayList<>();
    private String status = "PROPOSED";            // PROPOSED | APPROVED | REJECTED
    private List<String> missingFields = new ArrayList<>();
    private boolean edited;
    private String extractionId;
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
