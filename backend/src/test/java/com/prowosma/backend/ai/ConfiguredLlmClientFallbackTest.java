package com.prowosma.backend.ai;

import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.LlmHttp;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import com.prowosma.backend.service.AISettingsService;
import com.prowosma.backend.service.ConfiguredLlmClient;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.service.LlmModelCatalog;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("ConfiguredLlmClient picks a working model by itself")
class ConfiguredLlmClientFallbackTest {

    private final List<String> postedModels = new ArrayList<>();
    private final Map<String, Integer> statusByModel = new HashMap<>();
    private static final String MODELS = """
        {"models":[
          {"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent"]},
          {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},
          {"name":"models/gemini-2.0-flash","supportedGenerationMethods":["generateContent"]}]}""";
    private static final String OK = "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}]}}],\"usageMetadata\":{}}";

    private ConfiguredLlmClient client(String configuredModel) {
        AISettings s = new AISettings();
        s.setOrganizationId("org1"); s.setAiEnabled(true); s.setApiProvider("GEMINI"); s.setApiKey("enc"); s.setModel(configuredModel);
        AISettingsRepository repo = mock(AISettingsRepository.class);
        when(repo.findByOrganizationId("org1")).thenReturn(List.of(s));
        FieldEncryptionService crypto = mock(FieldEncryptionService.class);
        when(crypto.decrypt(anyString())).thenReturn("KEY");
        LlmHttp http = (method, url, headers, body, priv) -> {
            if ("POST".equals(method)) {
                String id = url.replaceAll(".*/models/", "").replace(":generateContent", "");
                postedModels.add(id);
                int st = statusByModel.getOrDefault(id, 200);
                return new LlmHttp.Result(st, st == 200 ? OK : "{\"error\":{\"message\":\"This model is currently experiencing high demand.\"}}");
            }
            return new LlmHttp.Result(200, MODELS);
        };
        AISettingsService svc = mock(AISettingsService.class);
        when(svc.get()).thenReturn(s);
        return new ConfiguredLlmClient(repo, crypto, http, new LlmModelCatalog(svc, crypto, http));
    }

    @Test @DisplayName("an overloaded model: another one answers, and it is used first next time")
    void overloadedModelFallsBack() {
        statusByModel.put("gemini-2.5-pro", 503);
        ConfiguredLlmClient c = client("gemini-2.5-pro");
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("hello");
        assertThat(postedModels).startsWith("gemini-2.5-pro").hasSize(2);
        postedModels.clear();
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("hello");
        assertThat(postedModels).as("the model that worked goes first now").hasSize(1).doesNotContain("gemini-2.5-pro");
    }

    @Test @DisplayName("a busy provider (429) and a retired model (404) are both handled the same way")
    void rateLimitAndRetiredModel() {
        statusByModel.put("gemini-2.5-pro", 429);
        statusByModel.put("gemini-2.0-flash", 404);                         // retired
        ConfiguredLlmClient c = client("gemini-2.5-pro");
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("hello");
        assertThat(postedModels).containsExactly("gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.5-flash");
    }

    @Test @DisplayName("a rejected key is NOT retried with other models")
    void badKeyIsNotRetried() {
        statusByModel.put("gemini-2.5-pro", 403);
        ConfiguredLlmClient c = client("gemini-2.5-pro");
        assertThatThrownBy(() -> c.complete("org1", "sys", "hi", 100, null)).isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind()).isEqualTo(LlmException.Kind.AUTH);
        assertThat(postedModels).hasSize(1);
    }

    @Test @DisplayName("when every model is busy, the original problem is reported")
    void everythingBusy() {
        for (String m : List.of("gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash")) statusByModel.put(m, 503);
        ConfiguredLlmClient c = client("gemini-2.5-pro");
        assertThatThrownBy(() -> c.complete("org1", "sys", "hi", 100, null)).isInstanceOf(LlmException.class)
                .extracting(e -> ((LlmException) e).getKind()).isEqualTo(LlmException.Kind.SERVER);
        assertThat(postedModels).hasSize(3);
    }
}
