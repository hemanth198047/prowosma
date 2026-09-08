package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Data
@Document(collection = "sops")
public class Sop {
    @Id private String id;
    private String workspaceId;
    private String title;
    private String description;
    private String content;
    private String category;
    private String status = "DRAFT";
    private String owner;
    private Integer version = 1;
    private String reviewFrequency;
    private LocalDateTime lastReviewedAt;
    private String lastReviewedBy;
    private LocalDateTime reviewDue;
    private LocalDateTime publishedAt;
    private String createdBy;
    private List<String> requiredAcknowledgers = new ArrayList<>();
    private List<Map<String, Object>> steps    = new ArrayList<>();
    private List<SopVersion>      versionHistory    = new ArrayList<>();
    private List<Acknowledgement> acknowledgements  = new ArrayList<>();
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Data
    public static class SopVersion {
        private Integer version;       // SopService calls snap.setVersion(sop.getVersion())
        private String content;
        private String changedBy;
        private String changeNote;
        private LocalDateTime createdAt = LocalDateTime.now();
    }

    @Data
    public static class Acknowledgement {
        private String userEmail;
        private String userName;
        private Integer sopVersion;    // SopService calls ack.setSopVersion(sop.getVersion())
        private LocalDateTime ackedAt; // SopService calls ack.setAckedAt(LocalDateTime.now())
        private LocalDateTime acknowledgedAt = LocalDateTime.now();
        private String comment;
    }
}
