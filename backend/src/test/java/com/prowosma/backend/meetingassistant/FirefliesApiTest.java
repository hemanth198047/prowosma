package com.prowosma.backend.meetingassistant;

import com.prowosma.backend.integration.FirefliesApi;
import com.prowosma.backend.integration.FirefliesException;
import com.prowosma.backend.integration.FirefliesException.Kind;
import com.prowosma.backend.integration.FirefliesHttp;
import com.prowosma.backend.meetingassistant.FirefliesMatcher.Summary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("Fireflies API client (scripted Fireflies)")
class FirefliesApiTest {

    private static final String KEY = "ff-secret-key-123";

    static class Scripted implements FirefliesHttp {
        record Call(String body, String key) {}
        final List<Call> calls = new ArrayList<>();
        final Deque<Result> replies = new ArrayDeque<>();
        IOException fail;
        @Override public Result post(String jsonBody, String apiKey) throws IOException {
            calls.add(new Call(jsonBody, apiKey));
            if (fail != null) throw fail;
            return replies.isEmpty() ? new Result(200, "{\"data\":{}}") : replies.poll();
        }
    }

    private Scripted http;
    private FirefliesApi api;

    @BeforeEach void setUp() { http = new Scripted(); api = new FirefliesApi(http); }

    private void reply(int status, String body) { http.replies.add(new FirefliesHttp.Result(status, body)); }
    private static String error(String code, String extra) { return "{\"errors\":[{\"message\":\"internal wording with " + KEY + "\",\"code\":\"" + code + "\",\"extensions\":{\"code\":\"" + code + "\"" + extra + "}}]}"; }

    // ── requests ─────────────────────────────────────────────────────────────

    @Test @DisplayName("the key travels only as the credential — never inside the query text or variables — and the meeting link is a variable, not pasted into the query")
    void requestShape() {
        reply(200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        api.addToLiveMeeting(KEY, "https://meet.google.com/abc-defg-hij\" } } mutation Evil { x", "Weekly sync");
        var c = http.calls.get(0);
        assertThat(c.key()).isEqualTo(KEY);
        assertThat(c.body()).doesNotContain(KEY).contains("\"variables\"").contains("Weekly sync").contains("addToLiveMeeting");
        try {                                                                                                    // parse what was sent: the injected text is DATA in the variables; the query itself is untouched
            var sent = new com.fasterxml.jackson.databind.ObjectMapper().readTree(c.body());
            assertThat(sent.get("query").asText()).doesNotContain("Evil").contains("addToLiveMeeting(meeting_link: $meetingLink");
            assertThat(sent.get("variables").get("meetingLink").asText()).isEqualTo("https://meet.google.com/abc-defg-hij\" } } mutation Evil { x");
        } catch (java.io.IOException e) { throw new AssertionError(e); }
        reply(200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        api.addToLiveMeeting(KEY, "https://zoom.us/j/84511223344", " ");
        assertThat(http.calls.get(1).body()).doesNotContain("$title");                                            // no title → the simpler mutation
    }

    @Test @DisplayName("sending the notetaker: success, and a plain refusal when Fireflies says no")
    void addToLive() {
        reply(200, "{\"data\":{\"addToLiveMeeting\":{\"success\":false}}}");
        assertThatThrownBy(() -> api.addToLiveMeeting(KEY, "https://meet.google.com/abc-defg-hij", null)).isInstanceOfSatisfying(FirefliesException.class, e -> {
            assertThat(e.getKind()).isEqualTo(Kind.BAD_REQUEST);
            assertThat(e.getMessage()).contains("has to be running right now");
        });
    }

    // ── reading ──────────────────────────────────────────────────────────────

    @Test @DisplayName("the account check returns who the key belongs to")
    void account() {
        reply(200, "{\"data\":{\"user\":{\"name\":\"Priya Sharma\",\"email\":\"priya@acme.com\"}}}");
        var a = api.account(KEY);
        assertThat(a.name()).isEqualTo("Priya Sharma");
        assertThat(a.email()).isEqualTo("priya@acme.com");
        reply(200, "{\"data\":{\"user\":null}}");
        assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.BAD_RESPONSE));
    }

