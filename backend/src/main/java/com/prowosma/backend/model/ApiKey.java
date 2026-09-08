package com.prowosma.backend.model;
import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.List;

@Data
@Document(collection = "api_keys")
public class ApiKey {
    @Id private String id;
    private String organizationId;
    private String name;
    private String description;
    private String keyPrefix;      // first 12 chars, shown in list
    private String keyHash;        // hashed full key
    private String fullKey;        // TRANSIENT: only populated once on creation, never persisted
    private List<String> scopes;
    private boolean active = true;
    private String createdBy;
    private LocalDateTime expiresAt;
    private LocalDateTime lastUsed;
    private LocalDateTime createdAt = LocalDateTime.now();
    private LocalDateTime updatedAt = LocalDateTime.now();
}
