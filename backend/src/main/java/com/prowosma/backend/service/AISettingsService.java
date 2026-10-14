package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class AISettingsService {

    private final AISettingsRepository aiSettingsRepository;
    private final ActivityLogService activityLogService;
    private final WorkspaceContext workspaceContext;
    private final FieldEncryptionService crypto;

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * What a browser may see: everything except the API key, plus whether one is saved. The settings page and the chat features only need
     * "is AI on, which provider, which features" — nobody should be able to read the provider key back out of the application.
     */
    public Map<String, Object> view(AISettings s) {
        Map<String, Object> m = MAPPER.convertValue(s, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        m.remove("apiKey");
        m.put("apiKeySaved", s.getApiKey() != null && !s.getApiKey().isBlank());
        return m;
    }

    /** The key in the clear, for the server's own calls to the AI provider only. Works for keys saved before encryption was added. */
    public String plainKey(AISettings s) {
        return s.getApiKey() == null ? null : crypto.decrypt(s.getApiKey());
    }
    public AISettings get() {
        return aiSettingsRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .findFirst()
                .orElse(new AISettings());
    }

    /**
     * Saves the settings. An EMPTY key means "keep the one already saved" (the page can't see it, so it can't send it back); a new key is stored
     * encrypted. Every save is written to the activity log — before, only the very first one was.
     */
    public AISettings save(AISettings in) {
        AISettings target = get();
        boolean isNew = target.getId() == null;
        target.setOrganizationId(workspaceContext.getWorkspaceId());
        target.setAiEnabled(in.isAiEnabled());
        target.setApiProvider(in.getApiProvider());
        target.setApiBaseUrl(in.getApiBaseUrl());
        target.setModel(in.getModel());
        target.setMaxTokens(in.getMaxTokens());
        if (in.getFeatures() != null) target.setFeatures(in.getFeatures());
        String newKey = in.getApiKey();
        if (newKey != null && !newKey.isBlank()) {
            String k = newKey.trim();
            target.setApiKey(crypto.isActive() ? crypto.encrypt(k) : k);
        }
        AISettings saved = aiSettingsRepository.save(target);
        activityLogService.log("AI_SETTINGS", saved.getId(), "AI Settings",
                isNew ? "CREATED" : "UPDATED", null, "enabled=" + saved.isAiEnabled(), null);
        return saved;
    }

    public AISettings toggleFeature(String featureKey) {
        AISettings settings = get();
        settings.setOrganizationId(workspaceContext.getWorkspaceId());
        if (settings.getFeatures() == null)
            settings.setFeatures(new java.util.HashMap<>());
        boolean current = settings.getFeatures().getOrDefault(featureKey, false);
        settings.getFeatures().put(featureKey, !current);
        AISettings saved = aiSettingsRepository.save(settings);
        activityLogService.log("AI_SETTINGS", saved.getId(), "AI Settings",
                "UPDATED", null, "enabled=" + saved.isAiEnabled(), null);
        return saved;
    }

    public AISettings toggleAI(boolean enabled) {
        AISettings settings = get();
        settings.setOrganizationId(workspaceContext.getWorkspaceId());
        settings.setAiEnabled(enabled);
        AISettings saved = aiSettingsRepository.save(settings);
        activityLogService.log("AI_SETTINGS", saved.getId(), "AI Settings",
                "UPDATED", null, "enabled=" + saved.isAiEnabled(), null);
        return saved;
    }
}