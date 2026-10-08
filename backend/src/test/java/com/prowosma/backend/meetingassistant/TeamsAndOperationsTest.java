package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.prowosma.backend.integration.GraphHttp;
import com.prowosma.backend.model.*;
import com.prowosma.backend.service.*;
import io.micrometer.core.instrument.MeterRegistry;
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
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * Microsoft Teams transcript import (against a SCRIPTED Microsoft — proves our logic, not Microsoft's real behavior) plus the operational
 * hardening: recovery, retention, health, metrics, and security checks (no secret in any response, all routes need authentication).
 */
@TestPropertySource(properties = {"app.meeting-assistant.teams.client-id=teams-client-id", "app.meeting-assistant.teams.client-secret=super-secret-teams-value"})
@DisplayName("Teams import and operational hardening")
class TeamsAndOperationsTest extends MeetingAssistantTestBase {

    @TestConfiguration
    static class Cfg {
        @Bean @Primary FakeGraphHttp fakeGraphHttp() { return new FakeGraphHttp(); }
    }

    private static final String OID = "8b081ef6-4792-4def-b2c9-c363a1bf41d5", TID = "11111111-2222-3333-4444-555555555555", OTHER_TID = "99999999-2222-3333-4444-555555555555";
    private static final String THREAD = "19:meeting_ZDk0ABC-_x@thread.v2";
    private static final String SECRET = "super-secret-teams-value", ACCESS = "FAKE_ACCESS_TOKEN";

    @Autowired private FakeGraphHttp ms;
    @Autowired private GraphHttp injected;
    @Autowired private MeetingJobRunner runner;
    @Autowired private MeetingJobService jobs;
    @Autowired private MeetingRecoveryService recovery;
    @Autowired private MeetingMetrics metrics;
    @Autowired private TeamsAuthService teamsAuth;
    @Autowired private MeterRegistry meters;

    @BeforeEach
    void setUp() {
        ms.reset();
        teamsAuth.forget(TID);                                                                       // tokens are cached in memory: start every test clean
        teamsAuth.forget(OTHER_TID);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static String jwt(String... roles) {
        String payload = "{\"roles\":[" + String.join(",", Arrays.stream(roles).map(r -> "\"" + r + "\"").toList()) + "]}";
        return "h." + Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".s";
    }

    private void tokenOk(String... roles) {
        ms.on("/oauth2/v2.0/token", 200, "{\"access_token\":\"" + jwt(roles) + "\",\"expires_in\":3600}");
    }

    private MvcResult send(MockHttpServletRequestBuilder b, String token, String body) throws Exception {
        return mvc.perform(as(b, token, workspaceId).contentType(MediaType.APPLICATION_JSON).content(body == null ? "{}" : body)).andReturn();
    }

    private JsonNode getJson(String token, String path) throws Exception {
        return json(mvc.perform(as(get(path), token, workspaceId)).andReturn());
    }

    /** An admin saves the tenant and runs a successful Test connection. */
    private void connectTeams() throws Exception {
        tokenOk(TeamsAuthService.TRANSCRIPT_ROLE);
        assertThat(send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), adminToken(), "{\"tenantId\":\"" + TID + "\"}").getResponse().getStatus()).isEqualTo(200);
        JsonNode t = json(send(post(ADMIN + "/platforms/MS_TEAMS/test"), adminToken(), null));
        assertThat(t.get("healthy").asBoolean()).as(t.toString()).isTrue();
    }

    private static String link(String oid, String tid) {
        String ctx = (tid == null ? "" : "%7b%22Tid%22%3a%22" + tid + "%22%2c") + "%22Oid%22%3a%22" + oid + "%22%7d";
        return "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDk0ABC-_x%40thread.v2/0?context=" + (tid == null ? "%7b" : "") + ctx;
    }

    private String meetingId(String thread) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(("1*" + OID + "*0**" + thread).getBytes(StandardCharsets.UTF_8));
    }

    private Map<String, Object> transcript(String id, String meeting, Instant created, Instant ended) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id); m.put("meetingId", meeting); m.put("createdDateTime", created.toString());
        if (ended != null) m.put("endDateTime", ended.toString());
        return m;
    }

    private void script(Map<String, Object>... transcripts) throws Exception {
        ms.on("getAllTranscripts", 200, om.writeValueAsString(Map.of("value", List.of(transcripts))));
    }

    private static final String VTT_A = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Priya Nair>I will send the budget.</v>\n\n00:00:05.000 --> 00:00:08.000\n<v Tom Becker>Sounds good.</v>\n";
    private static final String VTT_B = "WEBVTT\n\n00:00:02.000 --> 00:00:04.000\n<v Priya Nair>Back after the break.</v>\n\n00:00:05.000 --> 00:00:06.000\nUnlabelled line.\n";

    private String teamsSession(String url) throws Exception {
        MvcResult r = createSession(memberToken(), workspaceId, url);
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        return json(r).get("id").asText();
    }

    private MeetingJob job(String id) { return jobs.find(workspaceId, id, TeamsTranscriptFetchHandler.TYPE).orElseThrow(); }

    private void makeDue(String id) {
        mongoTemplate.updateFirst(new Query(Criteria.where("jobKey").is(MeetingJobService.keyOf(TeamsTranscriptFetchHandler.TYPE, id))),
                new Update().set("runAfter", Instant.now().minusSeconds(1)), MeetingJob.class);
    }

    // ── connection ───────────────────────────────────────────────────────────

    @Test @DisplayName("the transport in use is the scripted fake, so no test can reach Microsoft by accident")
    void fakeIsInjected() { assertThat(injected).isSameAs(ms); }

    @Test @DisplayName("an admin saves a tenant id and tests: healthy only with the transcript permission; each problem is explained; no secret is ever returned")
    void connectionAndHealthChecks() throws Exception {
        assertThat(send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), adminToken(), "{\"tenantId\":\"not-a-guid\"}").getResponse().getStatus()).isEqualTo(400);
        assertThat(send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), memberToken(), "{\"tenantId\":\"" + TID + "\"}").getResponse().getStatus()).isEqualTo(403);
        assertThat(send(get(ADMIN + "/platforms/MS_TEAMS/consent-url"), adminToken(), null).getResponse().getStatus()).isEqualTo(409);   // no tenant yet

        send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), adminToken(), "{\"tenantId\":\"" + TID.toUpperCase() + "\"}");
        JsonNode consent = json(send(get(ADMIN + "/platforms/MS_TEAMS/consent-url"), adminToken(), null));
        assertThat(consent.get("url").asText()).isEqualTo("https://login.microsoftonline.com/" + TID + "/adminconsent?client_id=teams-client-id");

        tokenOk();                                                                                    // signs in, but admin consent for the permission is missing
        JsonNode noRole = json(send(post(ADMIN + "/platforms/MS_TEAMS/test"), adminToken(), null));
        assertThat(noRole.get("healthy").asBoolean()).isFalse();
        assertThat(noRole.get("message").asText()).contains("admin consent").contains(TeamsAuthService.TRANSCRIPT_ROLE);

        ms.reset(); ms.on("/token", 400, "{\"error_description\":\"AADSTS7000215: Invalid client secret " + SECRET + "\"}");
        JsonNode badSecret = json(send(post(ADMIN + "/platforms/MS_TEAMS/test"), adminToken(), null));
        assertThat(badSecret.get("healthy").asBoolean()).isFalse();
        assertThat(badSecret.get("message").asText()).contains("client secret").doesNotContain(SECRET);

        ms.reset(); tokenOk(TeamsAuthService.TRANSCRIPT_ROLE);
        JsonNode ok = json(send(post(ADMIN + "/platforms/MS_TEAMS/test"), adminToken(), null));
        assertThat(ok.get("healthy").asBoolean()).isTrue();
        assertThat(ok.get("message").asText()).contains("access policy");                               // honest: only a real meeting confirms that part
        assertThat(ok.get("connectionStatus").asText()).isEqualTo("CONNECTED");

        JsonNode caps = getJson(memberToken(), BASE + "/capabilities");
        JsonNode teams = null;
        for (JsonNode p : caps.get("platforms")) if (p.get("provider").asText().equals("MS_TEAMS")) teams = p;
        assertThat(teams.get("automaticTranscript").asBoolean()).isTrue();
        assertThat(teams.get("liveJoin").asBoolean()).isFalse();

        send(delete(ADMIN + "/platforms/MS_TEAMS"), adminToken(), null);                              // disconnect clears everything
        JsonNode after = getJson(adminToken(), ADMIN + "/platforms");
        for (JsonNode p : after) if (p.get("provider").asText().equals("MS_TEAMS")) {
            assertThat(p.get("connectionStatus").asText()).isEqualTo("NOT_CONNECTED");
            assertThat(p.get("tenantId").isNull()).isTrue();
        }
    }

    // ── import ───────────────────────────────────────────────────────────────

    @Test @DisplayName("a finished Teams meeting's transcript is imported — matched by its Teams thread id, speakers as Teams named them, completeness labelled unverifiable")
    void importHappyPath() throws Exception {
        connectTeams();
        String id = teamsSession(link(OID, TID));
        MeetingSession s0 = session(id);
        assertThat(s0.getOrganizerId()).isEqualTo(OID);
        assertThat(job(id).getStatus()).isEqualTo("QUEUED");
        assertThat(s0.getStatusDetail()).contains("Microsoft Teams");

        Instant now = Instant.now();
        script(transcript("OTHER", meetingId("19:meeting_SOMETHINGELSE@thread.v2"), now.minus(50, ChronoUnit.MINUTES), now.minus(10, ChronoUnit.MINUTES)),
                transcript("T1", meetingId(THREAD), now.minus(50, ChronoUnit.MINUTES), now.minus(10, ChronoUnit.MINUTES)));
        ms.on("/transcripts/T1/content", 200, VTT_A);
        makeDue(id);
        assertThat(runner.runOnce()).isEqualTo(1);

        MeetingSession s = session(id);
        assertThat(s.getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
        assertThat(s.getTranscriptSource()).isEqualTo("MS_TEAMS");
        assertThat(s.getCaptureStatus()).isEqualTo("IMPORTED");
        assertThat(s.getTranscriptNote()).contains("can't be verified");
        assertThat(s.getConferenceRecord()).isEqualTo("T1");
        assertThat(s.getStatusDetail()).contains("may not cover the whole meeting");
        JsonNode segs = getJson(memberToken(), BASE + "/sessions/" + id + "/transcript").get("segments");
        assertThat(segs.get(0).get("speaker").asText()).isEqualTo("Priya Nair");
        assertThat(segs.get(0).get("startMs").asLong()).isEqualTo(1000);
        assertThat(segs.get(1).get("speaker").asText()).isEqualTo("Tom Becker");
        assertThat(job(id).getStatus()).isEqualTo("SUCCEEDED");
        assertThat(ms.callsTo("/transcripts/OTHER")).isZero();                                         // another meeting's transcript was never downloaded
        assertThat(ms.calls().stream().filter(c -> c.url().contains("graph.microsoft.com")).allMatch(c -> ("Bearer " + jwt(TeamsAuthService.TRANSCRIPT_ROLE)).equals(c.headers().get("Authorization")))).isTrue();
        assertThat(ms.calls().stream().filter(c -> c.url().contains("getAllTranscripts")).findFirst().orElseThrow().url()).contains("/users/" + OID + "/");
    }

    @Test @DisplayName("when transcription was stopped and restarted, the transcripts are joined in order with correct time offsets")
    void severalTranscriptsAreJoined() throws Exception {
        connectTeams();
        String id = teamsSession(link(OID, TID));
        Instant now = Instant.now();
        Instant first = now.minus(90, ChronoUnit.MINUTES);
        script(transcript("T2", meetingId(THREAD), first.plus(30, ChronoUnit.MINUTES), now.minus(5, ChronoUnit.MINUTES)),
                transcript("T1", meetingId(THREAD), first, first.plus(20, ChronoUnit.MINUTES)));       // listed out of order on purpose
        ms.on("/transcripts/T1/content", 200, VTT_A);
        ms.on("/transcripts/T2/content", 200, VTT_B);
        makeDue(id);
        runner.runOnce();
        MeetingSession s = session(id);
        assertThat(s.getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
        assertThat(s.getSegmentCount()).isEqualTo(4);
        assertThat(s.getTranscriptNote()).contains("2 transcripts joined");
        JsonNode segs = getJson(memberToken(), BASE + "/sessions/" + id + "/transcript").get("segments");
        assertThat(segs.get(2).get("text").asText()).isEqualTo("Back after the break.");
        assertThat(segs.get(2).get("startMs").asLong()).isEqualTo(30 * 60_000L + 2000);                 // offset by when the second transcript began
        assertThat(segs.get(3).get("speaker").isNull()).isTrue();                                       // unlabelled stays unknown
    }

    @Test @DisplayName("nothing yet, or transcription still running, is just waiting — not an error; the meeting is untouched")
    void waitsWithoutErrors() throws Exception {
        connectTeams();
        String id = teamsSession(link(OID, TID));
        script();
        makeDue(id);
        runner.runOnce();
        assertThat(session(id).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(job(id).getStatus()).isEqualTo("QUEUED");
        assertThat(job(id).getErrorStreak()).isZero();
        assertThat(job(id).getRunAfter()).isAfter(Instant.now());

        ms.reset(); tokenOk(TeamsAuthService.TRANSCRIPT_ROLE);
        script(transcript("T1", meetingId(THREAD), Instant.now().minus(2, ChronoUnit.MINUTES), null));   // started 2 minutes ago, not ended
        makeDue(id);
        runner.runOnce();
        assertThat(session(id).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(ms.callsTo("/content")).isZero();                                                    // it did not download a half-written transcript
    }

    @Test @DisplayName("each problem fails the meeting with a plain reason and a way forward")
    void failureModes() throws Exception {
        connectTeams();
        // 1) missing application access policy → 403
        ms.on("getAllTranscripts", 403, "{\"error\":{\"code\":\"Forbidden\",\"message\":\"secret detail\"}}");
        String denied = teamsSession(link(OID, TID));
        makeDue(denied); runner.runOnce();
        MeetingSession d = session(denied);
        assertThat(d.getFailureCode()).isEqualTo("TEAMS_ACCESS_DENIED");
        assertThat(d.getStatusDetail()).contains("application access policy").doesNotContain("secret detail");

        // 2) the tenant admin disabled Graph access to transcripts
        ms.on("getAllTranscripts", 403, "{\"error\":{\"code\":\"GraphAccessToTranscriptsDisabled\"}}");
        mongoTemplate.remove(new Query(), "meeting_sessions");
        String disabled = teamsSession(link(OID, TID));
        makeDue(disabled); runner.runOnce();
        assertThat(session(disabled).getFailureCode()).isEqualTo("TEAMS_TRANSCRIPTS_DISABLED");

        // 3) the app lost its admin consent
        teamsAuth.forget(TID);
        ms.reset(); ms.on("/token", 400, "{\"error_description\":\"AADSTS700016: app not found\"}");
        mongoTemplate.remove(new Query(), "meeting_sessions");
        String consent = teamsSession(link(OID, TID));
        makeDue(consent); runner.runOnce();
        assertThat(session(consent).getFailureCode()).isEqualTo("TEAMS_CONSENT_MISSING");
        assertThat(session(consent).getRecoveryAction()).contains("admin consent");

        // …and a person can still rescue it by uploading the transcript
        assertThat(uploadTranscript(memberToken(), workspaceId, consent, "Priya Nair: hello\nTom Becker: hi\nPriya Nair: bye", "TEXT").getResponse().getStatus()).isEqualTo(200);
        assertThat(session(consent).getStatus()).isEqualTo("TRANSCRIPT_RECEIVED");
    }

    @Test @DisplayName("a meeting from another Microsoft organization is never imported with ours — at registration, and if the connected tenant changes later")
    void tenantMismatch() throws Exception {
        connectTeams();
        MvcResult foreign = createSession(memberToken(), workspaceId, link(OID, OTHER_TID));
        assertThat(json(foreign).get("statusDetail").asText()).contains("different Microsoft organization");
        assertThat(jobs.forSession(workspaceId, json(foreign).get("id").asText())).isEmpty();            // nothing is scheduled
        mongoTemplate.remove(new Query(), "meeting_sessions");

        String id = teamsSession(link(OID, TID));                                                       // registered correctly…
        tokenOk(TeamsAuthService.TRANSCRIPT_ROLE);
        send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), adminToken(), "{\"tenantId\":\"" + OTHER_TID + "\"}");   // …then the connected tenant changes
        makeDue(id); runner.runOnce();
        assertThat(session(id).getFailureCode()).isEqualTo("TENANT_MISMATCH");
        assertThat(session(id).getRecoveryAction()).containsIgnoringCase("upload");
        assertThat(ms.callsTo("getAllTranscripts")).isZero();                                           // Graph was never asked
    }

    @Test @DisplayName("a transcript already imported for another meeting is never reused for this one")
    void claimedTranscriptIsNotReused() throws Exception {
        connectTeams();
        String a = teamsSession(link(OID, TID));
        Instant now = Instant.now();
        script(transcript("T1", meetingId(THREAD), now.minus(50, ChronoUnit.MINUTES), now.minus(10, ChronoUnit.MINUTES)));
        ms.on("/transcripts/T1/content", 200, VTT_A);
        makeDue(a); runner.runOnce();
        assertThat(session(a).getConferenceRecord()).isEqualTo("T1");
        MeetingSession done = session(a);
        done.setStatus("COMPLETED"); done.setActiveKey(null); sessionRepository.save(done);

        String b = teamsSession(link(OID, TID));                                                        // same link, a later occurrence
        makeDue(b); runner.runOnce();
        assertThat(session(b).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(segmentCount(b)).isZero();
    }

    @Test @DisplayName("when automatic import isn't possible nothing is scheduled, and the person is told what to do")
    void notAutomaticWhenNotPossible() throws Exception {
        // not connected at all
        MvcResult notConnected = createSession(memberToken(), workspaceId, link(OID, TID));
        String id0 = json(notConnected).get("id").asText();
        assertThat(json(notConnected).get("statusDetail").asText()).contains("Microsoft Teams isn't set up");
        assertThat(jobs.forSession(workspaceId, id0)).isEmpty();
        mongoTemplate.remove(new Query(), "meeting_sessions");

        connectTeams();
        // links that don't identify the organizer
        for (String url : List.of("https://teams.microsoft.com/meet/123456789012?p=SECRET", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDk0ABC-_x%40thread.v2/0")) {
            MvcResult r = createSession(memberToken(), workspaceId, url);
            String id = json(r).get("id").asText();
            assertThat(json(r).get("statusDetail").asText()).contains("link from the meeting invitation");
            assertThat(jobs.forSession(workspaceId, id)).isEmpty();
            MvcResult fetch = send(post(BASE + "/sessions/" + id + "/fetch"), memberToken(), null);
            assertThat(fetch.getResponse().getStatus()).isEqualTo(409);
            assertThat(json(fetch).get("error").asText()).isEqualTo("TEAMS_NOT_READY");
            send(post(BASE + "/sessions/" + id + "/cancel"), memberToken(), null);
        }
    }

    @Test @DisplayName("'Check now' looks at Microsoft immediately and says what it found")
    void fetchNowForTeams() throws Exception {
        connectTeams();
        String id = teamsSession(link(OID, TID));
        assertThat(job(id).getRunAfter()).isAfter(Instant.now().plusSeconds(60));              // registered: the first automatic look is minutes away
        script();                                                                                // Microsoft returns no transcripts yet
        MvcResult r = send(post(BASE + "/sessions/" + id + "/fetch"), memberToken(), null);
        assertThat(r.getResponse().getStatus()).isEqualTo(200);
        assertThat(ms.callsTo("getAllTranscripts")).isEqualTo(1);                               // it really asked Microsoft, right now
        JsonNode check = json(r).get("lastCheck");
        assertThat(check.get("code").asText()).isEqualTo("NO_TRANSCRIPT_YET");
        assertThat(check.get("message").asText()).contains("no transcript for this meeting yet").contains("started during the meeting");
        assertThat(session(id).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");                  // nothing was lost; it keeps waiting
        assertThat(job(id).getRunAfter()).isAfter(Instant.now().plusSeconds(240));             // and the next automatic look is scheduled
        assertThat(json(r).has("nextCheckAt")).isTrue();
    }

    @Test @DisplayName("meetingId matching decodes Teams ids with or without padding, and rejects garbage")
    void meetingIdMatching() {
        String padded = Base64.getEncoder().encodeToString(("1*" + OID + "*0**" + THREAD).getBytes(StandardCharsets.UTF_8));
        assertThat(TeamsTranscriptFetchHandler.meetingIdContains(padded, THREAD)).isTrue();
        assertThat(TeamsTranscriptFetchHandler.meetingIdContains(meetingId(THREAD), THREAD)).isTrue();
        assertThat(TeamsTranscriptFetchHandler.meetingIdContains(meetingId("19:meeting_other@thread.v2"), THREAD)).isFalse();
        assertThat(TeamsTranscriptFetchHandler.meetingIdContains("%%%not base64%%%", THREAD)).isFalse();
        assertThat(TeamsTranscriptFetchHandler.meetingIdContains(null, THREAD)).isFalse();
    }

    // ── recovery & retention ─────────────────────────────────────────────────

    private void age(String sessionId, int minutes) {
        mongoTemplate.updateFirst(new Query(Criteria.where("_id").is(sessionId)), new Update().set("updatedAt", Instant.now().minus(minutes, ChronoUnit.MINUTES)), MeetingSession.class);
    }

    @Test @DisplayName("a meeting stranded in PROCESSING with no live job is failed with a Retry; ones with a live job or a recent change are left alone; repeating is harmless")
    void recoverStrandedProcessing() throws Exception {
        String stranded = createSessionId(memberToken(), workspaceId, MEET);
        String withJob = createSessionId(memberToken(), workspaceId, "https://meet.google.com/aaa-bbbb-ccc");
        String fresh = createSessionId(memberToken(), workspaceId, "https://meet.google.com/ddd-eeee-fff");
        for (String id : List.of(stranded, withJob, fresh)) {
            MeetingSession s = session(id);
            s.setStatus("PROCESSING"); sessionRepository.save(s);
        }
        jobs.enqueue(workspaceId, withJob, MeetingOutputService.JOB_TYPE, memberEmail, Instant.now().plusSeconds(60), Instant.now().plusSeconds(3600), "r1", 6);
        age(stranded, 30); age(withJob, 30);                                                            // `fresh` keeps its recent timestamp

        assertThat(recovery.sweepStuck()).isEqualTo(1);
        MeetingSession s = session(stranded);
        assertThat(s.getStatus()).isEqualTo("FAILED");
        assertThat(s.getFailureCode()).isEqualTo("PROCESSING_STOPPED");
        assertThat(s.getRecoveryAction()).contains("Retry");
        assertThat(s.getActiveKey()).isNull();                                                          // freed, so it can be retried
        assertThat(session(withJob).getStatus()).isEqualTo("PROCESSING");
        assertThat(session(fresh).getStatus()).isEqualTo("PROCESSING");
        assertThat(recovery.sweepStuck()).isZero();
        assertThat(mongoTemplate.findAll(MeetingAuditEvent.class)).anyMatch(e -> "STATUS_CHANGED".equals(e.getAction()) && stranded.equals(e.getSessionId()));
    }

    @Test @DisplayName("an action extraction stranded as RUNNING is marked failed so it can be retried")
    void recoverStrandedExtraction() throws Exception {
        String id = createSessionId(memberToken(), workspaceId, MEET);
        mongoTemplate.updateFirst(new Query(Criteria.where("_id").is(id)), new Update().set("actionsStatus", "RUNNING"), MeetingSession.class);
        age(id, 30);
        assertThat(recovery.sweepStuck()).isEqualTo(1);
        assertThat(session(id).getActionsStatus()).isEqualTo("FAILED");
        assertThat(session(id).getActionsMessage()).contains("stopped unexpectedly");
        assertThat(recovery.sweepStuck()).isZero();
    }

    @Test @DisplayName("housekeeping removes old finished jobs and old audit events — and never pending or recent work")
    void housekeeping() {
        Instant old = Instant.now().minus(60, ChronoUnit.DAYS);
        MeetingJob oldDone = new MeetingJob(), oldQueued = new MeetingJob(), recentDone = new MeetingJob();
        for (var j : List.of(oldDone, oldQueued, recentDone)) { j.setOrganizationId(workspaceId); j.setSessionId("s"); j.setType("X"); }
        oldDone.setJobKey("k1"); oldDone.setStatus("SUCCEEDED"); oldDone.setUpdatedAt(old);
        oldQueued.setJobKey("k2"); oldQueued.setStatus("QUEUED"); oldQueued.setUpdatedAt(old);
        recentDone.setJobKey("k3"); recentDone.setStatus("FAILED"); recentDone.setUpdatedAt(Instant.now());
        mongoTemplate.insert(oldDone); mongoTemplate.insert(oldQueued); mongoTemplate.insert(recentDone);
        MeetingAuditEvent ancient = new MeetingAuditEvent(), recent = new MeetingAuditEvent();
        ancient.setOrganizationId(workspaceId); ancient.setAction("OLD"); ancient.setAt(Instant.now().minus(900, ChronoUnit.DAYS));
        recent.setOrganizationId(workspaceId); recent.setAction("NEW");
        mongoTemplate.insert(ancient); mongoTemplate.insert(recent);
        MeetingExtraction settled = new MeetingExtraction(), pending = new MeetingExtraction();
        for (var x : List.of(settled, pending)) { x.setOrganizationId(workspaceId); x.setSessionId("s"); x.setCreatedAt(Instant.now().minus(400, ChronoUnit.DAYS)); }
        settled.setStatus("APPLIED"); pending.setStatus("PENDING_REVIEW");
        mongoTemplate.insert(settled); mongoTemplate.insert(pending);

        assertThat(recovery.purgeOperational(org -> 365)).isEqualTo(3);                                  // old finished job + ancient audit event + settled extraction
        assertThat(mongoTemplate.findAll(MeetingJob.class).stream().map(MeetingJob::getJobKey)).containsExactlyInAnyOrder("k2", "k3");
        assertThat(mongoTemplate.findAll(MeetingAuditEvent.class).stream().map(MeetingAuditEvent::getAction)).doesNotContain("OLD").contains("NEW");
        assertThat(mongoTemplate.findAll(MeetingExtraction.class)).extracting(MeetingExtraction::getStatus).containsExactly("PENDING_REVIEW");
        assertThat(recovery.purgeOperational(org -> 365)).isZero();
    }

    // ── health & metrics ─────────────────────────────────────────────────────

    @Test @DisplayName("the admin health summary reports the queue, failures by reason and connections — for this organization only, and for admins only")
    void healthSummary() throws Exception {
        String failedId = createSessionId(memberToken(), workspaceId, MEET);
        MeetingSession f = session(failedId);
        f.setStatus("FAILED"); f.setFailureCode("NO_TRANSCRIPT"); f.setActiveKey(null); sessionRepository.save(f);
        jobs.enqueue(workspaceId, "x1", "FETCH_GOOGLE_TRANSCRIPT", memberEmail, Instant.now().minusSeconds(120), Instant.now().plusSeconds(3600));
        jobs.enqueue(workspaceId, "x2", "FETCH_GOOGLE_TRANSCRIPT", memberEmail, Instant.now().plusSeconds(3600), Instant.now().plusSeconds(7200));

        JsonNode h = getJson(adminToken(), ADMIN + "/health");
        assertThat(h.get("queue").get("queued").asInt()).isEqualTo(2);
        assertThat(h.get("queue").get("dueNow").asInt()).isEqualTo(1);
        assertThat(h.get("queue").get("oldestDueSeconds").asLong()).isGreaterThanOrEqualTo(100);
        assertThat(h.get("sessions").get("failedLast24h").asInt()).isEqualTo(1);
        assertThat(h.get("sessions").get("topFailureCodes").get(0).get("code").asText()).isEqualTo("NO_TRANSCRIPT");
        assertThat(h.get("integrations")).isNotNull();
        assertThat(h.get("lastTranscriptBySource").has("MS_TEAMS")).isTrue();
        assertThat(mvc.perform(as(get(ADMIN + "/health"), memberToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(403);

        JsonNode theirs = json(mvc.perform(as(get(ADMIN + "/health"), otherOwnerToken(), otherWorkspaceId)).andReturn());
        assertThat(theirs.get("queue").get("queued").asInt()).isZero();                                 // no cross-organization visibility
        assertThat(theirs.get("sessions").get("failedLast24h").asInt()).isZero();
    }

    @Test @DisplayName("jobs and tokens are counted in Prometheus metrics with only small fixed tags, and the queue gauges track the real queue")
    void metricsAreExportedSafely() throws Exception {
        String id = createSessionId(memberToken(), workspaceId, MEET);                                  // a Google meeting without a connection
        jobs.enqueue(workspaceId, id, GoogleTranscriptFetchHandler.TYPE, memberEmail, Instant.now().minusSeconds(5), Instant.now().plusSeconds(3600));
        double due = meters.get("prowosma.meeting.queue.due").gauge().value();
        assertThat(due).isEqualTo(1.0);
        assertThat(runner.runOnce()).isEqualTo(1);
        assertThat(meters.get("prowosma.meeting.jobs").tag("type", "FETCH_GOOGLE_TRANSCRIPT").tag("outcome", "fail").counter().count()).isGreaterThanOrEqualTo(1.0);
        assertThat(meters.get("prowosma.meeting.job.duration").tag("type", "FETCH_GOOGLE_TRANSCRIPT").timer().count()).isGreaterThanOrEqualTo(1);
        assertThat(meters.get("prowosma.meeting.queue.due").gauge().value()).isZero();

        double before = meters.counter("prowosma.meeting.llm.tokens", "kind", "OUTPUTS", "direction", "input").count();
        metrics.tokens("OUTPUTS", 120, 30);
        assertThat(meters.get("prowosma.meeting.llm.tokens").tag("kind", "OUTPUTS").tag("direction", "input").counter().count()).isEqualTo(before + 120);
        assertThat(meters.get("prowosma.meeting.sessions.created").counter().count()).isGreaterThanOrEqualTo(1.0);

        Set<String> allowed = Set.of("type", "outcome", "kind", "direction", "status", "provider", "source", "application", "region", "environment");
        meters.getMeters().stream().filter(m -> m.getId().getName().startsWith("prowosma.meeting")).forEach(m ->
                m.getId().getTags().forEach(t -> assertThat(allowed).as(m.getId().getName() + " tag " + t.getKey()).contains(t.getKey())));   // never an org, meeting or person id
    }

    // ── security ─────────────────────────────────────────────────────────────

    @Test @DisplayName("every Meeting Assistant route refuses unauthenticated requests")
    void allRoutesNeedAuthentication() throws Exception {
        List<MockHttpServletRequestBuilder> routes = List.of(
                get(BASE + "/capabilities"), post(BASE + "/validate-url"), get(BASE + "/sessions"), post(BASE + "/sessions"), get(BASE + "/sessions/x"),
                post(BASE + "/sessions/x/cancel"), post(BASE + "/sessions/x/retry"), put(BASE + "/sessions/x/access"), post(BASE + "/sessions/x/transcript"),
                get(BASE + "/sessions/x/transcript"), delete(BASE + "/sessions/x/transcript"), post(BASE + "/sessions/x/fetch"), post(BASE + "/sessions/x/generate"),
                get(BASE + "/sessions/x/artifacts"), put(BASE + "/sessions/x/artifacts/SUMMARY"), post(BASE + "/sessions/x/actions/extract"), get(BASE + "/sessions/x/actions"),
                patch(BASE + "/sessions/x/actions/y"), post(BASE + "/sessions/x/create"), post(BASE + "/google/authorize"), post(BASE + "/google/connect"),
                get(ADMIN + "/settings"), put(ADMIN + "/settings"), get(ADMIN + "/platforms"), put(ADMIN + "/platforms/MS_TEAMS/tenant"),
                get(ADMIN + "/platforms/MS_TEAMS/consent-url"), post(ADMIN + "/platforms/MS_TEAMS/test"), get(ADMIN + "/health"), get(ADMIN + "/usage"));
        for (MockHttpServletRequestBuilder r : routes) {
            int status = mvc.perform(r.contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn().getResponse().getStatus();
            assertThat(status).as(r.toString()).isIn(401, 403);
        }
    }

    @Test @DisplayName("no response from any endpoint ever contains a client secret, an access token or a credential field")
    void noSecretsInResponses() throws Exception {
        connectTeams();
        String id = teamsSession(link(OID, TID));
        List<String> bodies = new ArrayList<>();
        for (String path : List.of(ADMIN + "/platforms", ADMIN + "/settings", ADMIN + "/health", ADMIN + "/usage", ADMIN + "/platforms/MS_TEAMS/consent-url",
                BASE + "/capabilities", BASE + "/sessions", BASE + "/sessions/" + id))
            bodies.add(mvc.perform(as(get(path), adminToken(), workspaceId)).andReturn().getResponse().getContentAsString());
        bodies.add(send(post(ADMIN + "/platforms/MS_TEAMS/test"), adminToken(), null).getResponse().getContentAsString());
        bodies.add(send(put(ADMIN + "/platforms/MS_TEAMS/tenant"), adminToken(), "{\"tenantId\":\"" + TID + "\"}").getResponse().getContentAsString());
        for (String b : bodies) {
            assertThat(b).doesNotContain(SECRET).doesNotContain(ACCESS).doesNotContain(jwt(TeamsAuthService.TRANSCRIPT_ROLE));
            assertThat(b.toLowerCase()).doesNotContain("clientsecret").doesNotContain("client_secret").doesNotContain("accesstoken").doesNotContain("refreshtoken")
                    .doesNotContain("apikey").doesNotContain("password");
        }
    }
}
