package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * BPM Instance — a running execution of a BpmProcess.
 * Tracks current node, history, AI outputs, and human decisions.
 */
@Data
@Document(collection = "bpm_instances")
public class BpmInstance {
    @Id private String id;
    private String organizationId;
    private String processId;
    private String processName;
    private String status = "RUNNING"; // RUNNING | WAITING_HUMAN | WAITING_AI | COMPLETED | FAILED | CANCELLED
    private String currentNodeId;
    private String startedBy;
    private Map<String, Object> variables = new LinkedHashMap<>(); // process variables
    private List<NodeExecution> history   = new ArrayList<>();
    private String linkedEntityType; // TASK | GOAL | PROJECT | APPROVAL
    private String linkedEntityId;
    private LocalDateTime startedAt  = LocalDateTime.now();
    private LocalDateTime updatedAt  = LocalDateTime.now();
    private LocalDateTime completedAt;

    @Data
    public static class NodeExecution {
        private String nodeId;
        private String nodeLabel;
        private String nodeType;
        private String status;         // COMPLETED | SKIPPED | WAITING | FAILED
        private String aiOutput;       // AI-generated content for AI_STEP nodes
        private String humanDecision;  // APPROVED | REJECTED | OVERRIDE
        private String humanComment;
        private String decidedBy;
        private Map<String, Object> output = new LinkedHashMap<>();
        private LocalDateTime startedAt   = LocalDateTime.now();
        private LocalDateTime completedAt;
    }
}
