package com.prowosma.backend.model;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
public class Attachment {
    private String id = UUID.randomUUID().toString();
    private String fileName;
    private String originalName;
    private String fileType;
    private long fileSize;
    private String uploadedBy;
    private LocalDateTime uploadedAt = LocalDateTime.now();
}