    @Test @DisplayName("recent meetings: ids, titles, links, dates (ISO or epoch), live flag; entries without an id are skipped; the limit is bounded")
    void recent() {
        reply(200, "{\"data\":{\"transcripts\":[{\"id\":\"t1\",\"title\":\"Sync\",\"dateString\":\"2026-10-08T12:00:00.000Z\",\"meeting_link\":\"https://meet.google.com/abc-defg-hij\",\"is_live\":false},"
                + "{\"id\":\"t2\",\"title\":null,\"date\":1791460800000,\"meeting_link\":null,\"is_live\":true},{\"title\":\"no id\"}]}}");
        List<Summary> list = api.recent(KEY, 500);
        assertThat(list).hasSize(2);
        assertThat(list.get(0).date()).isEqualTo(Instant.parse("2026-10-08T12:00:00Z"));
        assertThat(list.get(1).date()).isEqualTo(Instant.ofEpochMilli(1791460800000L));
        assertThat(list.get(1).live()).isTrue();
        assertThat(http.calls.get(0).body()).contains("\"limit\":50");
        reply(200, "{\"data\":{\"transcripts\":null}}");
        assertThat(api.recent(KEY, 5)).isEmpty();
    }

    @Test @DisplayName("a transcript: speaker names, text and times; no transcript yet means 'still processing', not an error")
    void transcript() {
        reply(200, "{\"data\":{\"transcript\":{\"id\":\"abc123\",\"title\":\"Sync\",\"dateString\":\"2026-10-08T12:00:00Z\",\"duration\":31.5,\"meeting_link\":\"https://zoom.us/j/84511223344\",\"is_live\":false,"
                + "\"sentences\":[{\"speaker_name\":\"Priya\",\"text\":\"Hello\",\"start_time\":1.5,\"end_time\":2.0},{\"speaker_name\":null,\"text\":\"Hi\",\"start_time\":null,\"end_time\":3}]}}}");
        var t = api.transcript(KEY, "abc123").orElseThrow();
        assertThat(t.sentences()).hasSize(2);
        assertThat(t.sentences().get(0).speaker()).isEqualTo("Priya");
        assertThat(t.sentences().get(1).speaker()).isNull();
        assertThat(t.sentences().get(1).start()).isNull();
        assertThat(t.durationMinutes()).isEqualTo(31.5);
        reply(200, "{\"data\":{\"transcript\":null}}");
        assertThat(api.transcript(KEY, "abc123")).isEmpty();
        reply(200, "{\"data\":{\"transcript\":{\"id\":\"abc123\",\"sentences\":null}}}");
        assertThat(api.transcript(KEY, "abc123").orElseThrow().sentences()).isEmpty();
    }

