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

@DisplayName("When the main AI is busy or out of quota, a backup provider answers")
class BackupProviderFailoverTest {

    private static final String GEMINI_MODELS = "{\"models\":[{\"name\":\"models/gemini-2.5-flash\",\"supportedGenerationMethods\":[\"generateContent\"]}]}";
    private static final String GEMINI_OK = "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"from gemini\"}]}}],\"usageMetadata\":{}}";
    private static final String GROQ_OK = "{\"choices\":[{\"message\":{\"content\":\"from groq\"},\"finish_reason\":\"stop\"}],\"usage\":{}}";
    private static final String GROQ = "https://api.groq.com/openai/v1/chat/completions";

    private final List<String> calls = new ArrayList<>();      // host of each POST, in order
    private final List<String> bodies = new ArrayList<>();
    private int geminiStatus = 200, groqStatus = 200;

    private ConfiguredLlmClient client(boolean withBackup, boolean backupHasKey) {
        AISettings s = new AISettings();
        s.setOrganizationId("org1"); s.setAiEnabled(true); s.setApiProvider("GEMINI"); s.setApiKey("enc"); s.setModel("gemini-2.5-flash");
        if (withBackup) {
            AISettings.Backup b = new AISettings.Backup();
            b.setId("b1"); b.setLabel("Groq"); b.setApiProvider("CUSTOM"); b.setApiBaseUrl(GROQ); b.setModel("llama-3.3-70b-versatile");
            b.setApiKey(backupHasKey ? "enc2" : "");
            s.setBackups(new ArrayList<>(List.of(b)));
        }
        AISettingsRepository repo = mock(AISettingsRepository.class);
        when(repo.findByOrganizationId("org1")).thenReturn(List.of(s));
        FieldEncryptionService crypto = mock(FieldEncryptionService.class);
        when(crypto.decrypt(anyString())).thenReturn("KEY");
        LlmHttp http = (method, url, headers, body, priv) -> {
            if ("POST".equals(method)) {
                boolean groq = url.contains("groq.com");
                calls.add(groq ? "groq" : "gemini");
                bodies.add(body);
                int st = groq ? groqStatus : geminiStatus;
                String err = "{\"error\":{\"message\":\"quota exceeded\"}}";
                return new LlmHttp.Result(st, st == 200 ? (groq ? GROQ_OK : GEMINI_OK) : err);
            }
            if (url.contains("groq.com")) return new LlmHttp.Result(200, "{\"data\":[{\"id\":\"llama-3.3-70b-versatile\"},{\"id\":\"whisper-large-v3\"}]}");
            return new LlmHttp.Result(200, GEMINI_MODELS);
        };
        AISettingsService svc = mock(AISettingsService.class);
        when(svc.get()).thenReturn(s);
        return new ConfiguredLlmClient(repo, crypto, http, new LlmModelCatalog(svc, crypto, http));
    }

    @Test @DisplayName("a rate-limited main provider hands over to the backup, and the next request goes straight to the backup")
    void rateLimitedMainUsesBackup() {
        geminiStatus = 429;
        ConfiguredLlmClient c = client(true, true);
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("from groq");
        assertThat(calls).containsExactly("gemini", "groq");
        calls.clear();
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("from groq");
        assertThat(calls).as("the main provider is skipped for a few minutes").containsExactly("groq");
    }

    @Test @DisplayName("a rejected main key is rescued by the backup too")
    void rejectedKeyUsesBackup() {
        geminiStatus = 401;
        assertThat(client(true, true).complete("org1", "sys", "hi", 100, null).text()).isEqualTo("from groq");
    }

    @Test @DisplayName("if everything fails, the person is told what went wrong with the main provider and that backups were tried")
    void everythingFails() {
        geminiStatus = 429; groqStatus = 429;
        assertThatThrownBy(() -> client(true, true).complete("org1", "sys", "hi", 100, null))
                .isInstanceOf(LlmException.class).hasMessageContaining("rate limiting").hasMessageContaining("backup")
                .extracting(e -> ((LlmException) e).getKind()).isEqualTo(LlmException.Kind.RATE_LIMITED);
    }

    @Test @DisplayName("a backup without a key is ignored, and the main provider's own error is reported unchanged")
    void backupWithoutKey() {
        geminiStatus = 429;
        assertThatThrownBy(() -> client(true, false).complete("org1", "sys", "hi", 100, null))
                .isInstanceOf(LlmException.class).hasMessageNotContaining("backup");
        assertThat(calls).doesNotContain("groq");
    }

    @Test @DisplayName("a healthy main provider never touches the backup; OpenAI-style backups get max_tokens")
    void healthyMainAndBodyShape() {
        ConfiguredLlmClient c = client(true, true);
        assertThat(c.complete("org1", "sys", "hi", 100, null).text()).isEqualTo("from gemini");
        assertThat(calls).containsExactly("gemini");
        calls.clear(); bodies.clear();
        geminiStatus = 503;
        ConfiguredLlmClient c2 = client(true, true);
        c2.complete("org1", "sys", "hi", 321, null);
        assertThat(bodies.get(bodies.size() - 1)).contains("\"max_tokens\":321").doesNotContain("max_completion_tokens");
    }
}
