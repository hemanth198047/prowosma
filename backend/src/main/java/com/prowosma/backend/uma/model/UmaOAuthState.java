package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** A pending Google sign-in (collection {@code uma_oauth_states}): single use, 10 minutes. Only a hash of the state value is stored. */
@Data
@Document(collection = "uma_oauth_states")
public class UmaOAuthState {
    @Id private String id;
    private String organizationId;
    private String userEmail;
    private String stateHash;
    private String codeVerifierEnc;
    private Instant expiresAt;
}
