package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Per-organization connection to one meeting platform. NOTE: credentials are
 * intentionally not modelled here yet. When OAuth is added it must store tokens
 * only through FieldEncryptionService and refuse to save if encryption is inactive.
 */
@Data
@Document(collection = "meeting_integrations")
public class MeetingIntegration {
    @Id private String id;
    private String organizationId;
    private String provider;                       // GOOGLE_MEET | MS_TEAMS
    private boolean enabled = false;
    private String connectionStatus = "NOT_CONNECTED"; // NOT_CONNECTED | CONNECTED | NEEDS_ATTENTION
    private String statusMessage;
    private String connectedAccount;
    private List<String> grantedScopes = new ArrayList<>();
    private Instant lastCheckedAt;
    private String updatedBy;
    private Instant updatedAt;
}
