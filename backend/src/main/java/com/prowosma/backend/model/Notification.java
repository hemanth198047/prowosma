package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "notifications")
public class Notification {
    @Id
    private String id;
    private String organizationId;
    private String title;
    private String message;
    private String type;       // INFO, WARNING, SUCCESS, ERROR
    private String entityType; // TASK, PROJECT, GOAL, SPRINT, AUTOMATION, APPROVAL
    private String entityId;
    private boolean read   = false;
    private boolean pinned = false;

    // Smart Inbox grouping
    // ASSIGNMENT | MENTION | APPROVAL | GOAL | RISK | SYSTEM
    private String category = "SYSTEM";
    private String priority = "NORMAL"; // HIGH | NORMAL | LOW

    // Snooze: hide until this time
    private LocalDateTime snoozedUntil;

    private LocalDateTime createdAt = LocalDateTime.now();
}
