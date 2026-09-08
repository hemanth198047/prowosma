package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "initiatives")
public class Initiative {
    @Id private String id;
    private String organizationId;
    private String name;
    private String description;
    private String strategicRationale;
    private String status = "ACTIVE";  // ACTIVE | PAUSED | COMPLETED | CANCELLED
    private String owner;
    private List<String> projectIds = new ArrayList<>();
    private List<String> goalIds    = new ArrayList<>();
    private String priority = "MEDIUM"; // HIGH | MEDIUM | LOW
    private LocalDateTime startDate;
    private LocalDateTime targetDate;
    private int progress = 0;
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}
