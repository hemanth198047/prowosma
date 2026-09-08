package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * BPM Process Definition — a reusable workflow template with nodes and transitions.
 * Each node can be: TRIGGER | CONDITION | AI_STEP | HUMAN_APPROVAL | ACTION | END
 */
@Data
@Document(collection = "bpm_processes")
public class BpmProcess {
    @Id private String id;
    private String organizationId;
    private String name;
    private String description;
    private String category;          // HR | FINANCE | IT | LEGAL | PRODUCT | CUSTOM
    private String status = "DRAFT";  // DRAFT | ACTIVE | ARCHIVED
    private List<BpmNode> nodes = new ArrayList<>();
    private List<BpmTransition> transitions = new ArrayList<>();
    private String createdBy;
    private int runCount = 0;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Data
    public static class BpmNode {
        private String id;
        private String type;     // TRIGGER | CONDITION | AI_STEP | HUMAN_APPROVAL | ACTION | FORK | JOIN | END
        private String label;
        private String description;
        private Map<String, Object> config;  // type-specific config
        private int x = 0;
        private int y = 0;
    }

    @Data
    public static class BpmTransition {
        private String id;
        private String fromNodeId;
        private String toNodeId;
        private String label;        // e.g. "Approved" / "Rejected" / "score > 80"
        private String condition;    // expression for conditional routing
    }
}
