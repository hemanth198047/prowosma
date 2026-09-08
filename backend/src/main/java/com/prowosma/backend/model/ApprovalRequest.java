package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "approval_requests")
public class ApprovalRequest {
    @Id
    private String id;
    private String organizationId;
    private String title;
    private String description;
    private String requestedBy;     // email
    private String entityType;      // TASK | PROJECT | GOAL | AUTOMATION
    private String entityId;
    private String automationId;    // if triggered by automation

    // PENDING | APPROVED | REJECTED | CANCELLED | ESCALATED
    private String status = "PENDING";

    // Approval chain
    private List<ApprovalStep> steps = new ArrayList<>();
    private int currentStep = 0;

    // Chain type: SEQUENTIAL (one at a time) | PARALLEL (all at once)
    private String chainType = "SEQUENTIAL";

    // SLA / escalation
    private int slaHours = 24;           // auto-escalate after N hours
    private String escalateTo;           // fallback approver email
    private LocalDateTime escalateAt;    // computed: createdAt + slaHours

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private LocalDateTime resolvedAt;
    private String resolvedBy;
    private String rejectionReason;

    @Data
    public static class ApprovalStep {
        private String id;
        private int order;
        private String approverEmail;
        private String approverName;
        // PENDING | APPROVED | REJECTED | SKIPPED
        private String status = "PENDING";
        private String comment;
        private LocalDateTime respondedAt;
    }
}
