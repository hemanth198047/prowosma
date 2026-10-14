package com.prowosma.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.AISettings;
import com.prowosma.backend.repository.AISettingsRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.security.SecureRandom;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

/** The AI settings service, with an in-memory repository: the key is never handed out, a blank key keeps the saved one, new keys are encrypted, every save is audited. */
@DisplayName("AI settings service")
class AISettingsServiceTest {

    private static final String SECRET = "sk-ant-api03-THE-WORKSPACE-SECRET";
    private static final FieldEncryptionService CRYPTO = new FieldEncryptionService(Base64.getEncoder().encodeToString(new SecureRandom().generateSeed(32)));
    private static final FieldEncryptionService NO_KEY = new FieldEncryptionService("");

    private final Map<String, AISettings> db = new HashMap<>();
    private final List<String> audit = new ArrayList<>();
    private AISettingsRepository repo;
    private ActivityLogService activity;
    private WorkspaceContext ctx;

    @BeforeEach
    void setUp() {
        db.clear();
        audit.clear();
        repo = (AISettingsRepository) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{AISettingsRepository.class}, (p, m, a) -> switch (m.getName()) {
            case "findByOrganizationId" -> db.values().stream().filter(s -> a[0].equals(s.getOrganizationId())).toList();
            case "save" -> {
                AISettings s = (AISettings) a[0];
                if (s.getId() == null) s.setId("ai-" + (db.size() + 1));
                db.put(s.getId(), s);
                yield s;
            }
            default -> throw new UnsupportedOperationException(m.getName());
        });
        activity = new ActivityLogService(null, null, null) {
            @Override public void log(String type, String id, String name, String action, String oldValue, String newValue, String by) { audit.add(type + ":" + action + ":" + newValue); }
        };
        ctx = new WorkspaceContext();
        ctx.setWorkspaceId("ws1");
    }

    private AISettingsService service(FieldEncryptionService crypto) { return new AISettingsService(repo, activity, ctx, crypto); }

    private static AISettings request(boolean enabled, String key) {
        AISettings s = new AISettings();
        s.setAiEnabled(enabled);
        s.setApiKey(key);
        s.setApiProvider("ANTHROPIC");
        s.setModel("claude-sonnet-4-20250514");
        s.setMaxTokens(1500);
        s.setFeatures(new HashMap<>(Map.of("task_assistant", true, "chatbot", false)));
        return s;
    }

    @Test @DisplayName("what a browser sees never contains the key — only whether one is saved — but keeps everything the page and chat need")
    void viewHidesTheKey() throws Exception {
        AISettingsService svc = service(CRYPTO);
        AISettings saved = svc.save(request(true, SECRET));
        Map<String, Object> v = svc.view(saved);
        assertThat(v).doesNotContainKey("apiKey");
        assertThat(v).containsEntry("apiKeySaved", true).containsEntry("aiEnabled", true).containsEntry("apiProvider", "ANTHROPIC").containsEntry("maxTokens", 1500);
        assertThat(v.get("features")).isEqualTo(Map.of("task_assistant", true, "chatbot", false));
        String json = new ObjectMapper().writeValueAsString(v);
        assertThat(json).doesNotContain("THE-WORKSPACE-SECRET").doesNotContain("enc:v1:").doesNotContain("apiKey\"");
        assertThat(svc.view(new AISettings())).containsEntry("apiKeySaved", false);                   // nothing saved yet
    }

    @Test @DisplayName("a new key is stored encrypted (never as typed) and the server can still use it")
    void keyIsEncryptedAtRest() {
        AISettingsService svc = service(CRYPTO);
        AISettings saved = svc.save(request(true, "  " + SECRET + "  "));
        assertThat(saved.getApiKey()).startsWith("enc:v1:").doesNotContain("THE-WORKSPACE-SECRET");
        assertThat(svc.plainKey(saved)).isEqualTo(SECRET);                                               // trimmed, decrypted for the provider call only
        assertThat(db.values().iterator().next().getApiKey()).startsWith("enc:v1:");                    // what is actually in the database
    }

    @Test @DisplayName("without a server encryption key it still works exactly as before (plain), so nothing breaks on an unconfigured server")
    void worksWithoutEncryptionKey() {
        AISettingsService svc = service(NO_KEY);
        AISettings saved = svc.save(request(true, SECRET));
        assertThat(saved.getApiKey()).isEqualTo(SECRET);
        assertThat(svc.plainKey(saved)).isEqualTo(SECRET);
    }

    @Test @DisplayName("a key saved BEFORE this fix (plain text) keeps working, and is reported as saved")
    void legacyPlainKeysStillWork() {
        AISettings legacy = new AISettings();
        legacy.setOrganizationId("ws1");
        legacy.setApiKey(SECRET);
        legacy.setAiEnabled(true);
        repo.save(legacy);
        AISettingsService svc = service(CRYPTO);
        assertThat(svc.plainKey(svc.get())).isEqualTo(SECRET);
        assertThat(svc.view(svc.get())).containsEntry("apiKeySaved", true).doesNotContainKey("apiKey");
    }

    @Test @DisplayName("saving with an EMPTY key (the page can't see the key, so it sends none) keeps the saved key; a new key replaces it")
    void blankKeyKeepsTheSavedKey() {
        AISettingsService svc = service(CRYPTO);
        svc.save(request(true, SECRET));
        String stored = db.values().iterator().next().getApiKey();
        for (String blank : new String[]{"", "   ", null}) {
            AISettings again = svc.save(request(false, blank));
            assertThat(again.getApiKey()).as("key=" + blank).isEqualTo(stored);
            assertThat(again.isAiEnabled()).isFalse();                                                  // the other changes DID apply
        }
        AISettings replaced = svc.save(request(true, "sk-new-key"));
        assertThat(svc.plainKey(replaced)).isEqualTo("sk-new-key");
        assertThat(db).hasSize(1);                                                                      // updated in place, never duplicated
    }

    @Test @DisplayName("every save is audited — before, only the very first one was — and the audit never contains the key")
    void everySaveIsAudited() {
        AISettingsService svc = service(CRYPTO);
        svc.save(request(true, SECRET));
        svc.save(request(false, ""));
        svc.save(request(true, "sk-other"));
        assertThat(audit).containsExactly("AI_SETTINGS:CREATED:enabled=true", "AI_SETTINGS:UPDATED:enabled=false", "AI_SETTINGS:UPDATED:enabled=true");
        assertThat(String.join(" ", audit)).doesNotContain("sk-").doesNotContain("SECRET");
    }

    @Test @DisplayName("a save that omits the feature switches keeps the existing ones instead of erasing them")
    void missingFeaturesAreKept() {
        AISettingsService svc = service(CRYPTO);
        svc.save(request(true, SECRET));
        AISettings partial = request(true, "");
        partial.setFeatures(null);
        AISettings saved = svc.save(partial);
        assertThat(saved.getFeatures()).isEqualTo(Map.of("task_assistant", true, "chatbot", false));
    }

    @Test @DisplayName("toggling AI or a feature keeps the key and the other settings")
    void togglesKeepTheKey() {
        AISettingsService svc = service(CRYPTO);
        svc.save(request(true, SECRET));
        String stored = db.values().iterator().next().getApiKey();
        assertThat(svc.toggleAI(false).getApiKey()).isEqualTo(stored);
        AISettings f = svc.toggleFeature("chatbot");
        assertThat(f.getApiKey()).isEqualTo(stored);
        assertThat(f.getFeatures()).containsEntry("chatbot", true);
        assertThat(svc.view(f)).doesNotContainKey("apiKey");
    }

    @Test @DisplayName("a workspace only ever sees its own settings")
    void workspacesAreSeparate() {
        AISettingsService svc = service(CRYPTO);
        svc.save(request(true, SECRET));
        ctx.setWorkspaceId("ws2");
        assertThat(svc.get().getId()).isNull();                                                         // nothing saved for the other workspace
        assertThat(svc.view(svc.get())).containsEntry("apiKeySaved", false);
        svc.save(request(false, "sk-ws2-key"));
        assertThat(db).hasSize(2);
        ctx.setWorkspaceId("ws1");
        assertThat(svc.plainKey(svc.get())).isEqualTo(SECRET);
    }
}
