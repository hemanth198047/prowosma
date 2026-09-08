package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.List;

/**
 * A persisted record that a DLP scan found something — the audit trail
 * enterprise buyers actually mean by "DLP," as opposed to a scan endpoint
 * that returns results to the caller and then forgets them ever happened.
 *
 * Deliberately does NOT store the matched sensitive values themselves
 * (findingTypes is a list of pattern names like "EMAIL"/"SSN", never the
 * actual email or SSN that matched) — persisting the real values here would
 * create a second, less-protected copy of exactly the sensitive data DLP
 * exists to protect, which defeats the point.
 */
@Data
@Document(collection = "dlp_violations")
public class DlpViolation {
    @Id private String id;
    private String organizationId;
    private String entityType;
    private String entityId;
    private String riskLevel;          // LOW | MEDIUM | HIGH
    private int    findingsCount;
    private List<String> findingTypes; // e.g. ["EMAIL","SSN"] — types only
    private boolean redacted;
    private String scannedBy;
    private LocalDateTime scannedAt = LocalDateTime.now();
}
