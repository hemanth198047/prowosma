package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "doc_versions")
public class DocVersion {
    @Id private String id;
    private String docId;
    private Integer versionNumber;
    private String title;
    private String content;         // full doc content snapshot (used by controller)

    /* ── Fields used by DocVersionController ── */
    private String label;           // human label e.g. "v3", "Before restore"
    private String savedBy;

    /* ── Extended fields required by DocService ── */
    private String workspaceId;     // workspace scope
    private String emoji;           // doc emoji (mirrors Doc.emoji at save time)
    private String changeLabel;     // semantic label e.g. "Minor edit", "Major rewrite"
    private Integer wordCount;      // word count snapshot for diff display

    private LocalDateTime createdAt = LocalDateTime.now();
}
