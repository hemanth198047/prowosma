package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "decisions")
public class Decision {
    @Id private String id;
    private String organizationId;

    // ── Core fields (original) ────────────────────────────────
    private String workspaceId;          // alias for organizationId (old DecisionService)
    private String title;
    private String context;
    private String decision;
    private String rationale;
    private String outcome;
    private String owner;                // old field — person responsible
    private String status = "OPEN";      // OPEN | DECIDED | IMPLEMENTED | SUPERSEDED
    private String impact = "MEDIUM";    // HIGH | MEDIUM | LOW
    private String docId;                // linked doc (old feature)
    private List<String> tags              = new ArrayList<>();
    private List<String> linkedTaskIds     = new ArrayList<>();
    private List<String> linkedProjectIds  = new ArrayList<>();

    // ── Extended fields (new Decision Intelligence) ───────────
    private String alternatives;         // other options considered
    private String category;             // TECHNICAL | PRODUCT | RESOURCE | STRATEGIC
    private String madeBy;               // email of decision maker
    private List<String> stakeholders    = new ArrayList<>();
    private List<String> linkedEntityIds = new ArrayList<>();
    private String linkedEntityType;     // PROJECT | GOAL | TASK
    private String aiSuggestion;         // AI-generated analysis
    private String reversibility = "REVERSIBLE"; // REVERSIBLE | PARTIALLY | IRREVERSIBLE
    private LocalDateTime decidedAt;
    private LocalDateTime reviewAt;      // scheduled review date
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Meeting Continuity linkage (nullable — most Decisions won't
    // originate in a meeting at all) ────────────────────────────────
    private String sourceMeetingId; // the meeting where this decision was first captured, if any
}
