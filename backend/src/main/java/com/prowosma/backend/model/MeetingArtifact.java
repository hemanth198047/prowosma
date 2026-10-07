package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** One immutable VERSION of a generated document (SUMMARY, MOM or NOTES). Versions are never overwritten, only added. */
@Data
@Document(collection = "meeting_artifacts")
public class MeetingArtifact {
    @Id private String id;
    private String organizationId;
    private String sessionId;
    private String type;                 // SUMMARY | MOM | NOTES
    private int version;                 // 1, 2, 3 … per (session, type)
    private String source;               // AI | USER_EDIT | RESTORE
    private String markdown;             // editable text with [#n] evidence markers
    private String generationId;         // which AI run produced it (null for edits)
    private int transcriptGeneration;    // which transcript it was produced from — differs from the session's when stale
    private Integer parentVersion;       // the version an edit/restore was based on
    private String createdBy;            // email, or "system"
    private String note;
    private Instant createdAt = Instant.now();
}
