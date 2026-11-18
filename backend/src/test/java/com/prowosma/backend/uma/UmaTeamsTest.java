package com.prowosma.backend.uma;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.GraphHttp;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import com.prowosma.backend.uma.ai.InsightPrompts;
import com.prowosma.backend.uma.app.UmaPipeline;
import com.prowosma.backend.uma.model.UmaMeeting;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * Microsoft Teams through the same experience as Google Meet. Microsoft's sign-in and Graph are a SCRIPTED stand-in (UmaGraphFake):
 * these tests prove our requests, rules and records - not a real Microsoft 365 tenant, which hasn't been available.
 */
@TestPropertySource(properties = {
        "app.uma.jobs-enabled=false",
        "app.uma.stt.base-url=http://stt.test",
        "app.uma.stt.model=fake-whisper",
        "app.meeting-assistant.jobs-enabled=false",
        "file.upload.dir=${java.io.tmpdir}/uma-test-uploads",
        "security.field-encryption-key=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "app.uma.google.client-id=test-client", "app.uma.google.client-secret=test-secret",
        "app.uma.microsoft.client-id=ms-client", "app.uma.microsoft.client-secret=ms-secret"})
@Import(UmaApiTest.Fakes.class)
class UmaTeamsTest extends TwoWorkspaceTestBase {
    static final String BASE = "/api/v2/meeting-assistant";

    @Autowired ObjectMapper om;
    @Autowired UmaPipeline pipeline;
    @Autowired UmaFakes.Ai ai;
    @Autowired GraphHttp graph;
    UmaGraphFake ms() { return (UmaGraphFake) graph; }
    String priya;

