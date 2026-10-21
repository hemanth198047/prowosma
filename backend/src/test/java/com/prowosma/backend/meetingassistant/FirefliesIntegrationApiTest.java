package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.prowosma.backend.integration.FirefliesHttp;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.TranscriptSegment;
import com.prowosma.backend.service.FirefliesTranscriptFetchHandler;
import com.prowosma.backend.service.MeetingJobRunner;
import com.prowosma.backend.service.MeetingJobService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * The Fireflies notetaker through the real HTTP API, database and job queue, with a SCRIPTED Fireflies. Proves OUR logic — it does not prove how the real
 * Fireflies service answers. Everything is additive: Google Meet, Teams and recording behaviour is covered by their own tests and must be unchanged.
 */
@TestPropertySource(properties = {
        "security.field-encryption-key=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        "app.meeting-assistant.jobs-enabled=false"})
@DisplayName("Fireflies — send the notetaker, import its transcript")
class FirefliesIntegrationApiTest extends MeetingAssistantTestBase {

    // ── the scripted Fireflies ───────────────────────────────────────────────

    static class ScriptedFireflies implements FirefliesHttp {
        record Call(String body, String key) {}
        private record Rule(String bodyContains, Result response) {}
        final List<Call> calls = new CopyOnWriteArrayList<>();
        private final List<Rule> rules = new CopyOnWriteArrayList<>();
        void reset() { calls.clear(); rules.clear(); }
        ScriptedFireflies on(String bodyContains, int status, String json) { rules.add(0, new Rule(bodyContains, new Result(status, json))); return this; }
        long callsTo(String text) { return calls.stream().filter(c -> c.body().contains(text)).count(); }
        @Override public Result post(String jsonBody, String apiKey) {
            calls.add(new Call(jsonBody, apiKey));
            for (Rule r : rules) if (jsonBody.contains(r.bodyContains())) return r.response();
            return new Result(200, "{\"data\":{}}");
        }
    }

    @TestConfiguration
    static class Cfg {
        @Bean @Primary ScriptedFireflies scriptedFireflies() { return new ScriptedFireflies(); }
    }

    @Autowired private ScriptedFireflies ff;
    @Autowired private MeetingJobRunner runner;
    @Autowired private MeetingJobService jobs;

    private static final String KEY = "ff-live-SECRET-KEY";
    private static final String MEET_LINK = "https://meet.google.com/abc-defg-hij";
    private static final String ZOOM_LINK = "https://us02web.zoom.us/j/84511223344?pwd=abc123";

    @BeforeEach void freshFake() { ff.reset(); }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Map<String, Object> obj(Object... kv) { Map<String, Object> m = new LinkedHashMap<>(); for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]); return m; }

    private MvcResult send(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, String token) throws Exception { return mvc.perform(as(b, token, workspaceId)).andReturn(); }

    private MvcResult sendJson(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder b, String token, Object body) throws Exception {
        return mvc.perform(as(b, token, workspaceId).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body))).andReturn();
    }

    private JsonNode ok(MvcResult r) throws Exception {
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isBetween(200, 201);
        return json(r);
    }

    private void expect(MvcResult r, int status, String code) throws Exception {
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
        if (code != null) assertThat(json(r).get("error").asText()).isEqualTo(code);
    }

    private void enableFireflies() throws Exception { ok(sendJson(put(ADMIN + "/settings"), ownerToken(), obj("firefliesEnabled", true, "firefliesApiKey", KEY))); }

    private JsonNode notetaker(String link, String token) throws Exception {
        return ok(sendJson(post(BASE + "/fireflies/notetaker"), token, obj("meetingUrl", link, "title", "Weekly sync", "consent", true)));
    }

    private JsonNode view(String id) throws Exception { return ok(send(get(BASE + "/sessions/" + id), memberToken())); }

    private void due(String id) {
        mongoTemplate.updateMulti(new Query(Criteria.where("sessionId").is(id)), new Update().set("runAfter", Instant.now().minusSeconds(1)), MeetingJob.class);
    }

    private List<TranscriptSegment> segments(String id) {
        List<TranscriptSegment> list = mongoTemplate.find(new Query(Criteria.where("sessionId").is(id)), TranscriptSegment.class);
        list.sort(Comparator.comparingInt(TranscriptSegment::getSeq));
        return list;
    }

    private static String listReply(String id, String link, String when, boolean live) {
        return "{\"data\":{\"transcripts\":[{\"id\":\"" + id + "\",\"title\":\"Weekly sync\",\"dateString\":\"" + when + "\",\"meeting_link\":\"" + link + "\",\"is_live\":" + live + "}]}}";
    }

    private static String transcriptReply(String id, String link) {
        return "{\"data\":{\"transcript\":{\"id\":\"" + id + "\",\"title\":\"Weekly sync\",\"duration\":30,\"meeting_link\":\"" + link + "\",\"is_live\":false,\"sentences\":["
                + "{\"speaker_name\":\"Priya Sharma\",\"text\":\"Welcome everyone.\",\"start_time\":1.5,\"end_time\":3.0},"
                + "{\"speaker_name\":\"Arjun Rao\",\"text\":\"I will send the budget.\",\"start_time\":4.0,\"end_time\":6.0}]}}}";
    }

    private String now() { return Instant.now().minus(10, ChronoUnit.MINUTES).toString(); }

    // ── off by default; admin setup ──────────────────────────────────────────

    @Test @DisplayName("off by default, with the reason; Google Meet and Teams are unaffected")
    void offByDefault() throws Exception {
        JsonNode caps = ok(send(get(BASE + "/capabilities"), memberToken()));
        assertThat(caps.get("fireflies").get("enabled").asBoolean()).isFalse();
        assertThat(caps.get("fireflies").get("ready").asBoolean()).isFalse();
        assertThat(caps.get("fireflies").get("reason").asText()).contains("isn't turned on");
        assertThat(caps.has("platforms")).isTrue();
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK, "consent", true)), 409, "FIREFLIES_NOT_READY");
        expect(send(get(BASE + "/fireflies/recent"), memberToken()), 409, "FIREFLIES_NOT_READY");
        assertThat(ff.calls).isEmpty();
    }

    @Test @DisplayName("an admin sets it up; the key is never readable back; members can't change it; Test connection says whose account it is")
    void adminSetup() throws Exception {
        expect(sendJson(put(ADMIN + "/settings"), memberToken(), obj("firefliesEnabled", true)), 403, null);
        expect(sendJson(put(ADMIN + "/settings"), ownerToken(), obj("firefliesEnabled", true)), 409, "FIREFLIES_NOT_READY");        // can't switch on without a key
        enableFireflies();
        MvcResult r = send(get(ADMIN + "/settings"), ownerToken());
        assertThat(json(r).get("firefliesEnabled").asBoolean()).isTrue();
        assertThat(json(r).get("firefliesKeySaved").asBoolean()).isTrue();
        assertThat(r.getResponse().getContentAsString()).doesNotContain("SECRET").doesNotContain("firefliesApiKeyEnc").doesNotContain("enc:v1:");
        assertThat(ok(send(get(BASE + "/capabilities"), memberToken())).get("fireflies").get("ready").asBoolean()).isTrue();

        ff.on("user", 200, "{\"data\":{\"user\":{\"name\":\"Priya\",\"email\":\"priya@acme.com\"}}}");
        JsonNode good = ok(send(post(ADMIN + "/fireflies/test"), ownerToken()));
        assertThat(good.get("ok").asBoolean()).isTrue();
        assertThat(good.get("message").asText()).contains("priya@acme.com");
        assertThat(ff.calls.get(0).key()).isEqualTo(KEY);
        ff.reset();
        ff.on("user", 401, "{\"errors\":[{\"code\":\"auth_failed\",\"message\":\"bad " + KEY + "\"}]}");
        MvcResult bad = send(post(ADMIN + "/fireflies/test"), ownerToken());
        assertThat(json(bad).get("ok").asBoolean()).isFalse();
        assertThat(bad.getResponse().getContentAsString()).contains("rejected the API key").doesNotContain("SECRET");
        expect(send(post(ADMIN + "/fireflies/test"), memberToken()), 403, null);
    }

    // ── sending the notetaker ────────────────────────────────────────────────

    @Test @DisplayName("sending to a new Google Meet or Zoom meeting: consent first, links checked, the notetaker sent, and the meeting waits for its transcript")
    void sendToNewMeeting() throws Exception {
        enableFireflies();
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK)), 400, "CONSENT_REQUIRED");
        for (String bad : new String[]{"http://meet.google.com/abc-defg-hij", "https://meet.google.com.evil.com/abc-defg-hij", "https://example.com/room", "not a link"})
            expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", bad, "consent", true)), 400, "INVALID_MEETING_LINK");
        assertThat(ff.calls).isEmpty();                                                    // nothing reached Fireflies for an invalid link

        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        JsonNode v = notetaker(MEET_LINK, memberToken());
        assertThat(v.get("provider").asText()).isEqualTo("FIREFLIES");
        assertThat(v.get("platform").asText()).isEqualTo("GOOGLE_MEET");
        assertThat(v.get("fireflies").get("state").asText()).isEqualTo("SENT");
        assertThat(v.get("fireflies").get("platformName").asText()).isEqualTo("Google Meet");
        assertThat(v.get("status").asText()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(v.get("lastCheck").get("code").asText()).isEqualTo("FIREFLIES_SENT");
        assertThat(v.get("lastCheck").get("message").asText()).contains("admit it");
        assertThat(ff.calls.get(0).key()).isEqualTo(KEY);
        assertThat(ff.calls.get(0).body()).contains(MEET_LINK).doesNotContain(KEY);
        assertThat(jobs.find(workspaceId, v.get("id").asText(), FirefliesTranscriptFetchHandler.TYPE)).isPresent();

        JsonNode zoom = notetaker(ZOOM_LINK, memberToken());
        assertThat(zoom.get("platform").asText()).isEqualTo("ZOOM");
        assertThat(ff.calls.get(1).body()).contains("pwd=abc123");                          // the Zoom passcode travels with the link
    }

    @Test @DisplayName("the same meeting can't be registered twice, and Fireflies is not bothered a second time")
    void duplicate() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        notetaker(MEET_LINK, memberToken());
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK + "?authuser=2", "consent", true)), 409, "ALREADY_REGISTERED");
        assertThat(ff.callsTo("addToLiveMeeting")).isEqualTo(1L);
    }

    @Test @DisplayName("Fireflies' own limit (3 per 20 minutes) is respected before a request is wasted")
    void sendLimit() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        for (String code : new String[]{"aaa-bbbb-ccc", "ddd-eeee-fff", "ggg-hhhh-iii"}) notetaker("https://meet.google.com/" + code, memberToken());
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", "https://meet.google.com/jjj-kkkk-lll", "consent", true)), 429, "NOTETAKER_LIMIT");
        assertThat(ff.callsTo("addToLiveMeeting")).isEqualTo(3L);
    }

    @Test @DisplayName("when Fireflies refuses — meeting not running, unsupported, bad key, plan — the reason is plain, and no empty meeting is left behind")
    void refusals() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"errors\":[{\"code\":\"invalid_arguments\",\"message\":\"internal text\"}]}");
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK, "consent", true)), 409, "MEETING_NOT_RUNNING");
        ff.reset(); ff.on("addToLiveMeeting", 200, "{\"errors\":[{\"code\":\"unsupported_platform\",\"message\":\"x\"}]}");
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", ZOOM_LINK, "consent", true)), 400, "UNSUPPORTED_PLATFORM");
        ff.reset(); ff.on("addToLiveMeeting", 401, "{\"errors\":[{\"code\":\"auth_failed\",\"message\":\"x\"}]}");
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK, "consent", true)), 409, "FIREFLIES_KEY_REJECTED");
        ff.reset(); ff.on("addToLiveMeeting", 200, "{\"errors\":[{\"code\":\"paid_required\",\"message\":\"x\"}]}");
        expect(sendJson(post(BASE + "/fireflies/notetaker"), memberToken(), obj("meetingUrl", MEET_LINK, "consent", true)), 409, "FIREFLIES_PLAN");
        for (JsonNode s : ok(send(get(BASE + "/sessions"), memberToken()))) assertThat(s.get("status").asText()).isNotEqualTo("AWAITING_TRANSCRIPT");   // every failed attempt was cancelled
        // and after all that, the same link can be tried again
        ff.reset(); ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        assertThat(notetaker(MEET_LINK, memberToken()).get("fireflies").get("state").asText()).isEqualTo("SENT");
    }

    // ── getting the transcript back ──────────────────────────────────────────

    @Test @DisplayName("not there yet: it says what it checked and the likely cause, and looks again later without failing")
    void stillWaiting() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        String id = notetaker(MEET_LINK, memberToken()).get("id").asText();
        ff.on("Recent", 200, listReply("other", "https://meet.google.com/zzz-yyyy-xxx", now(), false));
        due(id);
        runner.runOnce();
        JsonNode v = view(id);
        assertThat(v.get("status").asText()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(v.get("lastCheck").get("code").asText()).isEqualTo("FIREFLIES_WAITING");
        assertThat(v.get("lastCheck").get("message").asText()).contains("admitted to the meeting by the host");
        MeetingJob job = jobs.find(workspaceId, id, FirefliesTranscriptFetchHandler.TYPE).orElseThrow();
        assertThat(job.getStatus()).isEqualTo("QUEUED");
        assertThat(job.getRunAfter()).isAfter(Instant.now().plusSeconds(240));
        assertThat(job.getErrorStreak()).isZero();                                         // waiting is not an error
    }

    @Test @DisplayName("a Fireflies rate limit is waited out as asked and is never a failure")
    void rateLimited() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        String id = notetaker(MEET_LINK, memberToken()).get("id").asText();
        long resume = Instant.now().plus(30, ChronoUnit.MINUTES).toEpochMilli();
        ff.on("Recent", 429, "{\"errors\":[{\"code\":\"too_many_requests\",\"extensions\":{\"code\":\"too_many_requests\",\"metadata\":{\"retryAfter\":" + resume + "}}}]}");
        due(id);
        runner.runOnce();
        JsonNode v = view(id);
        assertThat(v.get("status").asText()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(v.get("lastCheck").get("code").asText()).isEqualTo("FIREFLIES_RATE_LIMITED");
        MeetingJob job = jobs.find(workspaceId, id, FirefliesTranscriptFetchHandler.TYPE).orElseThrow();
        assertThat(job.getRunAfter().toEpochMilli()).isBetween(resume - 2000, resume + 2000);
        assertThat(job.getErrorStreak()).isZero();
    }

    @Test @DisplayName("several meetings waiting at once share ONE Fireflies request — a free plan's daily allowance isn't used up by polling")
    void sharedPolling() throws Exception {
        enableFireflies();
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        String a = notetaker("https://meet.google.com/aaa-bbbb-ccc", memberToken()).get("id").asText();
        String b = notetaker(ZOOM_LINK, memberToken()).get("id").asText();
        ff.on("Recent", 200, listReply("none", "https://meet.google.com/zzz-yyyy-xxx", now(), false));
        due(a); due(b);
        runner.runOnce();
        assertThat(ff.callsTo("Recent")).isEqualTo(1L);
    }

    // ── importing a transcript Fireflies already has ─────────────────────────

    // ── access ───────────────────────────────────────────────────────────────

    @Test @DisplayName("viewers can't send or import; nobody can attach a notetaker to someone else's private meeting; other workspaces are separate")
    void accessControl() throws Exception {
        enableFireflies();
        String viewer = tokenForNewRole("viewer@example.com", "VIEWER");
        String other = tokenForNewRole("other.member@example.com", "MEMBER");
        ff.on("addToLiveMeeting", 200, "{\"data\":{\"addToLiveMeeting\":{\"success\":true}}}");
        assertThat(sendJson(post(BASE + "/fireflies/notetaker"), viewer, obj("meetingUrl", MEET_LINK, "consent", true)).getResponse().getStatus()).isEqualTo(403);
        assertThat(send(get(BASE + "/fireflies/recent"), viewer).getResponse().getStatus()).isEqualTo(403);
        String mine = createSessionId(memberToken(), workspaceId, MEET);
        expect(sendJson(post(BASE + "/fireflies/notetaker"), other, obj("sessionId", mine, "consent", true)), 404, null);
        assertThat(mvc.perform(as(get(BASE + "/capabilities"), otherOwnerToken(), otherWorkspaceId)).andReturn().getResponse().getContentAsString()).contains("\"fireflies\"");
        assertThat(json(mvc.perform(as(get(BASE + "/capabilities"), otherOwnerToken(), otherWorkspaceId)).andReturn()).get("fireflies").get("enabled").asBoolean()).isFalse();   // another workspace never inherits this one's setup
        assertThat(ff.callsTo("addToLiveMeeting")).isZero();
    }
}
