package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** One person's Microsoft 365 account connected to the AI Meeting Assistant (collection {@code uma_microsoft_connections}). Tokens are encrypted. */
@Data
@Document(collection = "uma_microsoft_connections")
public class UmaMicrosoftConnection {
    @Id private String id;
    private String organizationId;
    private String userEmail;                 // the Prowosma user (lower-case)
    private String account;                   // the Microsoft account (UPN / email)
    private String tenantId;
    private String accessTokenEnc;
    private String refreshTokenEnc;
    private Instant accessTokenExpiresAt;
    private List<String> scopes = new ArrayList<>();
    private String status = "ACTIVE";         // ACTIVE | NEEDS_REAUTH
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
