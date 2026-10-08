package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.prowosma.backend.integration.GoogleHttp;
import com.prowosma.backend.model.MeetingJob;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.MeetingUserConnection;
import com.prowosma.backend.service.GoogleTranscriptFetchHandler;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Google Meet connect + import, driven by a SCRIPTED stand-in for Google (the nested {@link ScriptedGoogle} below).
 * These tests prove OUR logic; they do not prove that Google's real responses look like the scripted ones —
 * that needs a real, authorized test meeting.
 *
 * Self-contained: the only test-support class it needs is MeetingAssistantTestBase (same package).
 */
@TestPropertySource(properties = {
        "security.field-encryption-key=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        "app.meeting-assistant.google.client-id=test-client-id",
        "app.meeting-assistant.google.client-secret=test-client-secret",
        "app.meeting-assistant.jobs-enabled=false"})
@DisplayName("Google Meet — connect, import, recover (scripted Google)")
class GoogleMeetImportTest extends MeetingAssistantTestBase {

    // ── the scripted Google ──────────────────────────────────────────────────

    /**
     * Replaces the real network transport. Every call is recorded; the first rule whose text appears in the URL answers it
     * (rules added later win, so a test can override an earlier default). Anything unscripted answers 404.
     */
    static class ScriptedGoogle implements GoogleHttp {

        record Call(String method, String url, Map<String, String> headers, String body) {}

        private record Rule(String urlContains, Result response) {}

        private final List<Call> calls = new CopyOnWriteArrayList<>();
        private final List<Rule> rules = new CopyOnWriteArrayList<>();

        void reset() {
            calls.clear();
            rules.clear();
        }

        ScriptedGoogle on(String urlContains, int status, String body) {
            rules.add(0, new Rule(urlContains, new Result(status, body)));
            return this;
        }

        List<Call> calls() {
            return calls;
        }

        long callsTo(String urlContains) {
            long n = 0;
            for (Call c : calls) {
                if (c.url().contains(urlContains)) n++;
            }
            return n;
        }

        @Override
        public Result send(String method, String url, Map<String, String> headers, String body) {
            calls.add(new Call(method, url, headers, body));
            for (Rule r : rules) {
                if (url.contains(r.urlContains())) return r.response();
            }
            return new Result(404, "{}");
        }
    }

    @TestConfiguration
    static class Cfg {
        @Bean
        @Primary
        ScriptedGoogle scriptedGoogle() {
            return new ScriptedGoogle();
        }
    }

    @Autowired private ScriptedGoogle fake;
    @Autowired private GoogleHttp injectedTransport;
    @Autowired private MeetingJobRunner runner;
    @Autowired private MeetingJobService jobs;

    private static final String TOKEN_OK_SCOPE = "openid email https://www.googleapis.com/auth/meetings.space.readonly";

