package com.prowosma.backend.ai;

import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.service.AIStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("AI status for the top-bar badge")
class AIStatusTest {

    private static AISettings settings(boolean enabled, String key, String provider, String baseUrl, String model) {
        AISettings s = new AISettings();
        s.setAiEnabled(enabled);
        s.setApiKey(key);
        if (provider != null) s.setApiProvider(provider);
        s.setApiBaseUrl(baseUrl);
        if (model != null) s.setModel(model);
        return s;
    }

    @Test @DisplayName("no settings at all, or switched off, is OFF — even if a key is saved")
    void off() {
        assertThat(AIStatus.of(null).get("state")).isEqualTo("OFF");
        assertThat(AIStatus.of(new AISettings()).get("state")).isEqualTo("OFF");
        Map<String, Object> off = AIStatus.of(settings(false, "sk-secret", null, null, null));
        assertThat(off.get("state")).isEqualTo("OFF");
        assertThat(off.get("enabled")).isEqualTo(false);
        assertThat(off.get("configured")).isEqualTo(false);
        assertThat((String) off.get("message")).contains("off");
    }

    @Test @DisplayName("switched on without an API key needs setup")
    void needsKey() {
        for (String key : new String[]{null, "", "   "}) {
            Map<String, Object> s = AIStatus.of(settings(true, key, null, null, null));
            assertThat(s.get("state")).as("key=" + key).isEqualTo("NEEDS_SETUP");
            assertThat(s.get("configured")).isEqualTo(false);
            assertThat((String) s.get("message")).contains("No API key");
        }
    }

    @Test @DisplayName("a custom endpoint also needs its address")
    void customNeedsAddress() {
        assertThat(AIStatus.of(settings(true, "k", "CUSTOM", null, "m")).get("state")).isEqualTo("NEEDS_SETUP");
        assertThat((String) AIStatus.of(settings(true, "k", "custom", " ", "m")).get("message")).contains("custom AI endpoint address");
        assertThat(AIStatus.of(settings(true, "k", "CUSTOM", "https://llm.example.com/v1", "m")).get("state")).isEqualTo("ON");
    }

    @Test @DisplayName("switched on with what it needs is ON, and reports the provider and model")
    void on() {
        Map<String, Object> s = AIStatus.of(settings(true, "k", "OPENAI", null, "gpt-4o-mini"));
        assertThat(s.get("state")).isEqualTo("ON");
        assertThat(s.get("configured")).isEqualTo(true);
        assertThat(s.get("provider")).isEqualTo("OPENAI");
        assertThat(s.get("model")).isEqualTo("gpt-4o-mini");
        assertThat(AIStatus.of(settings(true, "k", null, null, null)).get("provider")).isEqualTo("ANTHROPIC");   // the default provider
    }

    @Test @DisplayName("the result never contains the key, any part of it, or the custom endpoint address")
    void neverLeaksSecrets() {
        Map<String, Object> s = AIStatus.of(settings(true, "sk-ant-SUPERSECRET-123", "CUSTOM", "https://internal.corp.example/llm", "m"));
        String all = s.toString();
        assertThat(all).doesNotContain("SUPERSECRET").doesNotContain("sk-ant").doesNotContain("internal.corp.example");
        assertThat(s.keySet()).containsExactlyInAnyOrder("state", "enabled", "configured", "provider", "model", "message");
    }
}
