package com.prowosma.backend.ai;

import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.LlmHttp;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.service.AISettingsService;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.service.LlmModelCatalog;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("LlmModelCatalog")
class LlmModelCatalogTest {

    private final List<String[]> calls = new ArrayList<>();   // {url, key-header}
    private int status = 200;
    private String body = "{}";

    private LlmModelCatalog catalog(AISettings saved) {
        AISettingsService svc = mock(AISettingsService.class);
        when(svc.get()).thenReturn(saved);
        FieldEncryptionService crypto = mock(FieldEncryptionService.class);
        when(crypto.decrypt("enc")).thenReturn("SAVED-KEY");
        LlmHttp http = (method, url, headers, b, allowPrivate) -> {
            calls.add(new String[]{url, String.valueOf(headers.getOrDefault("x-goog-api-key", headers.getOrDefault("Authorization", headers.get("x-api-key"))))});
            return new LlmHttp.Result(status, body);
        };
        return new LlmModelCatalog(svc, crypto, http);
    }

    @Test @DisplayName("Gemini: keeps chat models that can generate content, drops tts/image/gemma, stable before preview")
    void gemini() {
        body = """
            {"models":[
              {"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent"]},
              {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent","countTokens"]},
              {"name":"models/gemini-3-flash-preview","supportedGenerationMethods":["generateContent"]},
              {"name":"models/gemini-2.5-flash-preview-tts","supportedGenerationMethods":["generateContent"]},
              {"name":"models/gemini-2.5-flash-image","supportedGenerationMethods":["generateContent"]},
              {"name":"models/gemma-4-31b-it","supportedGenerationMethods":["generateContent"]},
              {"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}
            ]}""";
        var r = catalog(new AISettings()).list("gemini", "TYPED", null);
        assertThat(r.models()).containsExactly("gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview");
        assertThat(calls.get(0)[1]).isEqualTo("TYPED");
    }

    @Test @DisplayName("a typed key wins; a blank key uses the saved key ONLY for the provider it was saved for")
    void savedKeyOnlyForSameProvider() {
        AISettings saved = new AISettings();
        saved.setApiProvider("OPENAI"); saved.setApiKey("enc");
        body = "{\"data\":[{\"id\":\"gpt-4o\"},{\"id\":\"text-embedding-3-small\"},{\"id\":\"whisper-1\"},{\"id\":\"o3-mini\"}]}";
        var r = catalog(saved).list("OPENAI", "", null);
        assertThat(r.models()).containsExactly("gpt-4o", "o3-mini");
        assertThat(calls.get(0)[1]).isEqualTo("Bearer SAVED-KEY");

        calls.clear();
        assertThatThrownBy(() -> catalog(saved).list("GEMINI", "", null))      // would leak the OpenAI key to Google
                .isInstanceOf(LlmException.class).hasMessageContaining("API key");
        assertThat(calls).isEmpty();
    }

    @Test @DisplayName("Gemini's 400 'API key not valid' is reported as a rejected key")
    void geminiBadKey() {
        status = 400; body = "{\"error\":{\"message\":\"API key not valid. Please pass a valid API key.\"}}";
        assertThatThrownBy(() -> catalog(new AISettings()).list("GEMINI", "bad", null))
                .isInstanceOf(LlmException.class).hasMessageContaining("rejected");
    }

    @Test @DisplayName("Anthropic: lists claude models; Custom: asks /models next to the chat endpoint")
    void anthropicAndCustom() {
        body = "{\"data\":[{\"id\":\"claude-sonnet-4-5\"},{\"id\":\"claude-haiku-4-5\"}]}";
        assertThat(catalog(new AISettings()).list("ANTHROPIC", "k", null).models()).containsExactly("claude-haiku-4-5", "claude-sonnet-4-5");

        calls.clear();
        body = "{\"data\":[{\"id\":\"llama3\"}]}";
        assertThat(catalog(new AISettings()).list("CUSTOM", "k", "https://llm.example.com/v1/chat/completions").models()).containsExactly("llama3");
        assertThat(calls.get(0)[0]).isEqualTo("https://llm.example.com/v1/models");
    }
}