    @BeforeEach
    void freshFake() {
        fake.reset();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Map<String, Object> obj(Object... keysAndValues) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < keysAndValues.length; i += 2) {
            m.put((String) keysAndValues[i], keysAndValues[i + 1]);
        }
        return m;
    }

    private String idToken(String email) {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(("{\"email\":\"" + email + "\"}").getBytes(StandardCharsets.UTF_8));
        return "h." + payload + ".s";
    }

    private String tokenResponse(String scope, boolean withRefresh, String email) throws Exception {
        Map<String, Object> m = obj("access_token", "ya29.access");
        if (withRefresh) m.put("refresh_token", "1//refresh");
        m.put("expires_in", 3600);
        m.put("scope", scope);
        m.put("id_token", idToken(email));
        return om.writeValueAsString(m);
    }

    private String stateFrom(String authorizeUrl) {
        Matcher m = Pattern.compile("[?&]state=([^&]+)").matcher(authorizeUrl);
        assertThat(m.find()).isTrue();
        return m.group(1);
    }

    private int statusOf(MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(as(request, token, workspaceId)).andReturn().getResponse().getStatus();
    }

    private MvcResult authorize(String token) throws Exception {
        return mvc.perform(as(post(BASE + "/google/authorize"), token, workspaceId)).andReturn();
    }

    private MvcResult connectWith(String token, String state, String code) throws Exception {
        return mvc.perform(as(post(BASE + "/google/connect"), token, workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(obj("code", code, "state", state)))).andReturn();
    }

    /** A full, valid connection for the person holding {@code token}. */
    private void connect(String token, String email) throws Exception {
        fake.on("oauth2.googleapis.com/token", 200, tokenResponse(TOKEN_OK_SCOPE, true, email));
        String state = stateFrom(json(authorize(token)).get("url").asText());
        assertThat(connectWith(token, state, "auth-code").getResponse().getStatus()).isEqualTo(200);
    }

    private void makeDue(String sessionId) {
        mongoTemplate.updateFirst(
                new Query(Criteria.where("jobKey").is(MeetingJobService.keyOf(GoogleTranscriptFetchHandler.TYPE, sessionId))),
                new Update().set("runAfter", Instant.now().minusSeconds(1)), MeetingJob.class);
    }

    private MeetingJob job(String sessionId) {
        return jobs.find(workspaceId, sessionId, GoogleTranscriptFetchHandler.TYPE).orElseThrow();
    }

    private String conferences(Instant start, Instant end) throws Exception {
        Map<String, Object> rec = obj("name", "conferenceRecords/c1", "startTime", start.toString());
        if (end != null) rec.put("endTime", end.toString());
        return om.writeValueAsString(obj("conferenceRecords", List.of(rec)));
    }

    /** Script a finished 60-minute meeting that ended 10 minutes ago, with a transcript starting {@code lateMin} minutes in. */
    private void scriptFinishedMeeting(int lateMin) throws Exception {
        Instant start = Instant.now().minus(70, ChronoUnit.MINUTES);
        Instant end = start.plus(60, ChronoUnit.MINUTES);

        fake.on("conferenceRecords?pageSize=100&filter", 200, conferences(start, end));

        Map<String, Object> transcript = obj(
                "name", "conferenceRecords/c1/transcripts/t1",
                "state", "FILE_GENERATED",
                "startTime", start.plus(lateMin, ChronoUnit.MINUTES).toString(),
                "endTime", end.toString());
        fake.on("/transcripts?pageSize=100", 200, om.writeValueAsString(obj("transcripts", List.of(transcript))));

        Map<String, Object> signedIn = obj("user", "users/1", "displayName", "Priya Nair");
        Map<String, Object> participant = obj("name", "conferenceRecords/c1/participants/p1", "signedinUser", signedIn);
        fake.on("/participants?pageSize=100", 200, om.writeValueAsString(obj("participants", List.of(participant))));

        Map<String, Object> first = obj(
                "participant", "conferenceRecords/c1/participants/p1",
                "text", "I will send the budget by Friday.",
                "languageCode", "en-US",
                "startTime", start.plus(lateMin + 1, ChronoUnit.MINUTES).toString(),
                "endTime", start.plus(lateMin + 2, ChronoUnit.MINUTES).toString());
        Map<String, Object> second = obj(
                "participant", "conferenceRecords/c1/participants/p9",          // not in the participant list → stays an unknown speaker
                "text", "Sounds good.",
                "languageCode", "en-US",
                "startTime", start.plus(lateMin + 3, ChronoUnit.MINUTES).toString(),
                "endTime", start.plus(lateMin + 4, ChronoUnit.MINUTES).toString());
        fake.on("/entries?pageSize=100", 200, om.writeValueAsString(obj("transcriptEntries", List.of(first, second))));
    }

    // ── connect flow ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("the test double really is the transport in use (so no test can reach Google by accident)")
    void fakeIsInjected() {
        assertThat(injectedTransport).isSameAs(fake);
    }

    @Test
    @DisplayName("connecting stores tokens ONLY encrypted, uses PKCE, and requests the minimum scopes")
    void connectStoresEncryptedTokens() throws Exception {
        String url = json(authorize(memberToken())).get("url").asText();
        assertThat(url).contains("code_challenge=").contains("code_challenge_method=S256")
                .contains("meetings.space.readonly").doesNotContain("drive").doesNotContain("test-client-secret");
        fake.on("oauth2.googleapis.com/token", 200, tokenResponse(TOKEN_OK_SCOPE, true, "organizer@corp.com"));
        MvcResult r = connectWith(memberToken(), stateFrom(url), "auth-code");
        assertThat(r.getResponse().getStatus()).isEqualTo(200);
        assertThat(json(r).get("connected").asBoolean()).isTrue();
        assertThat(json(r).get("account").asText()).isEqualTo("organizer@corp.com");

        MeetingUserConnection stored = mongoTemplate.findAll(MeetingUserConnection.class).get(0);
        assertThat(stored.getAccessTokenEnc()).startsWith("enc:v1:").doesNotContain("ya29");
        assertThat(stored.getRefreshTokenEnc()).startsWith("enc:v1:").doesNotContain("1//refresh");
        assertThat(stored.toString()).doesNotContain("enc:v1:");                       // tokens never leak through toString()

        String tokenRequest = null;
        for (ScriptedGoogle.Call call : fake.calls()) {
            if (call.url().contains("/token")) {
                tokenRequest = call.body();
                break;
            }
        }
        assertThat(tokenRequest).isNotNull();
        assertThat(tokenRequest).contains("code_verifier=").contains("grant_type=authorization_code");
    }

    @Test
    @DisplayName("a sign-in link is single-use and tied to the person who started it")
    void stateIsSingleUseAndBound() throws Exception {
        fake.on("oauth2.googleapis.com/token", 200, tokenResponse(TOKEN_OK_SCOPE, true, "a@corp.com"));
        String state = stateFrom(json(authorize(memberToken())).get("url").asText());
        // someone else tries to complete it
        MvcResult stolen = connectWith(adminToken(), state, "code");
        assertThat(stolen.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(stolen).get("error").asText()).isEqualTo("INVALID_STATE");
        // the failed attempt consumed it — even the owner of the link can't reuse it
        assertThat(connectWith(memberToken(), state, "code").getResponse().getStatus()).isEqualTo(400);
        assertThat(mongoTemplate.findAll(MeetingUserConnection.class)).isEmpty();
        // a made-up state is refused too
        assertThat(connectWith(memberToken(), "forged", "code").getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    @DisplayName("sign-in without the meeting scope, or without lasting access, stores nothing")
    void incompleteGrantsAreRefused() throws Exception {
        fake.on("oauth2.googleapis.com/token", 200, tokenResponse("openid email", true, "a@corp.com"));
        MvcResult noScope = connectWith(memberToken(), stateFrom(json(authorize(memberToken())).get("url").asText()), "c");
        assertThat(json(noScope).get("error").asText()).isEqualTo("MISSING_SCOPE");

        fake.on("oauth2.googleapis.com/token", 200, tokenResponse(TOKEN_OK_SCOPE, false, "a@corp.com"));
        MvcResult noRefresh = connectWith(memberToken(), stateFrom(json(authorize(memberToken())).get("url").asText()), "c");
        assertThat(json(noRefresh).get("error").asText()).isEqualTo("NO_REFRESH_TOKEN");

        assertThat(mongoTemplate.findAll(MeetingUserConnection.class)).isEmpty();
    }

    @Test
    @DisplayName("viewers cannot connect an account")
    void viewerCannotConnect() throws Exception {
        String viewer = tokenForNewRole("viewer@test.com", "VIEWER");
        assertThat(authorize(viewer).getResponse().getStatus()).isEqualTo(403);
    }

    @Test
    @DisplayName("disconnecting revokes at Google and deletes the stored tokens")
    void disconnectRevokesAndDeletes() throws Exception {
        connect(memberToken(), "a@corp.com");
        assertThat(statusOf(delete(BASE + "/google/connection"), memberToken())).isEqualTo(200);
        assertThat(fake.callsTo("oauth2.googleapis.com/revoke")).isEqualTo(1L);
        assertThat(mongoTemplate.findAll(MeetingUserConnection.class)).isEmpty();
    }

    @Test
    @DisplayName("Test connection makes a real read-only call and reports failure honestly")
    void testConnectionIsReal() throws Exception {
        connect(adminToken(), "admin@corp.com");
        fake.on("conferenceRecords?pageSize=1", 200, "{}");
        JsonNode ok = json(mvc.perform(as(post(ADMIN + "/platforms/GOOGLE_MEET/test"), adminToken(), workspaceId)).andReturn());
        assertThat(ok.get("healthy").asBoolean()).isTrue();
        assertThat(fake.callsTo("conferenceRecords?pageSize=1")).isEqualTo(1L);

        fake.on("conferenceRecords?pageSize=1", 401, "{}");
        JsonNode bad = json(mvc.perform(as(post(ADMIN + "/platforms/GOOGLE_MEET/test"), adminToken(), workspaceId)).andReturn());
        assertThat(bad.get("healthy").asBoolean()).isFalse();
        assertThat(bad.get("message").asText()).contains("rejected");
    }

    // ── import ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a finished meeting's transcript is imported with Google's speaker names; unknown participants stay unknown")
    void importHappyPath() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        assertThat(job(id).getStatus()).isEqualTo("QUEUED");
        scriptFinishedMeeting(1);
        makeDue(id);

        assertThat(runner.runOnce()).isEqualTo(1);

        MeetingSession s = session(id);
        assertThat(s.getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
        assertThat(s.getTranscriptSource()).isEqualTo("GOOGLE_MEET");
        assertThat(s.getCaptureStatus()).isEqualTo("FULL");
        assertThat(s.getConferenceRecord()).isEqualTo("conferenceRecords/c1");

        JsonNode segs = json(mvc.perform(as(get(BASE + "/sessions/" + id + "/transcript"), memberToken(), workspaceId)).andReturn()).get("segments");
        assertThat(segs.get(0).get("speaker").asText()).isEqualTo("Priya Nair");
        assertThat(segs.get(1).get("speaker").isNull()).isTrue();                  // p9 isn't in the participant list
        assertThat(job(id).getStatus()).isEqualTo("SUCCEEDED");

        boolean everyGoogleCallWasAuthorised = true;
        for (ScriptedGoogle.Call call : fake.calls()) {
            if (call.url().contains("conferenceRecords") && !"Bearer ya29.access".equals(call.headers().get("Authorization"))) {
                everyGoogleCallWasAuthorised = false;
            }
        }
        assertThat(everyGoogleCallWasAuthorised).isTrue();
    }

    @Test
    @DisplayName("running the job again does not duplicate lines")
    void repeatedRunsAreIdempotent() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        scriptFinishedMeeting(1);
        makeDue(id);
        runner.runOnce();
        long before = segmentCount(id);

        mongoTemplate.updateFirst(
                new Query(Criteria.where("jobKey").is(MeetingJobService.keyOf(GoogleTranscriptFetchHandler.TYPE, id))),
                new Update().set("status", "QUEUED").set("runAfter", Instant.now().minusSeconds(1)), MeetingJob.class);
        runner.runOnce();

        assertThat(segmentCount(id)).isEqualTo(before);
        assertThat(session(id).getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
    }

    @Test
    @DisplayName("a transcript that covers only part of the meeting is flagged as partial, with the reason")
    void partialCoverageIsFlagged() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        scriptFinishedMeeting(25);                                                // transcription began 25 min into a 60 min meeting
        makeDue(id);
        runner.runOnce();
        MeetingSession s = session(id);
        assertThat(s.getCaptureStatus()).isEqualTo("PARTIAL");
        assertThat(s.getTranscriptNote()).contains("%").contains("25 min");
        assertThat(s.getStatusDetail()).contains("incomplete");
    }

    @Test
    @DisplayName("while the meeting is still running the job just waits — it is not an error and the meeting is untouched")
    void meetingStillRunning() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        fake.on("conferenceRecords?pageSize=100&filter", 200, conferences(Instant.now().minus(20, ChronoUnit.MINUTES), null));
        makeDue(id);
        runner.runOnce();

        assertThat(session(id).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
        MeetingJob j = job(id);
        assertThat(j.getStatus()).isEqualTo("QUEUED");
        assertThat(j.getErrorStreak()).isEqualTo(0);
        assertThat(j.getRunAfter().isAfter(Instant.now())).isTrue();
    }

    @Test
    @DisplayName("no transcript after the grace period fails clearly, and an upload then rescues the meeting")
    void noTranscriptThenManualRescue() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        Instant start = Instant.now().minus(110, ChronoUnit.MINUTES);
        fake.on("conferenceRecords?pageSize=100&filter", 200, conferences(start, start.plus(60, ChronoUnit.MINUTES)));   // ended 50 min ago
        fake.on("/transcripts?pageSize=100", 200, "{}");
        makeDue(id);
        runner.runOnce();

        MeetingSession s = session(id);
        assertThat(s.getStatus()).isEqualTo("FAILED");
        assertThat(s.getFailureCode()).isEqualTo("NO_TRANSCRIPT");
        assertThat(s.getRecoveryAction()).containsIgnoringCase("upload");
        assertThat(s.getStatusDetail()).containsIgnoringCase("transcription");

        MvcResult upload = uploadTranscript(memberToken(), workspaceId, id, "Priya: hello\nTom: hi\nPriya: bye", "TEXT");
        assertThat(upload.getResponse().getStatus()).isEqualTo(200);
        assertThat(session(id).getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
    }

    @Test
    @DisplayName("Google rejecting the saved sign-in fails the meeting with a reconnect instruction")
    void rejectedSignIn() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        fake.on("conferenceRecords?pageSize=100&filter", 401, "{}");
        makeDue(id);
        runner.runOnce();

        MeetingSession s = session(id);
        assertThat(s.getStatus()).isEqualTo("FAILED");
        assertThat(s.getFailureCode()).isEqualTo("GOOGLE_REAUTH_REQUIRED");
        assertThat(s.getRecoveryAction()).containsIgnoringCase("reconnect");
    }

    @Test
    @DisplayName("access denied is explained and points to the organizer or a manual upload")
    void accessDenied() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        fake.on("conferenceRecords?pageSize=100&filter", 403, "{\"error\":\"secret details\"}");
        makeDue(id);
        runner.runOnce();

        MeetingSession s = session(id);
        assertThat(s.getFailureCode()).isEqualTo("GOOGLE_ACCESS_DENIED");
        assertThat(s.getStatusDetail()).doesNotContain("secret details");         // upstream bodies never reach users
    }

    @Test
    @DisplayName("repeated temporary errors are retried a bounded number of times, then fail with a message")
    void transientErrorsAreBounded() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        fake.on("conferenceRecords?pageSize=100&filter", 503, "{}");

        for (int i = 1; i < 8; i++) {
            makeDue(id);
            runner.runOnce();
            assertThat(session(id).getStatus()).as("still waiting after error " + i).isEqualTo("AWAITING_TRANSCRIPT");
            assertThat(job(id).getErrorStreak()).isEqualTo(i);
        }
        makeDue(id);
        runner.runOnce();
        assertThat(session(id).getStatus()).isEqualTo("FAILED");
        assertThat(session(id).getFailureCode()).isEqualTo("TEMPORARY_PROBLEM");
    }

    @Test
    @DisplayName("cancelling the meeting stops the job before it ever calls Google")
    void cancelStopsJob() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        assertThat(statusOf(post(BASE + "/sessions/" + id + "/cancel"), memberToken())).isEqualTo(200);
        assertThat(job(id).getStatus()).isEqualTo("CANCELLED");

        int callsBefore = fake.calls().size();
        makeDue(id);
        assertThat(runner.runOnce()).isEqualTo(0);
        assertThat(fake.calls().size()).isEqualTo(callsBefore);                   // no new call to Google
    }

    @Test
    @DisplayName("uploading a transcript by hand stops the automatic import")
    void uploadStopsJob() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        uploadTranscript(memberToken(), workspaceId, id, "by hand", "TEXT");
        assertThat(job(id).getStatus()).isEqualTo("CANCELLED");
    }

    @Test
    @DisplayName("a crashed worker's job is picked up again; a job whose lease is still valid is not")
    void leaseRecovery() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);
        Query q = new Query(Criteria.where("jobKey").is(MeetingJobService.keyOf(GoogleTranscriptFetchHandler.TYPE, id)));

        mongoTemplate.updateFirst(q, new Update().set("status", "RUNNING")
                .set("leaseUntil", Instant.now().plusSeconds(300))
                .set("runAfter", Instant.now().minusSeconds(60)), MeetingJob.class);
        assertThat(jobs.claimNext("worker-B")).isNull();                           // someone is legitimately running it

        mongoTemplate.updateFirst(q, new Update().set("leaseUntil", Instant.now().minusSeconds(5)), MeetingJob.class);   // the worker died
        MeetingJob reclaimed = jobs.claimNext("worker-B");
        assertThat(reclaimed).isNotNull();
        assertThat(reclaimed.getLockedBy()).isEqualTo("worker-B");
        assertThat(reclaimed.getAttempts()).isGreaterThanOrEqualTo(1);
        assertThat(jobs.claimNext("worker-C")).isNull();                           // and only one worker gets it
    }

    @Test
    @DisplayName("a recurring link's second occurrence never re-imports the first occurrence's record")
    void secondOccurrenceDoesNotReuseRecord() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String a = createSessionId(memberToken(), workspaceId, MEET);
        scriptFinishedMeeting(1);
        makeDue(a);
        runner.runOnce();

        MeetingSession done = session(a);
        done.setStatus("COMPLETED");
        done.setActiveKey(null);
        sessionRepository.save(done);

        String b = createSessionId(memberToken(), workspaceId, MEET);              // same link, a later occurrence
        makeDue(b);
        runner.runOnce();
        assertThat(session(b).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");     // the only record is already taken
        assertThat(segmentCount(b)).isEqualTo(0L);
    }

    @Test
    @DisplayName("without a connected Google account nothing is scheduled, and the user is told what to do")
    void noConnectionNoJob() throws Exception {
        MvcResult r = createSession(memberToken(), workspaceId, MEET);
        String id = json(r).get("id").asText();
        assertThat(json(r).get("statusDetail").asText()).contains("connect your Google account");
        assertThat(jobs.forSession(workspaceId, id)).isEmpty();

        MvcResult fetch = mvc.perform(as(post(BASE + "/sessions/" + id + "/fetch"), memberToken(), workspaceId)).andReturn();
        assertThat(fetch.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(fetch).get("error").asText()).isEqualTo("GOOGLE_NOT_CONNECTED");
    }

    @Test
    @DisplayName("Teams meetings have no automatic import unless Teams is set up, and say so")
    void teamsHasNoAutomaticImport() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        MvcResult r = createSession(memberToken(), workspaceId, TEAMS);
        String id = json(r).get("id").asText();
        assertThat(json(r).get("statusDetail").asText()).contains("Microsoft Teams isn't set up");
        assertThat(jobs.forSession(workspaceId, id)).isEmpty();
        assertThat(statusOf(post(BASE + "/sessions/" + id + "/fetch"), memberToken())).isEqualTo(409);
    }

    @Test
    @DisplayName("'Check now' brings a waiting meeting's job forward")
    void fetchNowRunsSoon() throws Exception {
        connect(memberToken(), "organizer@corp.com");
        String id = createSessionId(memberToken(), workspaceId, MEET);              // join-now: first check is ~2 minutes away
        assertThat(job(id).getRunAfter().isAfter(Instant.now().plusSeconds(60))).isTrue();

        assertThat(statusOf(post(BASE + "/sessions/" + id + "/fetch"), memberToken())).isEqualTo(200);
        assertThat(job(id).getRunAfter().isBefore(Instant.now().plusSeconds(5))).isTrue();
    }
}