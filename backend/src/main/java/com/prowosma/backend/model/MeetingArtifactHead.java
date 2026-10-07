package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

/**
 * Which version is "current" for a (session, type), and which regenerated version is waiting for review.
 * A regeneration NEVER replaces the current version: it becomes {@code pendingVersion} until a person accepts it.
 */
@Data
@Document(collection = "meeting_artifact_heads")
public class MeetingArtifactHead {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String type;
    private int nextVersion;             // atomic counter
    private Integer currentVersion;
    private Integer pendingVersion;
}
