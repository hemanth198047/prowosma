package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Data
@Document(collection = "ai_settings")
public class AISettings {
    @Id
    private String id;
    private String organizationId;
    private boolean aiEnabled = false;
    private String apiKey;
    private String apiProvider = "ANTHROPIC"; // ANTHROPIC, OPENAI, GEMINI, CUSTOM
    private String apiBaseUrl; // for custom providers
    private String model = "claude-sonnet-4-20250514";
    private int maxTokens = 2048;
    private Map<String, Boolean> features = new HashMap<>();
    /** Other providers to use, in this order, when the main one is rate-limited, out of quota, overloaded or rejects its key. */
    private List<Backup> backups = new ArrayList<>();

    public static final int MAX_BACKUPS = 3;

    /** One backup provider. {@code apiKey} is stored encrypted and never leaves the server. */
    @Data
    public static class Backup {
        private String id;
        private String label;          // what the admin picked, e.g. "Groq"; display only
        private String apiProvider = "CUSTOM";
        private String apiKey;
        private String apiBaseUrl;
        private String model;
    }

    public boolean isFeatureEnabled(String featureKey) {
        if (!aiEnabled) return false;
        // Default to TRUE for unlisted features (opt-out model)
        // Users can explicitly disable features; unknown = enabled
        return features.getOrDefault(featureKey, true);
    }
}