package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "channels")
public class Channel {
    @Id private String id;
    private String organizationId;
    private String name;              // e.g. "#general"
    private String description;
    private String type = "PROJECT";  // PROJECT | TEAM | DM | ANNOUNCEMENT
    private String projectId;         // for project channels
    private List<String> memberEmails = new ArrayList<>();
    private boolean archived = false;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
}
