package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "epics")
public class Epic {
    @Id private String id;
    private String organizationId;
    private String projectId;
    private String name;
    private String description;
    private String color = "#6366f1";
    private String status = "OPEN"; // OPEN | IN_PROGRESS | DONE | CANCELLED
    private String priority = "MEDIUM";
    private List<String> taskIds    = new ArrayList<>();
    private List<String> storyIds   = new ArrayList<>();
    private int totalPoints    = 0;
    private int completedPoints = 0;
    private LocalDateTime startDate;
    private LocalDateTime targetDate;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}
