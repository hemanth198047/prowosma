package com.prowosma.backend.model;

import lombok.Data;
import lombok.ToString;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** Short-lived, single-use record binding an OAuth sign-in to the person and workspace that started it (CSRF + PKCE). */
@Data
@ToString(exclude = {"codeVerifierEnc"})
@Document(collection = "meeting_oauth_states")
public class MeetingOAuthState {
    @Id private String id;
    private String organizationId;
    private String userEmail;
    private String provider;
    private String stateHash;             // SHA-256 of the random state value; the raw value is never stored
    private String codeVerifierEnc;       // PKCE verifier, encrypted
    private Instant expiresAt;
}
