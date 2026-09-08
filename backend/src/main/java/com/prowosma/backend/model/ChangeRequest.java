package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "change_requests")
public class ChangeRequest {
    @Id private String id;
    private String organizationId;
    private String projectId;
    private String title;
    private String description;
    private String impact;            // HIGH | MEDIUM | LOW
    private String impactDescription;
    private String category;          // SCOPE | BUDGET | TIMELINE | RESOURCE | PROCESS
    private String status = "DRAFT";  // DRAFT | SUBMITTED | APPROVED | REJECTED | IMPLEMENTED
    private String requestedBy;
    private List<String> approvers = new ArrayList<>();
    private String currentApprover;
    private String rejectionReason;
    private String linkedTaskId;
    private LocalDateTime submittedAt;
    private LocalDateTime resolvedAt;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}
