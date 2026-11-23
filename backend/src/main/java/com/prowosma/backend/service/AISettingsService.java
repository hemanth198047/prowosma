package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

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
        List<Map<String, Object>> backups = new ArrayList<>();
        if (s.getBackups() != null) for (AISettings.Backup b : s.getBackups()) {
            Map<String, Object> bm = MAPPER.convertValue(b, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            bm.remove("apiKey");
            bm.put("apiKeySaved", b.getApiKey() != null && !b.getApiKey().isBlank());
            backups.add(bm);
        }
        m.put("backups", backups);
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
        if (in.getBackups() != null) target.setBackups(mergeBackups(target.getBackups(), in.getBackups()));      // null = an older page that doesn't know about backups: leave them alone
        AISettings saved = aiSettingsRepository.save(target);
        activityLogService.log("AI_SETTINGS", saved.getId(), "AI Settings",
                isNew ? "CREATED" : "UPDATED", null, "enabled=" + saved.isAiEnabled(), null);
        return saved;
    }

    private static final Set<String> PROVIDERS = Set.of("ANTHROPIC", "OPENAI", "GEMINI", "CUSTOM");

    /**
     * The backup list the admin sent becomes the saved list. A backup with a blank key keeps the key already saved for the SAME backup
     * (matched by id) as long as it still points at the same provider and address — a saved key is never sent somewhere it wasn't saved for.
     */
    List<AISettings.Backup> mergeBackups(List<AISettings.Backup> saved, List<AISettings.Backup> incoming) {
        if (incoming.size() > AISettings.MAX_BACKUPS)
            throw new IllegalArgumentException("You can add up to " + AISettings.MAX_BACKUPS + " backup AI providers.");
        List<AISettings.Backup> out = new ArrayList<>();
        for (AISettings.Backup in : incoming) {
            if (in == null) continue;
            String provider = in.getApiProvider() == null || in.getApiProvider().isBlank() ? "CUSTOM" : in.getApiProvider().trim().toUpperCase(Locale.ROOT);
            if (!PROVIDERS.contains(provider)) throw new IllegalArgumentException("Unknown provider for a backup AI.");
            String url = in.getApiBaseUrl() == null ? null : in.getApiBaseUrl().trim();
            if ("CUSTOM".equals(provider)) {
                try {
                    com.prowosma.backend.integration.OutboundUrlPolicy.parseHttps(url, "AI endpoint");
                } catch (RuntimeException e) {
                    throw new IllegalArgumentException("A backup AI needs a valid https address.");
                }
            } else url = null;
            AISettings.Backup b = new AISettings.Backup();
            b.setId(in.getId() == null || in.getId().isBlank() ? UUID.randomUUID().toString() : in.getId());
            b.setLabel(in.getLabel() == null ? null : in.getLabel().trim());
            b.setApiProvider(provider);
            b.setApiBaseUrl(url);
            b.setModel(in.getModel() == null || in.getModel().isBlank() ? null : in.getModel().trim());
            String k = in.getApiKey() == null ? "" : in.getApiKey().trim();
            if (!k.isEmpty()) b.setApiKey(crypto.isActive() ? crypto.encrypt(k) : k);
            else if (saved != null) {
                for (AISettings.Backup old : saved) {
                    boolean same = old.getId() != null && old.getId().equals(in.getId()) && provider.equals(old.getApiProvider())
                            && java.util.Objects.equals(url == null ? "" : url.replaceAll("/+$", ""), old.getApiBaseUrl() == null ? "" : old.getApiBaseUrl().trim().replaceAll("/+$", ""));
                    if (same) b.setApiKey(old.getApiKey());
                }
            }
            out.add(b);
        }
        return out;
    }

    public AISettings toggleFeature(String featureKey) {
        AISettings settings = get();
        settings.setOrganizationId(workspaceContext.getWorkspaceId());
        if (settings.getFeatures() == null)
            settings.setFeatures(new java.util.HashMap<>());
        boolean current = settings.getFeatures().getOrDefault(featureKey, true);      // same rule as AIService.isEnabled: a feature nobody switched off is on
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