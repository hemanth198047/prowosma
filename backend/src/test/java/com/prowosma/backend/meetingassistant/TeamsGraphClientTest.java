package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.integration.GraphApiException;
import com.prowosma.backend.integration.GraphApiException.Kind;
import com.prowosma.backend.integration.JdkGraphHttp;
import com.prowosma.backend.integration.TeamsGraphApi;
import com.prowosma.backend.service.TeamsAuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The Microsoft client and app-only sign-in against a SCRIPTED fake: request shape, caching, error mapping, safety checks. */
@DisplayName("Teams Graph client and app-only sign-in")
class TeamsGraphClientTest {

    private static final String ORG = "8b081ef6-4792-4def-b2c9-c363a1bf41d5";
    private static final String TENANT = "11111111-2222-3333-4444-555555555555";
    private FakeGraphHttp http;
    private TeamsGraphApi api;
    private TeamsAuthService auth;

    @BeforeEach
    void setUp() {
        http = new FakeGraphHttp();
        api = new TeamsGraphApi(http);
        auth = new TeamsAuthService(http);
        ReflectionTestUtils.setField(auth, "clientId", "client-123");
        ReflectionTestUtils.setField(auth, "clientSecret", "s3cret-value");
    }

    private static String jwt(String... roles) {
        String payload = "{\"roles\":[" + String.join(",", java.util.Arrays.stream(roles).map(r -> "\"" + r + "\"").toList()) + "]}";
        return "h." + Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".s";
    }

    private static String tokenBody(String jwt) { return "{\"access_token\":\"" + jwt + "\",\"expires_in\":3600}"; }

    // ── sign-in ──────────────────────────────────────────────────────────────

