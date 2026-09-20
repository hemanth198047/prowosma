package com.prowosma.backend.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.Map;

@Data
@Document(collection = "integrations")
public class Integration {
    @Id
    private String id;
    private String organizationId;
    private String type;
    private String key; // same as type, for frontend lookup // GITHUB, SLACK, GOOGLE_CALENDAR
    private String name;
    private boolean enabled = false;
    private Map<String, String> config;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime lastSyncAt;

    /**
     * SHA-256 of the secret in this integration's inbound event URL (Datadog / Sentry / Jenkins).
     * Only the hash is stored. It is server-managed: hidden from API responses, and a client
     * cannot set it by sending it in a request body.
     */
    @JsonIgnore
    private String inboundTokenHash;
}