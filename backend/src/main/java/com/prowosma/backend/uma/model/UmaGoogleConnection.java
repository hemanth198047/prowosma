package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** One person's Google account connected to the AI Meeting Assistant (collection {@code uma_google_connections}). Tokens are encrypted. */
@Data
@Document(collection = "uma_google_connections")
public class UmaGoogleConnection {
    @Id private String id;
    private String organizationId;
    private String userEmail;                 // the Prowosma user (lower-case)
    private String account;                   // the Google account's email
    private String accessTokenEnc;
    private String refreshTokenEnc;
    private Instant accessTokenExpiresAt;
    private List<String> scopes = new ArrayList<>();
    private String status = "ACTIVE";         // ACTIVE | NEEDS_REAUTH
    // automation, chosen by the person
    private boolean autoImportCalendar;       // add my upcoming Google Meet meetings automatically
    private boolean autoFireflies;            // send the Fireflies notetaker to them when they start
    private Instant lastCalendarSyncAt;
    private String lastCalendarSyncNote;
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
