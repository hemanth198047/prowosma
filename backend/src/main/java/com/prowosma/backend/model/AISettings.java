package com.prowosma.backend.model;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.util.HashMap;
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

    public boolean isFeatureEnabled(String featureKey) {
        if (!aiEnabled) return false;
        // Default to TRUE for unlisted features (opt-out model)
        // Users can explicitly disable features; unknown = enabled
        return features.getOrDefault(featureKey, true);
    }
}