    @BeforeEach
    void reset() {
        for (String c : new String[]{"uma_meetings", "uma_segments", "uma_insights", "uma_jobs", "uma_audit", "workspace_configs", "uma_settings",
                "uma_user_prefs", "uma_microsoft_connections", "uma_oauth_states"})
            mongoTemplate.remove(new Query(), c);
        mongoTemplate.remove(new Query(Criteria.where("sourceActionKey").regex("^uma:")), Task.class);
        ms().reset();
        ai.reset();
        TeamMember t = new TeamMember();
        t.setOrganizationId(workspaceId); t.setEmail("priya@contoso.test"); t.setName("Priya Sharma"); t.setRole("MEMBER");
        priya = teamMemberRepository.save(t).getId();
    }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b) {
        return b.header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId);
    }

    JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    void enable() throws Exception {
        mvc.perform(as(post("/api/admin/features")).contentType(MediaType.APPLICATION_JSON).content("{\"key\":\"universalMeetingAssistant\",\"enabled\":true}")).andReturn();
    }

    void connect() throws Exception {
        JsonNode a = json(mvc.perform(as(post(BASE + "/connections/microsoft/authorize"))).andReturn());
        String url = a.get("url").asText();
        assertThat(url).startsWith("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?")
                .contains("code_challenge_method=S256").contains("OnlineMeetingTranscript.Read.All");
        String state = URLDecoder.decode(url.replaceAll(".*[?&]state=([^&]+).*", "$1"), StandardCharsets.UTF_8);
        MvcResult done = mvc.perform(as(post(BASE + "/connections/microsoft/complete")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"abc\",\"state\":\"" + state + "\"}")).andReturn();
        assertThat(done.getResponse().getStatus()).as(done.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(done).get("connected").asBoolean()).isTrue();
    }

    @Test
    void connect_thenScheduleATeamsMeeting_withInvitations_andThePersonsDefaultPlatform() throws Exception {
        enable();
        connect();
        assertThat(json(mvc.perform(as(get(BASE + "/connections/microsoft"))).andReturn()).get("account").asText()).isEqualTo("owner@contoso.test");
        // the stored token is encrypted, never plain
        String stored = mongoTemplate.getCollection("uma_microsoft_connections").find().first().getString("accessTokenEnc");
        assertThat(stored).isNotEqualTo("ms-tok");

        mvc.perform(as(put(BASE + "/settings/me")).contentType(MediaType.APPLICATION_JSON).content("{\"defaultPlatform\":\"MS_TEAMS\"}")).andReturn();
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/schedule")).contentType(MediaType.APPLICATION_JSON).content("""
                {"title":"Customer Portal Project Kickoff","start":"%s","durationMinutes":45,"timezone":"Asia/Kolkata",
                 "attendees":["Priya@Contoso.test","ravi@contoso.test"]}""".formatted(Instant.now().plus(Duration.ofDays(1))))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        JsonNode m = json(r);
        assertThat(m.get("provider").asText()).isEqualTo("MS_TEAMS");
        assertThat(m.get("meetingUrl").asText()).startsWith("https://teams.microsoft.com/l/meetup-join/");
        assertThat(m.get("attendees").toString()).contains("priya@contoso.test");

        UmaGraphFake.Req create = ms().requests.stream().filter(q -> q.url().endsWith("/me/events")).findFirst().orElseThrow();
        JsonNode body = om.readTree(create.body());
        assertThat(body.get("isOnlineMeeting").asBoolean()).isTrue();
        assertThat(body.get("onlineMeetingProvider").asText()).isEqualTo("teamsForBusiness");
        assertThat(body.at("/start/timeZone").asText()).isEqualTo("Asia/Kolkata");
        assertThat(body.at("/attendees/0/emailAddress/address").asText()).isEqualTo("priya@contoso.test");
        assertThat(mongoTemplate.count(new Query(Criteria.where("type").is(UmaPipeline.FETCH_TEAMS)), "uma_jobs")).isEqualTo(1);
    }

    @Test
    void afterTheMeeting_theTeamsTranscriptIsRead_namedSpeakers_andTheTaskIsAssigned() throws Exception {
        enable();
        connect();
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/instant")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"platform\":\"MS_TEAMS\",\"attendees\":[\"priya@contoso.test\"]}")).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        String id = json(r).get("id").asText();

        // the meeting is over (moved into the past), but Teams hasn't written the transcript yet: keep looking, don't fail
        UmaMeeting m = mongoTemplate.findById(id, UmaMeeting.class);
        m.setMeetingAt(Instant.now().minus(Duration.ofMinutes(50))); m.setMeetingEndAt(Instant.now().minus(Duration.ofMinutes(10)));
        mongoTemplate.save(m);
        mongoTemplate.getCollection("uma_jobs").updateMany(new org.bson.Document("meetingId", id), new org.bson.Document("$set", new org.bson.Document("runAfter", java.util.Date.from(Instant.now().minusSeconds(5)))));
        pipeline.drain();
        JsonNode waiting = json(mvc.perform(as(get(BASE + "/meetings/" + id))).andReturn());
        assertThat(waiting.at("/meeting/status").asText()).isEqualTo("CREATED");
        assertThat(waiting.at("/meeting/statusDetail").asText()).contains("waiting for Teams' transcript");
        assertThat(waiting.at("/capture/teamsWatching").asBoolean()).isTrue();

        // now it's there
        ms().transcripts = "[{\"id\":\"t1\",\"createdDateTime\":\"2026-11-18T10:40:00Z\",\"endDateTime\":\"2026-11-18T10:40:00Z\"}]";
        ms().vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Priya Sharma>I'll develop the React frontend by Thursday.</v>\n\n"
                + "00:00:05.000 --> 00:00:07.000\n<v Priya Sharma>And I'll share the designs today.</v>\n";
        ai.responder = call -> call.system().equals(InsightPrompts.EXTRACT_SYSTEM) ? """
                {"summary":"Priya takes the frontend.","notes":[],"decisions":[],"projects":[],"risks":[],"questions":[],"followUps":[],
                 "actions":[{"title":"Develop the React frontend","owner":"Priya Sharma","due":"by Thursday","priority":"HIGH","confidence":"HIGH","evidence":[1]}]}""" : "{}";
        mongoTemplate.getCollection("uma_jobs").updateMany(new org.bson.Document("meetingId", id), new org.bson.Document("$set", new org.bson.Document("runAfter", java.util.Date.from(Instant.now().minusSeconds(5)))));
        pipeline.drain();

        JsonNode d = json(mvc.perform(as(get(BASE + "/meetings/" + id))).andReturn());
        assertThat(d.at("/meeting/transcript/origin").asText()).isEqualTo("MS_TEAMS");
        assertThat(d.at("/segments/0/speaker").asText()).isEqualTo("Priya Sharma");
        List<Task> tasks = mongoTemplate.find(new Query(Criteria.where("sourceMeetingId").is(id)), Task.class);
        assertThat(tasks).hasSize(1);
        assertThat(tasks.get(0).getAssigneeIds()).containsExactly(priya);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("COMPLETED");
    }

    @Test
    void aMeetingNotOrganisedByTheConnectedAccountFailsWithAPlainReason() throws Exception {
        enable();
        connect();
        ms().meetingFound = false;
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/instant")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"platform\":\"MS_TEAMS\"}")).andReturn();
        String id = json(r).get("id").asText();
        mongoTemplate.getCollection("uma_jobs").updateMany(new org.bson.Document("meetingId", id), new org.bson.Document("$set", new org.bson.Document("runAfter", java.util.Date.from(Instant.now().minusSeconds(5)))));
        pipeline.drain();
        JsonNode d = json(mvc.perform(as(get(BASE + "/meetings/" + id))).andReturn());
        assertThat(d.at("/meeting/status").asText()).isEqualTo("FAILED");
        assertThat(d.at("/meeting/statusDetail").asText()).contains("couldn't find this meeting");
    }

    @Test
    void withoutAdminConsent_connectingSaysSoPlainly_andNothingIsStored() throws Exception {
        enable();
        JsonNode a = json(mvc.perform(as(post(BASE + "/connections/microsoft/authorize"))).andReturn());
        String state = URLDecoder.decode(a.get("url").asText().replaceAll(".*[?&]state=([^&]+).*", "$1"), StandardCharsets.UTF_8);
        ms().tokenError = "AADSTS65001: The user or administrator has not consented to use the application.";
        MvcResult done = mvc.perform(as(post(BASE + "/connections/microsoft/complete")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"abc\",\"state\":\"" + state + "\"}")).andReturn();
        assertThat(done.getResponse().getStatus()).isEqualTo(403);
        assertThat(json(done).get("code").asText()).isEqualTo("MICROSOFT_CONSENT_REQUIRED");
        assertThat(mongoTemplate.getCollection("uma_microsoft_connections").countDocuments()).isZero();
        // and a Google sign-in state can't be used to complete a Microsoft sign-in (or the other way round)
        MvcResult reused = mvc.perform(as(post(BASE + "/connections/microsoft/complete")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"abc\",\"state\":\"" + state + "\"}")).andReturn();
        assertThat(json(reused).get("code").asText()).isEqualTo("INVALID_STATE");
    }

    @Test
    void notConnected_schedulingATeamsMeetingAsksToConnect() throws Exception {
        enable();
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/instant")).contentType(MediaType.APPLICATION_JSON).content("{\"platform\":\"MS_TEAMS\"}")).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(r).get("code").asText()).isEqualTo("MICROSOFT_NOT_CONNECTED");
        assertThat(mongoTemplate.getCollection("uma_meetings").countDocuments()).isZero();
    }
}
