package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Data
@Document(collection = "user_groups")
public class UserGroup {
    @Id private String id;
    private String organizationId;
    private String name;              // e.g. "Engineering", "Design Leads"
    private String description;
    private String color = "#6366f1";
    /** DEPARTMENT groups take part in access decisions (who sees which project); TEAM groups are just a label. */
    private String type = "TEAM";
    private List<String> memberEmails = new ArrayList<>();
    private List<String> permissions  = new ArrayList<>(); // ["VIEW_ALL","CREATE_PROJECT","MANAGE_TEAM"]
    private String createdBy;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}
