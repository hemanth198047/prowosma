package com.prowosma.backend.service;

import com.prowosma.backend.model.AISettings;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The one-word answer to "is AI on in this workspace?" for the whole application (the badge in the top bar). It reports ONLY
 * non-sensitive facts — never the API key, its length, or the custom endpoint address — so any signed-in person can be shown it.
 *
 *   OFF          AI is switched off in AI Settings.
 *   NEEDS_SETUP  AI is switched on, but something it needs is missing (an API key, or a custom endpoint address).
 *   ON           AI is switched on and has what it needs.
 *
 * Individual features can still be switched off one by one in AI Settings; that is deliberately not part of this overall state.
 */
public final class AIStatus {

    private AIStatus() {}

    public static Map<String, Object> of(AISettings s) {
        boolean enabled = s != null && s.isAiEnabled();
        String provider = s == null || s.getApiProvider() == null || s.getApiProvider().isBlank() ? "ANTHROPIC" : s.getApiProvider().trim().toUpperCase(Locale.ROOT);
        String model = s == null || s.getModel() == null ? "" : s.getModel().trim();

        String problem = null;
        if (enabled) {
            if (s.getApiKey() == null || s.getApiKey().isBlank()) problem = "No API key is saved.";
            else if ("CUSTOM".equals(provider) && (s.getApiBaseUrl() == null || s.getApiBaseUrl().isBlank())) problem = "The custom AI endpoint address is missing.";
        }

        String state = !enabled ? "OFF" : problem != null ? "NEEDS_SETUP" : "ON";
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("state", state);
        out.put("enabled", enabled);
        out.put("configured", enabled && problem == null);
        out.put("provider", provider);
        out.put("model", model);
        out.put("message", switch (state) {
            case "ON" -> "AI is on for this workspace.";
            case "NEEDS_SETUP" -> "AI is turned on but isn't ready: " + problem + " An admin can fix this in AI Settings.";
            default -> "AI is off for this workspace. An admin can turn it on in AI Settings.";
        });
        return out;
    }
}
