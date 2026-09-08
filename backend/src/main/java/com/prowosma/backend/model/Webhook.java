package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Document(collection = "webhooks")
public class Webhook {
    @Id private String id;
    private String organizationId;

    /* ── Core fields (used by WebhookController) ── */
    private String url;
    private String description;
    private String secret;
    private boolean active = true;
    private List<String> events;
    private String createdBy;
    private Integer failureCount = 0;
    private LocalDateTime lastDeliveredAt;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    /* ── Extended fields required by WebhookService ── */
    private String name;            // webhook display name
    private Integer totalFired  = 0;
    private Integer totalFailed = 0;
    private LocalDateTime lastFiredAt;
    private String lastStatus;      // "SUCCESS" | "FAILED"
}
