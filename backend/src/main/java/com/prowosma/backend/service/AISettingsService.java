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
    public AISettings get() {
        return aiSettingsRepository.findByOrganizationId(workspaceContext.getWorkspaceId()).stream()
                .findFirst()
                .orElse(new AISettings());
    }

    public AISettings save(AISettings settings) {
        AISettings existing = get();
        existing.setOrganizationId(workspaceContext.getWorkspaceId());
        if (existing.getId() != null) {
            existing.setAiEnabled(settings.isAiEnabled());
            existing.setApiKey(settings.getApiKey());
            existing.setApiProvider(settings.getApiProvider());   // ← was missing
            existing.setApiBaseUrl(settings.getApiBaseUrl());     // ← was missing
            existing.setModel(settings.getModel());
            existing.setMaxTokens(settings.getMaxTokens());
            existing.setFeatures(settings.getFeatures());
            return aiSettingsRepository.save(existing);
        }
        settings.setOrganizationId(workspaceContext.getWorkspaceId());
        AISettings saved = aiSettingsRepository.save(settings);
        activityLogService.log("AI_SETTINGS", saved.getId(), "AI Settings",
                "UPDATED", null, "enabled=" + saved.isAiEnabled(), null);
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