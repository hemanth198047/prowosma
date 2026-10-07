package com.prowosma.backend.model;

import lombok.Data;
import lombok.ToString;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * One person's authorization of a meeting platform. Google's Meet REST API only supports user authentication,
 * so each person connects their own account and imports run with that person's access — never with an
 * administrator's blanket access. Tokens are stored only encrypted (FieldEncryptionService).
 */
@Data
@ToString(exclude = {"accessTokenEnc", "refreshTokenEnc"})
@Document(collection = "meeting_user_connections")
public class MeetingUserConnection {
    @Id private String id;
    private String organizationId;
    private String userEmail;             // lower-case
    private String provider;              // GOOGLE_MEET
    private String accessTokenEnc;
    private String refreshTokenEnc;
    private Instant accessTokenExpiresAt;
    private List<String> scopes = new ArrayList<>();
    private String account;               // the Google account's email
    private String status = "ACTIVE";    // ACTIVE | NEEDS_REAUTH
    private Instant createdAt = Instant.now();
    private Instant updatedAt = Instant.now();
}
