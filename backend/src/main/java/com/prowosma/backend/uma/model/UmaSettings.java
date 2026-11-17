package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** Workspace connections for the AI Meeting Assistant (collection {@code uma_settings}, id = workspace id). Secrets are stored encrypted. */
@Data
@Document(collection = "uma_settings")
public class UmaSettings {
    @Id private String id;
    private String firefliesKeyEnc;            // never sent to the browser
    private String firefliesAccountName;       // shown so admins see which account is connected
    private String firefliesAccountEmail;
    private String firefliesSavedBy;
    private Instant firefliesSavedAt;
}