    @Test @DisplayName("requests an app-only token for the tenant, caches it, and reads the granted roles")
    void tokenRequestCachingAndRoles() {
        http.on("/oauth2/v2.0/token", 200, tokenBody(jwt(TeamsAuthService.TRANSCRIPT_ROLE)));
        var t = auth.token(TENANT);
        assertThat(t.roles()).containsExactly(TeamsAuthService.TRANSCRIPT_ROLE);
        var call = http.calls().get(0);
        assertThat(call.url()).isEqualTo("https://login.microsoftonline.com/" + TENANT + "/oauth2/v2.0/token");
        assertThat(call.body()).contains("grant_type=client_credentials").contains("client_id=client-123").contains("client_secret=s3cret-value")
                .contains("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
        assertThat(call.url()).doesNotContain("s3cret");                                              // the secret is only ever in the body
        auth.token(TENANT);
        assertThat(http.callsTo("/token")).isEqualTo(1);                                              // cached — no second request
        auth.forget(TENANT);
        auth.token(TENANT);
        assertThat(http.callsTo("/token")).isEqualTo(2);
    }

    @Test @DisplayName("Microsoft's sign-in errors become a fixed set of plain reasons; their text is never repeated")
    void signInErrorsAreSanitised() {
        for (var c : new String[][]{{"AADSTS7000215", "BAD_SECRET"}, {"AADSTS700016", "CONSENT_MISSING"}, {"AADSTS65001", "CONSENT_MISSING"},
                {"AADSTS90002", "TENANT_NOT_FOUND"}, {"AADSTS999999", "REJECTED"}}) {
            http.reset();
            http.on("/token", 400, "{\"error\":\"invalid_client\",\"error_description\":\"" + c[0] + ": Invalid client secret provided s3cret-value trace 123\"}");
            assertThatThrownBy(() -> auth.token(TENANT)).isInstanceOfSatisfying(GraphApiException.class, e -> {
                assertThat(e.getCode()).as(c[0]).isEqualTo(c[1]);
                assertThat(e.getMessage()).doesNotContain("s3cret").doesNotContain("trace");
            });
        }
        http.reset(); http.on("/token", 503, "{}");
        assertThatThrownBy(() -> auth.token(TENANT)).isInstanceOfSatisfying(GraphApiException.class, e -> assertThat(e.isTransient()).isTrue());
    }

    @Test @DisplayName("refuses to sign in when unconfigured or given a malformed tenant, without calling Microsoft")
    void guards() {
        assertThatThrownBy(() -> auth.token("not-a-guid")).isInstanceOf(GraphApiException.class);
        assertThatThrownBy(() -> auth.token("../../evil")).isInstanceOf(GraphApiException.class);
        ReflectionTestUtils.setField(auth, "clientSecret", "");
        assertThat(auth.isConfigured()).isFalse();
        assertThat(auth.consentUrl(TENANT)).isNull();
        assertThatThrownBy(() -> auth.token(TENANT)).isInstanceOfSatisfying(GraphApiException.class, e -> assertThat(e.getCode()).isEqualTo("NOT_CONFIGURED"));
        assertThat(http.calls()).isEmpty();
    }

    @Test @DisplayName("the admin-consent link names the app and the tenant, and never contains the secret")
    void consentUrl() {
        String url = auth.consentUrl(TENANT.toUpperCase());
        assertThat(url).isEqualTo("https://login.microsoftonline.com/" + TENANT + "/adminconsent?client_id=client-123");
        assertThat(auth.consentUrl("nonsense")).isNull();
    }

    // ── transcripts ──────────────────────────────────────────────────────────

    @Test @DisplayName("lists an organizer's transcripts in a time window with the documented call, following only Graph's own paging links")
    void listTranscripts() {
        http.on("getAllTranscripts", 200, "{\"value\":[{\"id\":\"T1\",\"meetingId\":\"M1\",\"createdDateTime\":\"2026-10-07T09:01:00Z\",\"endDateTime\":\"2026-10-07T09:55:00Z\"}],"
                + "\"@odata.nextLink\":\"https://graph.microsoft.com/v1.0/users/x/next-page\"}");
        http.on("next-page", 200, "{\"value\":[{\"id\":\"T2\",\"meetingId\":\"M1\",\"createdDateTime\":\"2026-10-07T10:01:00Z\"}],\"@odata.nextLink\":\"https://evil.example/steal\"}");
        var list = api.listOrganizerTranscripts("TOKEN", ORG, Instant.parse("2026-10-07T08:00:00Z"), Instant.parse("2026-10-07T20:00:00Z"));
        assertThat(list).extracting(TeamsGraphApi.Transcript::id).containsExactly("T1", "T2");
        assertThat(list.get(0).endedAt()).isEqualTo(Instant.parse("2026-10-07T09:55:00Z"));
        assertThat(list.get(1).endedAt()).isNull();
        var first = http.calls().get(0);
        assertThat(first.url()).startsWith("https://graph.microsoft.com/v1.0/users/" + ORG + "/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='" + ORG + "')")
                .contains("$filter=createdDateTime%20ge%202026-10-07T08%3A00%3A00Z%20and%20createdDateTime%20le%202026-10-07T20%3A00%3A00Z");
        assertThat(first.headers()).containsEntry("Authorization", "Bearer TOKEN");
        assertThat(http.calls()).hasSize(2);                                                         // the link to evil.example was NOT followed
    }

    @Test @DisplayName("downloads a transcript as WebVTT")
    void downloadVtt() {
        http.on("/content", 200, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Priya>Hi</v>\n");
        String vtt = api.transcriptVtt("TOKEN", ORG, "MSo1N2Y5ZGFjYy0=", "VjIjIzExYz+/=");
        assertThat(vtt).startsWith("WEBVTT");
        var call = http.calls().get(0);
        assertThat(call.headers()).containsEntry("Accept", "text/vtt");
        assertThat(call.url()).isEqualTo("https://graph.microsoft.com/v1.0/users/" + ORG + "/onlineMeetings/MSo1N2Y5ZGFjYy0%3D/transcripts/VjIjIzExYz%2B%2F%3D/content");   // path segments are encoded
    }

    @Test @DisplayName("identifiers are validated before they can reach a URL")
    void idsAreValidated() {
        assertThatThrownBy(() -> api.listOrganizerTranscripts("T", "../admin", Instant.now(), Instant.now())).isInstanceOf(GraphApiException.class);
        assertThatThrownBy(() -> api.listOrganizerTranscripts("T", "me@corp.test", Instant.now(), Instant.now())).isInstanceOf(GraphApiException.class);
        assertThatThrownBy(() -> api.transcriptVtt("T", ORG, "bad id with spaces", "T1")).isInstanceOf(GraphApiException.class);
        assertThatThrownBy(() -> api.transcriptVtt("T", ORG, "M1M1M1M1", "x?y=z&evil")).isInstanceOf(GraphApiException.class);
        assertThat(http.calls()).isEmpty();
    }

    @Test @DisplayName("HTTP failures map to clear kinds; Microsoft's bodies never appear in messages")
    void errorMapping() {
        record C(int status, String body, Kind kind) {}
        for (C c : new C[]{new C(401, "{}", Kind.UNAUTHORIZED), new C(403, "{\"error\":{\"code\":\"Forbidden\",\"message\":\"secret detail\"}}", Kind.FORBIDDEN),
                new C(403, "{\"error\":{\"code\":\"GraphAccessToTranscriptsDisabled\"}}", Kind.TRANSCRIPTS_DISABLED), new C(404, "{}", Kind.NOT_FOUND),
                new C(429, "{}", Kind.RATE_LIMITED), new C(503, "{}", Kind.SERVER), new C(400, "{\"error\":\"secret detail\"}", Kind.BAD_RESPONSE)}) {
            http.reset();
            http.on("getAllTranscripts", c.status(), c.body());
            assertThatThrownBy(() -> api.listOrganizerTranscripts("T", ORG, Instant.now(), Instant.now())).isInstanceOfSatisfying(GraphApiException.class, e -> {
                assertThat(e.getKind()).as("status " + c.status() + " " + c.body()).isEqualTo(c.kind());
                assertThat(e.getMessage()).doesNotContain("secret detail");
            });
        }
        assertThat(new GraphApiException(Kind.NETWORK, "N", "x").isTransient()).isTrue();
        assertThat(new GraphApiException(Kind.FORBIDDEN, "F", "x").isTransient()).isFalse();
    }

    // ── transport policy ─────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(strings = {"http://graph.microsoft.com/v1.0/users", "https://169.254.169.254/latest", "https://localhost/x", "https://graph.microsoft.com.evil.example/v1.0",
            "https://evil.example/graph.microsoft.com", "https://user:pw@graph.microsoft.com/v1.0", "https://graph.microsoft.com:8443/v1.0", "https://login.microsoftonline.com.evil.example/t/oauth2/v2.0/token"})
    void transportBlocksEverythingExceptMicrosoft(String url) {
        assertThatThrownBy(() -> new JdkGraphHttp().send("GET", url, Map.of(), null)).isInstanceOf(IllegalArgumentException.class);
    }
}
