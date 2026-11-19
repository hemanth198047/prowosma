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
    /** PUBLIC: everyone who can see its project (or the workspace) sees it. PRIVATE: only its members, like a Teams private channel. DMs are always private. */
    private String visibility = "PUBLIC";
    /** Who can add/remove people, rename or delete a private channel. The creator always can. */
    private List<String> ownerEmails = new ArrayList<>();
    private boolean archived = false;
    private String createdBy;
    private LocalDateTime lastMessageAt;
    private LocalDateTime createdAt = LocalDateTime.now();

    public boolean isPrivate() { return "PRIVATE".equalsIgnoreCase(visibility) || "DM".equalsIgnoreCase(type); }
}
