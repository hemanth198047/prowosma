package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "docs")
public class Doc {
    @Id
    private String id;

    private String workspaceId;
    private String parentId;          // null = root page
    private String createdBy;         // user email

    private String title   = "";
    private String emoji   = "📄";
    private String content = "[]";    // JSON array of block objects
    private boolean favorite = false;
    private boolean deleted  = false;

    // A-8: Document publishing
    // visibility: PRIVATE | TEAM | PUBLIC
    private String visibility = "PRIVATE";
    private String publishedSlug;     // URL slug when published publicly

    // A-12: Tagging & categorisation
    private List<String> tags     = new ArrayList<>();
    private String category       = "";   // e.g. "Engineering", "Product", "HR"

    // IDs of docs that link TO this doc (maintained by DocService on save)
    private List<String> backlinkedFrom = new ArrayList<>();

    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
    private LocalDateTime viewedAt  = LocalDateTime.now();

    // ── Inline comments ─────────────────────────────────────────
    private java.util.List<InlineComment> inlineComments = new java.util.ArrayList<>();

    // ── Knowledge freshness ─────────────────────────────────────
    private LocalDateTime reviewAt;         // scheduled review date
    private boolean       stale = false;    // flagged as outdated
    private int           freshnessScore = 100; // 0-100 decreases with age
    private LocalDateTime lastReviewedAt;

    // ── Auto-linking ─────────────────────────────────────────────
    private java.util.List<String> autoLinkedDocIds  = new java.util.ArrayList<>(); // AI-detected related docs
    private java.util.List<String> autoLinkedTaskIds = new java.util.ArrayList<>();

    @lombok.Data
    public static class InlineComment {
        private String id          = java.util.UUID.randomUUID().toString();
        private String blockId;            // id of block being commented on
        private String selectedText;       // quoted snippet
        private String comment;
        private String authorEmail;
        private String authorName;
        private boolean resolved  = false;
        private java.util.List<InlineComment> replies = new java.util.ArrayList<>();
        private LocalDateTime createdAt = LocalDateTime.now();
    }
}
