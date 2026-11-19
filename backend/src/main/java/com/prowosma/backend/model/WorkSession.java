package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * A stretch of time someone worked on a project: "Start working" to "Stop". One open session per person per workspace -
 * {@link #openKey} is set (org|email) only while it runs, and is unique.
 */
@Data
@Document(collection = "work_sessions")
@CompoundIndex(name = "org_project_start", def = "{'organizationId': 1, 'projectId': 1, 'startedAt': -1}")
@CompoundIndex(name = "org_email_start", def = "{'organizationId': 1, 'email': 1, 'startedAt': -1}")
public class WorkSession {
    @Id private String id;
    private String organizationId;
    private String projectId;
    private String projectName;
    private String email;
    private String name;
    private Instant startedAt;
    private Instant endedAt;
    private long minutes;                 // set when it ends
    private String note;
    private String endedBy;               // SELF | SWITCHED | CLOCKED_OUT | AUTO (ran too long) | ADMIN
    @Indexed(unique = true, sparse = true)
    private String openKey;

    public boolean isRunning() { return endedAt == null; }
}
