package com.prowosma.backend.uma.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** One person's AI Meeting Assistant preferences (collection {@code uma_user_prefs}). Defaults apply until they change something. */
@Data
@Document(collection = "uma_user_prefs")
@CompoundIndex(name = "org_user", def = "{'organizationId': 1, 'userEmail': 1}", unique = true)
public class UmaUserPrefs {
    @Id private String id;
    private String organizationId;
    private String userEmail;
    private String defaultPlatform = "GOOGLE_MEET";   // GOOGLE_MEET | MS_TEAMS
    private boolean autoTasks = true;                  // create clearly agreed tasks from my meetings automatically
    private Instant updatedAt = Instant.now();
}
