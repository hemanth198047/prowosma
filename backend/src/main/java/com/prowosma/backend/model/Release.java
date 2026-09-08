package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "releases")
public class Release {
    @Id private String id;
    private String organizationId;
    private String projectId;
    private String version;           // e.g. "v2.1.0"
    private String name;              // e.g. "Summer Release"
    private String description;
    private String status = "PLANNED"; // PLANNED | IN_PROGRESS | RELEASED | CANCELLED
    private LocalDateTime releaseDate;
    private List<String> taskIds = new ArrayList<>();
    private String releaseNotes;
    private String owner;
    private String environment;       // PRODUCTION | STAGING | BETA
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    // ── Auto-changelog ────────────────────────────────────────
    private String autoChangelog;          // AI/auto-generated changelog text
    private java.util.List<String> commitMessages = new java.util.ArrayList<>(); // from CI integration
    private String changelogGeneratedAt;
}