    @Test @DisplayName("a malformed transcript id is refused before anything is sent")
    void idValidation() {
        for (String bad : new String[]{null, "", "a", "has space", "x\" } evil", "../../etc", "a".repeat(200)})
            assertThatThrownBy(() -> api.transcript(KEY, bad)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.BAD_REQUEST));
        assertThat(http.calls).isEmpty();
    }

    // ── failures ─────────────────────────────────────────────────────────────

    @Test @DisplayName("each Fireflies error code becomes the right kind of outcome with a fixed message — never the service's wording or the key")
    void errorCodes() {
        Map<String, Kind> expected = new LinkedHashMap<>();
        expected.put("auth_failed", Kind.AUTH); expected.put("paid_required", Kind.PLAN); expected.put("account_cancelled", Kind.PLAN); expected.put("forbidden", Kind.PLAN);
        expected.put("require_elevated_privilege", Kind.PLAN); expected.put("too_many_requests", Kind.RATE_LIMITED); expected.put("unsupported_platform", Kind.UNSUPPORTED_PLATFORM);
        expected.put("object_not_found", Kind.NOT_FOUND); expected.put("invalid_arguments", Kind.BAD_REQUEST); expected.put("args_required", Kind.BAD_REQUEST);
        expected.put("request_timeout", Kind.TRANSIENT); expected.put("something_new", Kind.BAD_RESPONSE);
        expected.forEach((code, kind) -> {
            reply(200, error(code, ""));
            assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> {
                assertThat(e.getKind()).as(code).isEqualTo(kind);
                assertThat(e.getMessage()).as(code).doesNotContain("internal wording").doesNotContain(KEY).isNotBlank();
            });
        });
    }

    @Test @DisplayName("the error code is read from either place Fireflies puts it")
    void codeLocations() {
        reply(200, "{\"errors\":[{\"message\":\"m\",\"extensions\":{\"code\":\"auth_failed\"}}]}");
        assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.AUTH));
        reply(401, error("auth_failed", ""));
        assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.AUTH));
    }

    @Test @DisplayName("rate limits are 'wait and retry', and the pause Fireflies asks for is honoured when it is sensible")
    void rateLimits() {
        Instant in10 = Instant.now().plus(Duration.ofMinutes(10));
        reply(429, error("too_many_requests", ",\"metadata\":{\"retryAfter\":" + in10.toEpochMilli() + "}"));
        assertThatThrownBy(() -> api.recent(KEY, 5)).isInstanceOfSatisfying(FirefliesException.class, e -> {
            assertThat(e.getKind()).isEqualTo(Kind.RATE_LIMITED);
            assertThat(e.isTransient()).isTrue();
            assertThat(e.getRetryAfter()).isBetween(in10.minusSeconds(2), in10.plusSeconds(2));
        });
        reply(200, error("too_many_requests", ",\"metadata\":{\"retryAfter\":\"" + in10 + "\"}"));                       // as an ISO time
        assertThatThrownBy(() -> api.recent(KEY, 5)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getRetryAfter()).isBetween(in10.minusSeconds(2), in10.plusSeconds(2)));
        for (String silly : new String[]{"\"yesterday\"", "1", "99999999999999", "null", "\"2001-01-01T00:00:00Z\""}) {      // unreadable, in the past, or absurdly far away → five minutes
            reply(200, error("too_many_requests", ",\"metadata\":{\"retryAfter\":" + silly + "}"));
            assertThatThrownBy(() -> api.recent(KEY, 5)).isInstanceOfSatisfying(FirefliesException.class,
                    e -> assertThat(e.getRetryAfter()).as(silly).isBetween(Instant.now().plusSeconds(240), Instant.now().plusSeconds(310)));
        }
        reply(429, "not json");
        assertThatThrownBy(() -> api.recent(KEY, 5)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.RATE_LIMITED));
    }

    @Test @DisplayName("HTTP-level problems: bad key, no permission, server trouble, unreadable replies, no network")
    void httpProblems() {
        record C(int status, String body, Kind kind) {}
        for (C c : new C[]{new C(401, "", Kind.AUTH), new C(403, "{}", Kind.PLAN), new C(500, "oops", Kind.TRANSIENT), new C(503, "", Kind.TRANSIENT), new C(408, "", Kind.TRANSIENT),
                new C(200, "<html>", Kind.BAD_RESPONSE), new C(200, "", Kind.BAD_RESPONSE), new C(200, "{\"data\":null}", Kind.BAD_RESPONSE), new C(404, "{}", Kind.BAD_RESPONSE)}) {
            reply(c.status(), c.body());
            assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).as("status " + c.status()).isEqualTo(c.kind()));
        }
        http.fail = new IOException("connection reset");
        assertThatThrownBy(() -> api.account(KEY)).isInstanceOfSatisfying(FirefliesException.class, e -> {
            assertThat(e.getKind()).isEqualTo(Kind.TRANSIENT);
            assertThat(e.isTransient()).isTrue();
        });
    }

    @Test @DisplayName("no key saved is reported without contacting Fireflies")
    void noKey() {
        for (String k : new String[]{null, "", "  "}) assertThatThrownBy(() -> api.account(k)).isInstanceOfSatisfying(FirefliesException.class, e -> assertThat(e.getKind()).isEqualTo(Kind.AUTH));
        assertThat(http.calls).isEmpty();
    }
}
