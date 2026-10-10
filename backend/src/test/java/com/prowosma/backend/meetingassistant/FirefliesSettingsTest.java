package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.integration.FirefliesHttp;
import com.prowosma.backend.model.MeetingAssistantSettings;
import com.prowosma.backend.service.FieldEncryptionService;
import com.prowosma.backend.service.MeetingAssistantException;
import com.prowosma.backend.service.MeetingFirefliesService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("Fireflies settings, readiness and error messages")
class FirefliesSettingsTest {

    private static final FieldEncryptionService CRYPTO = new FieldEncryptionService(Base64.getEncoder().encodeToString(new SecureRandom().generateSeed(32)));
    private static final FieldEncryptionService NO_KEY = new FieldEncryptionService("");

    private static MeetingFirefliesService service(FieldEncryptionService crypto, FirefliesHttp http) {
        return new MeetingFirefliesService(null, crypto, null, null, null, new FirefliesApi(http));
    }

    private static Map<String, Object> patch(Object... kv) { Map<String, Object> m = new LinkedHashMap<>(); for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]); return m; }

    private static MeetingAssistantException rejected(Runnable r) {
        try { r.run(); } catch (MeetingAssistantException e) { return e; }
        throw new AssertionError("expected the change to be refused");
    }

    @Test @DisplayName("people are told exactly why Fireflies isn't usable yet: off, no key, or no encryption key")
    void readiness() {
        MeetingAssistantSettings st = new MeetingAssistantSettings();
        assertThat(service(CRYPTO, null).notReadyReason(st)).contains("isn't turned on");
        st.setFirefliesEnabled(true);
        assertThat(service(CRYPTO, null).notReadyReason(st)).contains("No Fireflies API key");
        st.setFirefliesApiKeyEnc(CRYPTO.encrypt("k"));
        assertThat(service(CRYPTO, null).notReadyReason(st)).isNull();
        assertThat(service(NO_KEY, null).notReadyReason(st)).contains("ENCRYPTION_KEY");
        st.setFirefliesEnabled(false);
        assertThat(service(CRYPTO, null).fetchNotReadyReason(st)).isNull();      // a notetaker already in a meeting is still collected after the integration is switched off
    }

    @Test @DisplayName("the key is stored encrypted, is never readable back, and can be replaced, kept, or removed")
    void keyHandling() {
        MeetingAssistantSettings st = new MeetingAssistantSettings();
        MeetingFirefliesService svc = service(CRYPTO, null);
        svc.applySettingsPatch(patch("firefliesApiKey", " ff-live-SECRET ", "firefliesEnabled", true), st);
        assertThat(st.getFirefliesApiKeyEnc()).startsWith("enc:v1:").doesNotContain("SECRET");
        assertThat(st.isFirefliesKeySaved()).isTrue();
        assertThat(svc.apiKey(st)).isEqualTo("ff-live-SECRET");
        String saved = st.getFirefliesApiKeyEnc();
        svc.applySettingsPatch(patch("firefliesApiKey", "", "firefliesEnabled", true), st);
        svc.applySettingsPatch(patch("firefliesApiKey", "   "), st);
        assertThat(st.getFirefliesApiKeyEnc()).isEqualTo(saved);
        st.setFirefliesEnabled(false);
        svc.applySettingsPatch(patch("clearFirefliesApiKey", true), st);
        assertThat(st.isFirefliesKeySaved()).isFalse();
        assertThat(svc.apiKey(st)).isNull();
    }

    @Test @DisplayName("odd keys are refused, a key can't be saved without the server's encryption key, and nothing is stored in the clear")
    void refusals() {
        MeetingFirefliesService svc = service(CRYPTO, null);
        for (String bad : new String[]{"has space", "tab\there", "k".repeat(301), "new\nline"}) {
            MeetingAssistantSettings st = new MeetingAssistantSettings();
            assertThat(rejected(() -> svc.applySettingsPatch(patch("firefliesApiKey", bad), st)).getCode()).as(bad).isEqualTo("INVALID_FIREFLIES_KEY");
            assertThat(st.getFirefliesApiKeyEnc()).isNull();
        }
        MeetingAssistantSettings st = new MeetingAssistantSettings();
        assertThat(rejected(() -> service(NO_KEY, null).applySettingsPatch(patch("firefliesApiKey", "ok-key"), st)).getCode()).isEqualTo("ENCRYPTION_REQUIRED");
        assertThat(st.getFirefliesApiKeyEnc()).isNull();
    }

    @Test @DisplayName("Fireflies can't be switched on without a key; unrelated saves are never blocked by it")
    void preconditions() {
        MeetingFirefliesService svc = service(CRYPTO, null);
        assertThat(rejected(() -> svc.applySettingsPatch(patch("firefliesEnabled", true), new MeetingAssistantSettings())).getCode()).isEqualTo("FIREFLIES_NOT_READY");
        MeetingAssistantSettings half = new MeetingAssistantSettings();
        half.setFirefliesEnabled(true);                                                  // enabled earlier, key since removed
        svc.applySettingsPatch(patch("assistantName", "Acme Notes", "defaultVisibility", "PRIVATE"), half);     // unrelated: no complaint
        assertThat(rejected(() -> svc.applySettingsPatch(patch("firefliesEnabled", true), half)).getCode()).isEqualTo("FIREFLIES_NOT_READY");
    }

    @Test @DisplayName("Test connection says whose account it reached, or why it failed — and never shows the key")
    void connectionTest() {
        MeetingAssistantSettings st = new MeetingAssistantSettings();
        st.setFirefliesApiKeyEnc(CRYPTO.encrypt("ff-test-SECRET"));
        List<String> sentKeys = new ArrayList<>();
        FirefliesHttp ok = (body, key) -> { sentKeys.add(key); return new FirefliesHttp.Result(200, "{\"data\":{\"user\":{\"name\":\"Priya\",\"email\":\"priya@acme.com\"}}}"); };
        Map<String, Object> good = service(CRYPTO, ok).testConnection(st);
        assertThat(good).containsEntry("ok", true);
        assertThat(String.valueOf(good.get("message"))).contains("priya@acme.com");
        assertThat(sentKeys).containsExactly("ff-test-SECRET");
        FirefliesHttp rejects = (body, key) -> new FirefliesHttp.Result(401, "{\"errors\":[{\"code\":\"auth_failed\",\"message\":\"bad ff-test-SECRET\"}]}");
        Map<String, Object> bad = service(CRYPTO, rejects).testConnection(st);
        assertThat(bad).containsEntry("ok", false);
        assertThat(String.valueOf(bad.get("message"))).contains("rejected the API key").doesNotContain("SECRET");
        FirefliesHttp down = (body, key) -> { throw new IOException("reset"); };
        assertThat(String.valueOf(service(CRYPTO, down).testConnection(st).get("message"))).contains("Couldn't reach Fireflies");
        Map<String, Object> none = service(CRYPTO, ok).testConnection(new MeetingAssistantSettings());
        assertThat(none).containsEntry("ok", false);
        assertThat(sentKeys).hasSize(1);                                                  // with no key saved, nothing was sent anywhere
    }

    @Test @DisplayName("each kind of Fireflies failure becomes the right plain error for the browser")
    void errorMapping() {
        record C(FirefliesException.Kind kind, String status, String code) {}
        for (C c : new C[]{new C(FirefliesException.Kind.AUTH, "CONFLICT", "FIREFLIES_KEY_REJECTED"), new C(FirefliesException.Kind.PLAN, "CONFLICT", "FIREFLIES_PLAN"),
                new C(FirefliesException.Kind.RATE_LIMITED, "TOO_MANY_REQUESTS", "FIREFLIES_RATE_LIMITED"), new C(FirefliesException.Kind.UNSUPPORTED_PLATFORM, "BAD_REQUEST", "UNSUPPORTED_PLATFORM"),
                new C(FirefliesException.Kind.BAD_REQUEST, "CONFLICT", "MEETING_NOT_RUNNING"), new C(FirefliesException.Kind.NOT_FOUND, "NOT_FOUND", "FIREFLIES_NOT_FOUND"),
                new C(FirefliesException.Kind.TRANSIENT, "SERVICE_UNAVAILABLE", "FIREFLIES_UNAVAILABLE"), new C(FirefliesException.Kind.BAD_RESPONSE, "SERVICE_UNAVAILABLE", "FIREFLIES_UNAVAILABLE")}) {
            MeetingAssistantException e = MeetingFirefliesService.toApiError(new FirefliesException(c.kind(), "Fireflies didn't accept the request."));
            assertThat(e.getCode()).as(c.kind().name()).isEqualTo(c.code());
            assertThat(e.getStatus().name()).isEqualTo(c.status());
            assertThat(e.getMessage()).isNotBlank();
        }
    }
}
