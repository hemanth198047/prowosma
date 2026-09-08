package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "programmes")
public class Programme {
    @Id private String id;
    private String organizationId;
    private String name;
    private String description;
    private String status = "ACTIVE";  // ACTIVE | PAUSED | COMPLETED | CANCELLED
    private String owner;
    private List<String> projectIds = new ArrayList<>();
    private List<ProgrammeMilestone> milestones = new ArrayList<>();
    private String budget;
    private LocalDateTime startDate;
    private LocalDateTime endDate;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Data
    public static class ProgrammeMilestone {
        private String id = java.util.UUID.randomUUID().toString();
        private String title;
        private LocalDateTime dueDate;
        private boolean completed = false;
        private String ownedBy;
    }
}
