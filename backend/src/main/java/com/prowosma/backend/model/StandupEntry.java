package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Data
@Document(collection = "standup_entries")
public class StandupEntry {
    @Id private String id;
    private String organizationId;
    private String authorEmail;
    private String authorName;
    private String teamId;
    private String yesterday;  // What I did yesterday
    private String today;      // What I'll do today
    private String blockers;   // Any blockers?
    private String mood;       // GREAT | GOOD | NEUTRAL | BAD
    private LocalDateTime date = LocalDateTime.now();
    private LocalDateTime createdAt = LocalDateTime.now();
}
