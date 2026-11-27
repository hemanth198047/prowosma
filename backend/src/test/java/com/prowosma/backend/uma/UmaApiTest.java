package com.prowosma.backend.uma;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.integration.LlmException;
import com.prowosma.backend.integration.OpenAiCompatibleSttClient;
import com.prowosma.backend.integration.SttHttp;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import com.prowosma.backend.uma.ai.UmaAi;
import com.prowosma.backend.uma.app.UmaPipeline;
import com.prowosma.backend.uma.core.OperatorHttp;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * Universal Meeting Assistant, end to end through the HTTP API with an embedded database.
 * Speech-to-text and the language model are SCRIPTED stand-ins (UmaFakes): these tests prove our pipeline, evidence checks,
 * permissions and task creation — not the quality of a real engine.
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
class UmaApiTest extends TwoWorkspaceTestBase {

    static final String BASE = "/api/v2/meeting-assistant";

    @TestConfiguration
    static class Fakes {
        /** Not a bean: it is an SttHttp, and a second SttHttp bean would confuse the existing assistant's wiring. */
        static final UmaFakes.Stt STT = new UmaFakes.Stt();
        @Bean UmaFakes.Ai umaFakeAi() { return new UmaFakes.Ai(); }
        @Bean @Primary OperatorHttp umaOperatorHttp() {
            return new OperatorHttp() { @Override public SttHttp stt() { return STT; } };
        }
        @Bean @Primary UmaAi umaTestAi(UmaFakes.Ai ai) { return new UmaAi(List.of(ai)); }
        @Bean @Primary com.prowosma.backend.integration.FirefliesHttp umaFirefliesFake() { return new UmaFirefliesFake(); }
        @Bean @Primary com.prowosma.backend.integration.GoogleHttp umaGoogleFake() { return new UmaGoogleFake(); }
        @Bean @Primary com.prowosma.backend.uma.core.UmaGoogleHttp umaGoogleHttpFake() { return new UmaGoogleHttpFake(); }
        @Bean @Primary com.prowosma.backend.integration.GraphHttp umaGraphFake() { return new UmaGraphFake(); }
    }

    @Autowired ObjectMapper om;
    @Autowired UmaPipeline pipeline;
    @Autowired com.prowosma.backend.uma.app.UmaService umaService;
    final UmaFakes.Stt stt = Fakes.STT;
    @Autowired com.prowosma.backend.integration.FirefliesHttp firefliesHttp;
    UmaFirefliesFake ff() { return (UmaFirefliesFake) firefliesHttp; }
    @Autowired com.prowosma.backend.integration.GoogleHttp googleHttp;
    @Autowired com.prowosma.backend.service.FieldEncryptionService crypto;
    UmaGoogleFake gg() { return (UmaGoogleFake) googleHttp; }
    @Autowired com.prowosma.backend.uma.core.UmaGoogleHttp umaGoogleHttp;
    UmaGoogleHttpFake cal() { return (UmaGoogleHttpFake) umaGoogleHttp; }
    @Autowired UmaFakes.Ai ai;
    @MockitoBean com.prowosma.backend.service.EmailService mailServer;

    String raviId;

    @BeforeEach
    void reset() throws Exception {
        for (String c : new String[]{"uma_meetings", "uma_segments", "uma_insights", "uma_jobs", "uma_audit", "uma_questions", "workspace_configs", "uma_settings"})
            mongoTemplate.remove(new Query(), c);
        mongoTemplate.remove(new Query(Criteria.where("sourceActionKey").regex("^uma:")), Task.class);
        stt.reset();
        ff().reset();
        gg().reset();
        cal().reset();
        for (String col : new String[]{"uma_google_connections", "uma_oauth_states"}) mongoTemplate.remove(new Query(), col);
        mongoTemplate.remove(new Query(), com.prowosma.backend.model.MeetingUserConnection.class);
        ai.reset();
        TeamMember ravi = new TeamMember();
        ravi.setOrganizationId(workspaceId); ravi.setEmail("ravi@test.com"); ravi.setName("Ravi Kumar"); ravi.setRole("MEMBER");
        raviId = teamMemberRepository.save(ravi).getId();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token, String ws) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", ws);
    }

    JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    void enable(String token, String ws) throws Exception {
        MvcResult r = mvc.perform(as(post("/api/admin/features"), token, ws).contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"universalMeetingAssistant\",\"enabled\":true}")).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
    }

    MvcResult upload(String token, String ws, String fileName, byte[] bytes, boolean consent) throws Exception {
        return mvc.perform(as(post(BASE + "/meetings/recording"), token, ws)
                .param("fileName", fileName).param("title", "Weekly sync").param("consent", String.valueOf(consent))
                .param("meetingAt", "2026-11-16T09:00:00Z").param("timezone", "UTC")
                .contentType("audio/wav").content(bytes)).andReturn();
    }

    String uploadOk() throws Exception {
        MvcResult r = upload(ownerToken(), workspaceId, "weekly-sync.wav", OpenAiCompatibleSttClient.silentWav(), true);
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        JsonNode m = json(r);
        assertThat(m.get("status").asText()).isEqualTo("QUEUED");
        return m.get("id").asText();
    }

    JsonNode detail(String id) throws Exception {
        MvcResult r = mvc.perform(as(get(BASE + "/meetings/" + id), ownerToken(), workspaceId)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
        return json(r);
    }

    JsonNode action(JsonNode detail, String title) {
        for (JsonNode a : detail.at("/insights/actions")) if (a.get("title").asText().equals(title)) return a;
        throw new AssertionError("no action " + title + " in " + detail.at("/insights/actions"));
    }

    // ── feature flag ─────────────────────────────────────────────────────

    @Test
    void onByDefault_asTheOneMeetingsFeature() throws Exception {
        MvcResult s = mvc.perform(as(get(BASE + "/status"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(s).get("enabled").asBoolean()).isTrue();
        assertThat(mvc.perform(as(get(BASE + "/dashboard"), ownerToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void turnedOffByAnAdmin_everyEndpointSaysSoAndNothingIsStored() throws Exception {
        MvcResult off = mvc.perform(as(post("/api/admin/features"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"universalMeetingAssistant\",\"enabled\":false}")).andReturn();
        assertThat(off.getResponse().getStatus()).as(off.getResponse().getContentAsString()).isEqualTo(200);
        MvcResult s = mvc.perform(as(get(BASE + "/status"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(s).get("enabled").asBoolean()).isFalse();

        MvcResult d = mvc.perform(as(get(BASE + "/dashboard"), ownerToken(), workspaceId)).andReturn();
        assertThat(d.getResponse().getStatus()).isEqualTo(404);
        assertThat(json(d).get("code").asText()).isEqualTo("FEATURE_DISABLED");

        MvcResult u = upload(ownerToken(), workspaceId, "a.wav", OpenAiCompatibleSttClient.silentWav(), true);
        assertThat(u.getResponse().getStatus()).isEqualTo(404);
        assertThat(mongoTemplate.getCollection("uma_meetings").countDocuments()).isZero();
    }

    // ── the vertical slice ───────────────────────────────────────────────

    @Test
    void recordingToApprovedTask_withoutAnyMeetingProvider() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();

        assertThat(pipeline.drain()).isEqualTo(2);                // TRANSCRIBE, then ANALYZE
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.at("/meeting/statusDetail").asText()).startsWith("Meeting processed");
        assertThat(d.get("segments")).hasSize(6);
        assertThat(d.at("/segments/1/text").asText()).isEqualTo(UmaFakes.LINES.get(1));
        assertThat(d.at("/segments/1/speaker").isNull()).as("speaker is unknown, not guessed").isTrue();
        assertThat(stt.calls.get()).isEqualTo(1);

        JsonNode ins = d.get("insights");
        assertThat(ins.get("decisions")).hasSize(1);
        assertThat(ins.get("risks")).hasSize(1);
        assertThat(ins.get("questions")).hasSize(1);
        assertThat(ins.get("actions")).as("the item citing line 99 is dropped").hasSize(2);
        assertThat(ins.get("droppedForMissingEvidence").asInt()).isGreaterThanOrEqualTo(1);

        JsonNode api = action(d, "Complete the authentication API");
        assertThat(api.get("ownerSpoken").asText()).isEqualTo("Ravi");
        assertThat(api.get("ownerState").asText()).as("first name only is a suggestion, never an assignment").isEqualTo("SUGGESTED");
        assertThat(api.get("ownerMemberId").isNull()).isTrue();
        assertThat(api.get("dueDate").asText()).isEqualTo("2026-11-20");   // "by Friday" from Monday 16 Nov
        assertThat(api.get("evidence").get(0).asInt()).isEqualTo(2);

        JsonNode proc = action(d, "Follow up with procurement");
        assertThat(proc.get("ownerSpoken").isNull()).as("'Priya' is not in the cited line, so no owner is invented").isTrue();
        assertThat(proc.get("dueDate").isNull()).as("'next Monday' is not in the cited line").isTrue();

        // approve → a real task in the existing task module, exactly once
        String apiId = api.get("id").asText();
        MvcResult a1 = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + apiId + "/approve"), ownerToken(), workspaceId)).andReturn();
        assertThat(a1.getResponse().getStatus()).as(a1.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(a1).get("status").asText()).isEqualTo("CREATED");
        String taskId = json(a1).get("createdTaskId").asText();
        MvcResult a2 = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + apiId + "/approve"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(a2).get("createdTaskId").asText()).isEqualTo(taskId);
        List<Task> created = mongoTemplate.find(new Query(Criteria.where("sourceActionKey").is("uma:" + id + ":" + apiId)), Task.class);
        assertThat(created).hasSize(1);
        Task t = created.get(0);
        assertThat(t.getOrganizationId()).isEqualTo(workspaceId);
        assertThat(t.getTitle()).isEqualTo("Complete the authentication API");
        assertThat(t.getAssigneeIds() == null || t.getAssigneeIds().isEmpty()).as("not auto-assigned").isTrue();
        assertThat(t.getDueDate().toLocalDate().toString()).isEqualTo("2026-11-20");
        assertThat(t.getDescription()).contains("Owner named in the meeting: Ravi").contains("#2");

        // a person picks the owner, then approves
        String procId = proc.get("id").asText();
        MvcResult e = mvc.perform(as(patch(BASE + "/meetings/" + id + "/actions/" + procId), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"ownerMemberId\":\"" + raviId + "\",\"title\":\"Follow up with procurement on the CDN contract\"}")).andReturn();
        assertThat(e.getResponse().getStatus()).as(e.getResponse().getContentAsString()).isEqualTo(200);
        MvcResult bulk = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/approve"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"actionIds\":[\"" + procId + "\"]}")).andReturn();
        assertThat(json(bulk).get(0).get("status").asText()).isEqualTo("CREATED");
        Task t2 = mongoTemplate.findOne(new Query(Criteria.where("sourceActionKey").is("uma:" + id + ":" + procId)), Task.class);
        assertThat(t2.getAssigneeIds()).containsExactly(raviId);
        assertThat(t2.getTitle()).isEqualTo("Follow up with procurement on the CDN contract");

        assertThat(detail(id).at("/meeting/status").asText()).as("all actions decided").isEqualTo("COMPLETED");

        // exports
        MvcResult md = mvc.perform(as(get(BASE + "/meetings/" + id + "/export").param("format", "md"), ownerToken(), workspaceId)).andReturn();
        assertThat(md.getResponse().getContentAsString()).contains("# Weekly sync").contains("Complete the authentication API").contains("[#2]");
        assertThat(md.getResponse().getHeader("Content-Disposition")).contains("weekly-sync.md");
        MvcResult docx = mvc.perform(as(get(BASE + "/meetings/" + id + "/export").param("format", "docx"), ownerToken(), workspaceId)).andReturn();
        byte[] b = docx.getResponse().getContentAsByteArray();
        assertThat(b.length).isGreaterThan(1000);
        assertThat(new String(b, 0, 2)).isEqualTo("PK");
        MvcResult js = mvc.perform(as(get(BASE + "/meetings/" + id + "/export").param("format", "json"), ownerToken(), workspaceId)).andReturn();
        assertThat(om.readTree(js.getResponse().getContentAsByteArray()).get("transcript")).hasSize(6);

        // Ask AI: grounded answer with a line reference
        MvcResult q = mvc.perform(as(post(BASE + "/meetings/" + id + "/ask"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"question\":\"Who owns the authentication API?\"}")).andReturn();
        assertThat(q.getResponse().getStatus()).as(q.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(q).get("grounded").asBoolean()).isTrue();
        assertThat(json(q).get("evidence").get(0).asInt()).isEqualTo(2);

        // audit trail is content-free and complete
        MvcResult au = mvc.perform(as(get(BASE + "/meetings/" + id + "/audit"), ownerToken(), workspaceId)).andReturn();
        String trail = au.getResponse().getContentAsString();
        assertThat(trail).contains("RECORDING_UPLOADED", "TRANSCRIBED", "ACTION_APPROVED", "EXPORTED", "ASKED_AI");
        assertThat(trail).doesNotContain("authentication API by Friday");
    }

    @Test
    void askAi_saysSoWhenTheTranscriptDoesNotAnswer() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        pipeline.drain();
        ai.responder = c -> "{\"answer\": \"The budget is $40k.\", \"evidence\": [42], \"found\": true}";
        MvcResult q = mvc.perform(as(post(BASE + "/meetings/" + id + "/ask"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"question\":\"What is the budget?\"}")).andReturn();
        assertThat(json(q).get("grounded").asBoolean()).isFalse();
        assertThat(json(q).get("answer").asText()).doesNotContain("$40k");
    }

    @Test
    void importedTranscript_isAnalysedWithSpeakers() throws Exception {
        enable(ownerToken(), workspaceId);
        String text = "Alex: Let's review the launch.\nRavi: I will complete the authentication API by Friday.\nAlex: Great, thanks.\nRavi: No problem.";
        ai.responder = c -> c.system().equals(com.prowosma.backend.uma.ai.InsightPrompts.EXTRACT_SYSTEM)
                ? "{\"summary\":\"Launch review.\",\"actions\":[{\"title\":\"Complete the authentication API\",\"owner\":\"Ravi\",\"due\":\"by Friday\",\"evidence\":[2]}]}"
                : "{}";
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/transcript"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("text", text, "title", "Launch review")))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        String id = json(r).get("id").asText();
        assertThat(json(r).get("status").asText()).isEqualTo("ANALYZING");
        assertThat(pipeline.drain()).isEqualTo(1);
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.at("/segments/1/speaker").asText()).isEqualTo("Ravi");    // a label used at least twice is a speaker
        assertThat(stt.calls.get()).as("no transcription for an imported transcript").isZero();
        assertThat(action(d, "Complete the authentication API").get("ownerSpoken").asText()).isEqualTo("Ravi");
    }

    // ── failures and recovery ────────────────────────────────────────────

    @Test
    void sttFailure_isExplainedAndRetryResumes() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        stt.failStatus = 401;
        pipeline.drain();
        JsonNode m = detail(id).get("meeting");
        assertThat(m.get("status").asText()).isEqualTo("FAILED");
        assertThat(m.get("errorCode").asText()).isEqualTo("STT_AUTH");
        assertThat(m.get("failedStage").asText()).isEqualTo("TRANSCRIBING");
        assertThat(m.get("recoveryHint").asText()).isNotBlank();

        stt.failStatus = null;
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/" + id + "/retry"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(r).get("status").asText()).isEqualTo("QUEUED");
        pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
    }

    @Test
    void aiFailure_retryOnlyRedoesTheAnalysis() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        ai.failWith = new LlmException(LlmException.Kind.AUTH, "The AI key was rejected.");
        pipeline.drain();
        JsonNode m = detail(id).get("meeting");
        assertThat(m.get("status").asText()).isEqualTo("FAILED");
        assertThat(m.get("failedStage").asText()).isEqualTo("ANALYZING");
        assertThat(detail(id).get("segments")).as("transcript is kept").hasSize(6);

        ai.failWith = null;
        mvc.perform(as(post(BASE + "/meetings/" + id + "/retry"), ownerToken(), workspaceId)).andReturn();
        pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(stt.calls.get()).as("not transcribed twice").isEqualTo(1);
    }

    @Test
    void unparseableAiOutput_isRepairedOnceThenReported() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        ai.responder = c -> "Sure! Here are the notes you asked for.";
        pipeline.drain();
        JsonNode m = detail(id).get("meeting");
        assertThat(m.get("status").asText()).isEqualTo("FAILED");
        assertThat(m.get("errorCode").asText()).isEqualTo("AI_BAD_OUTPUT");
        assertThat(ai.calls).hasSize(2);
    }

    // ── browser capture ──────────────────────────────────────────────────

    String startCapture(String body) throws Exception {
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/capture"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        assertThat(json(r).get("status").asText()).isEqualTo("CAPTURING");
        return json(r).get("id").asText();
    }

    MvcResult piece(String id, String track, int seq, long startMs, byte[] audio) throws Exception {
        return mvc.perform(as(put(BASE + "/meetings/" + id + "/capture/" + track + "/" + seq), ownerToken(), workspaceId)
                .param("startMs", String.valueOf(startMs)).param("durationMs", "180000").contentType("audio/wav").content(audio)).andReturn();
    }

    @Test
    void browserRecording_piecesFromTabAndMicBecomeOneTranscriptWithSpeakers() throws Exception {
        enable(ownerToken(), workspaceId);
        assertThat(mvc.perform(as(post(BASE + "/meetings/capture"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Live sync\",\"consent\":false}")).andReturn().getResponse().getStatus()).isEqualTo(400);
        String id = startCapture("{\"title\":\"Live sync\",\"consent\":true}");
        byte[] wav = OpenAiCompatibleSttClient.silentWav();
        assertThat(json(piece(id, "TAB", 0, 0, wav)).get("stored").asBoolean()).isTrue();
        assertThat(json(piece(id, "TAB", 0, 0, wav)).get("duplicate").asBoolean()).as("a retried piece is ignored").isTrue();
        assertThat(json(piece(id, "MIC", 0, 600_000, wav)).get("stored").asBoolean()).isTrue();
        assertThat(piece(id, "TAB", 1, 180_000, "not audio at all, just text".getBytes()).getResponse().getStatus()).isEqualTo(415);
        assertThat(piece(id, "SCREEN", 2, 0, wav).getResponse().getStatus()).isEqualTo(400);

        MvcResult f = mvc.perform(as(post(BASE + "/meetings/" + id + "/capture/finish"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(f).get("status").asText()).isEqualTo("QUEUED");
        assertThat(piece(id, "TAB", 5, 900_000, wav).getResponse().getStatus()).as("no pieces after Stop").isEqualTo(409);

        pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(stt.calls.get()).as("one call per piece").isEqualTo(2);
        assertThat(d.get("segments")).hasSize(12);
        assertThat(d.at("/segments/0/speaker").asText()).isEqualTo("Other participants");
        assertThat(d.at("/segments/6/speaker").asText()).as("the microphone is the person recording").isEqualTo("Test Owner");
        assertThat(d.at("/segments/6/startMs").asLong()).isEqualTo(600_000L);
        assertThat(d.at("/meeting/transcript/speakersKnown").asBoolean()).isTrue();
    }

    @Test
    void browserRecording_stoppedWithNothingRecordedSaysSo() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = startCapture("{\"consent\":true}");
        MvcResult f = mvc.perform(as(post(BASE + "/meetings/" + id + "/capture/finish"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(f).get("status").asText()).isEqualTo("FAILED");
        assertThat(json(f).get("errorCode").asText()).isEqualTo("NO_AUDIO");
        assertThat(json(f).get("recoveryHint").asText()).contains("Share tab audio");
    }

    @Test
    void browserRecording_canBeAttachedToARegisteredMeetingLink() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Design review\"}")).andReturn();
        String id = json(link).get("id").asText();
        assertThat(startCapture("{\"meetingId\":\"" + id + "\",\"consent\":true}")).isEqualTo(id);
        mvc.perform(as(post(BASE + "/meetings/" + id + "/cancel"), ownerToken(), workspaceId)).andReturn();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("CANCELLED");
    }

    // ── Fireflies (scripted Fireflies API) ──────────────────────────────

    void connectFireflies() throws Exception {
        MvcResult r = mvc.perform(as(put(BASE + "/connections/fireflies"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"apiKey\":\"ff-good-key\"}")).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
    }

    @Test
    void fireflies_onlyAdminsConnect_keyIsCheckedAndNeverShown() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult member = mvc.perform(as(put(BASE + "/connections/fireflies"), memberToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"apiKey\":\"ff-good-key\"}")).andReturn();
        assertThat(member.getResponse().getStatus()).isEqualTo(403);
        MvcResult bad = mvc.perform(as(put(BASE + "/connections/fireflies"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"apiKey\":\"wrong\"}")).andReturn();
        assertThat(json(bad).get("code").asText()).isEqualTo("FIREFLIES_AUTH");
        connectFireflies();
        MvcResult st = mvc.perform(as(get(BASE + "/connections/fireflies"), memberToken(), workspaceId)).andReturn();
        assertThat(json(st).get("connected").asBoolean()).isTrue();
        assertThat(json(st).get("account").asText()).isEqualTo("Ops Team");
        assertThat(st.getResponse().getContentAsString()).doesNotContain("ff-good-key");
        String stored = mongoTemplate.getCollection("uma_settings").find().first().toJson();
        assertThat(stored).as("stored encrypted").doesNotContain("ff-good-key");
    }

    @Test
    void fireflies_importAMeetingOnce() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        MvcResult list = mvc.perform(as(get(BASE + "/fireflies/recent"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(list).get(0).get("title").asText()).isEqualTo("Weekly sync");
        assertThat(json(list).get(0).get("imported").asBoolean()).isFalse();
        ai.responder = c -> c.system().equals(com.prowosma.backend.uma.ai.InsightPrompts.EXTRACT_SYSTEM)
                ? "{\"summary\":\"Launch review.\",\"actions\":[{\"title\":\"Complete the authentication API\",\"owner\":\"Ravi Kumar\",\"due\":\"by Friday\",\"evidence\":[2]}]}" : "{}";
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/fireflies"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"transcriptId\":\"FFabc123\"}")).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        String id = json(r).get("id").asText();
        pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.at("/meeting/provider").asText()).isEqualTo("GOOGLE_MEET");
        assertThat(d.at("/segments/1/speaker").asText()).isEqualTo("Ravi Kumar");
        assertThat(action(d, "Complete the authentication API").get("ownerMemberId").asText()).as("full name of a member → matched").isEqualTo(raviId);
        MvcResult again = mvc.perform(as(post(BASE + "/meetings/fireflies"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"transcriptId\":\"FFabc123\"}")).andReturn();
        assertThat(again.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(mvc.perform(as(get(BASE + "/fireflies/recent"), ownerToken(), workspaceId)).andReturn()).get(0).get("imported").asBoolean()).isTrue();
    }

    @Test
    void fireflies_notetakerJoinsLiveAndTheTranscriptArrivesByItself() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Weekly sync\"}")).andReturn();
        String id = json(link).get("id").asText();
        ff().date = java.time.Instant.now().plusSeconds(60).toString();
        MvcResult sent = mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn();
        assertThat(sent.getResponse().getStatus()).as(sent.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(ff().requests.stream().anyMatch(b -> b.contains("addToLiveMeeting") && b.contains("meet.google.com/abc-defg-hij"))).isTrue();

        // still running in Fireflies → keeps waiting
        ff().live = true;
        dueNow();
        pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("CREATED");
        assertThat(detail(id).at("/meeting/statusDetail").asText()).contains("Fireflies is in the meeting");

        // finished → fetched, analysed
        ff().live = false;
        dueNow();
        pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.at("/meeting/transcript/origin").asText()).isEqualTo("FIREFLIES");
        assertThat(d.get("segments")).hasSize(3);
    }

    // ── Google Meet (scripted Google API) ───────────────────────────────

    void connectGoogle() {
        com.prowosma.backend.model.MeetingUserConnection c = new com.prowosma.backend.model.MeetingUserConnection();
        c.setOrganizationId(workspaceId); c.setUserEmail(ownerEmail); c.setProvider("GOOGLE_MEET"); c.setAccount("owner@acme.test");
        c.setAccessTokenEnc(crypto.encrypt("tok-123")); c.setAccessTokenExpiresAt(java.time.Instant.now().plusSeconds(3600));
        mongoTemplate.save(c);
    }

    @Test
    void googleMeet_transcriptIsReadAutomaticallyAfterTheMeeting() throws Exception {
        enable(ownerToken(), workspaceId);
        connectGoogle();
        MvcResult st = mvc.perform(as(get(BASE + "/connections/google"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(st).get("connected").asBoolean()).isTrue();
        assertThat(st.getResponse().getContentAsString()).doesNotContain("tok-123");

        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Launch review\"}")).andReturn();
        String id = json(link).get("id").asText();
        assertThat(json(link).get("statusDetail").asText()).contains("transcript is read when it ends");
        gg().start = java.time.Instant.now().plusSeconds(30);

        dueNow(); pipeline.drain();                      // still running
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("CREATED");
        assertThat(detail(id).get("statusLabel").asText()).isEqualTo("In progress");

        gg().end = gg().start.plusSeconds(600);
        dueNow(); pipeline.drain();                      // ended, transcript ready → imported and analysed
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.at("/meeting/transcript/origin").asText()).isEqualTo("GOOGLE_MEET");
        assertThat(d.get("segments")).hasSize(3);
        assertThat(d.at("/segments/1/speaker").asText()).isEqualTo("Ravi Kumar");
        assertThat(gg().urls.stream().anyMatch(u -> u.contains("abc-defg-hij"))).isTrue();
    }

    @Test
    void googleMeet_whenThePeopleLeaveButTheNotetakerStays_theMeetingIsOver() throws Exception {
        enable(ownerToken(), workspaceId);
        connectGoogle();
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Meet now\"}")).andReturn();
        String id = json(link).get("id").asText();
        java.time.Instant t0 = java.time.Instant.now().minusSeconds(1200);
        gg().start = t0;                                                     // Google: the call is still open (end = null)

        // still talking, with Fireflies in the call
        gg().participants = "[" + UmaGoogleFake.person("p1", "Java Developer", t0, null) + "," + UmaGoogleFake.bot("p2", "Fireflies.ai Notetaker Java", t0) + "]";
        dueNow(); pipeline.drain();
        assertThat(detail(id).get("statusLabel").asText()).isEqualTo("In progress");

        // the only person left 30 seconds ago: give them a moment to rejoin
        gg().participants = "[" + UmaGoogleFake.person("p1", "Java Developer", t0, java.time.Instant.now().minusSeconds(30)) + ","
                + UmaGoogleFake.bot("p2", "Fireflies.ai Notetaker Java", t0) + "]";
        dueNow(); pipeline.drain();
        assertThat(detail(id).get("statusLabel").asText()).isEqualTo("In progress");

        // they left 5 minutes ago; Fireflies is still connected -> the meeting is over
        java.time.Instant left = java.time.Instant.now().minusSeconds(300);
        gg().participants = "[" + UmaGoogleFake.person("p1", "Java Developer", t0, left) + "," + UmaGoogleFake.bot("p2", "Fireflies.ai Notetaker Java", t0) + "]";
        dueNow(); pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.get("statusLabel").asText()).isNotEqualTo("In progress");
        assertThat(d.at("/capture/phase").asText()).isEqualTo("ENDED");
        assertThat(java.time.Instant.parse(d.at("/meeting/endedAt").asText())).isEqualTo(left.truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
        assertThat(d.at("/meeting/statusDetail").asText()).contains("Everyone has left").contains("Fireflies.ai Notetaker Java");

        // someone comes back: in progress again
        gg().participants = "[" + UmaGoogleFake.person("p1", "Java Developer", t0, null) + "," + UmaGoogleFake.bot("p2", "Fireflies.ai Notetaker Java", t0) + "]";
        dueNow(); pipeline.drain();
        assertThat(detail(id).get("statusLabel").asText()).isEqualTo("In progress");

        // and once the call really closes, the transcript is read and summarised as usual
        gg().participants = null;
        gg().end = java.time.Instant.now().minusSeconds(60);
        dueNow(); pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isIn("REVIEW_READY", "COMPLETED");
    }

    @Test
    void googleMeet_needsAConnectedAccount() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\"}")).andReturn();
        String id = json(link).get("id").asText();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments()).as("nothing scheduled without a connection").isZero();
        MvcResult f = mvc.perform(as(post(BASE + "/meetings/" + id + "/google/fetch"), ownerToken(), workspaceId)).andReturn();
        assertThat(f.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(f).get("code").asText()).isEqualTo("GOOGLE_NOT_CONNECTED");
    }

    // ── own Google connection, scheduling and automation (scripted Google + Fireflies) ──

    /** Goes through the real sign-in flow against the scripted Google: authorize → callback with code and state → connected. */
    void signInGoogle() throws Exception {
        MvcResult a = mvc.perform(as(post(BASE + "/connections/google/authorize"), ownerToken(), workspaceId)).andReturn();
        assertThat(a.getResponse().getStatus()).as(a.getResponse().getContentAsString()).isEqualTo(200);
        String url = json(a).get("url").asText();
        assertThat(url).contains("calendar.events").contains("meetings.space.readonly").contains("code_challenge_method=S256")
                .contains(java.net.URLEncoder.encode("/ai-meeting-assistant/google-callback", java.nio.charset.StandardCharsets.UTF_8));
        String state = java.net.URLDecoder.decode(url.replaceAll(".*[?&]state=([^&]+).*", "$1"), java.nio.charset.StandardCharsets.UTF_8);
        MvcResult c = mvc.perform(as(post(BASE + "/connections/google/complete"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("code", "auth-code", "state", state)))).andReturn();
        assertThat(c.getResponse().getStatus()).as(c.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(c).get("connected").asBoolean()).isTrue();
        assertThat(json(c).get("calendar").asBoolean()).isTrue();
        assertThat(json(c).get("account").asText()).isEqualTo("owner@acme.test");
        MvcResult again = mvc.perform(as(post(BASE + "/connections/google/complete"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("code", "auth-code", "state", state)))).andReturn();
        assertThat(json(again).get("code").asText()).as("a sign-in link works once").isEqualTo("INVALID_STATE");
        assertThat(mongoTemplate.getCollection("uma_google_connections").find().first().toJson()).doesNotContain("tok-123").doesNotContain("ref-1");
    }

    @Test
    void scheduleAMeetMeeting_firefliesJoinsAtTheStart_andTheTranscriptArrivesByItself() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        connectFireflies();
        java.time.Instant start = java.time.Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.MINUTES);
        MvcResult bad = mvc.perform(as(post(BASE + "/meetings/schedule"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("title", "Launch review", "start", start.toString(), "attendees", List.of("not-an-email"))))).andReturn();
        assertThat(json(bad).get("code").asText()).isEqualTo("BAD_EMAIL");

        MvcResult r = mvc.perform(as(post(BASE + "/meetings/schedule"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("title", "Launch review", "start", start.toString(), "durationMinutes", 45,
                        "timezone", "Asia/Kolkata", "attendees", List.of("Priya@acme.test", "ravi@acme.test"), "autoFireflies", true)))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        JsonNode m = json(r);
        String id = m.get("id").asText();
        assertThat(m.get("meetingUrl").asText()).isEqualTo("https://meet.google.com/abc-defg-hij");
        assertThat(m.get("calendarEventId").asText()).isEqualTo("ev-new");
        assertThat(m.get("statusDetail").asText()).contains("Fireflies' notetaker will join when it starts").contains("Google Meet's transcript");
        UmaGoogleHttpFake.Req created = cal().requests.stream().filter(q -> "POST".equals(q.method()) && q.url().contains("/events")).findFirst().orElseThrow();
        assertThat(created.url()).contains("conferenceDataVersion=1").contains("sendUpdates=all");
        assertThat(created.body()).contains("hangoutsMeet").contains("priya@acme.test").contains("Asia/Kolkata");

        // nothing happens before the start time
        pipeline.drain();
        assertThat(ff().requests.stream().noneMatch(b -> b.contains("addToLiveMeeting"))).isTrue();

        // start time: Fireflies joins (the scripted Fireflies accepts), and its transcript is fetched after the meeting
        ff().date = java.time.Instant.now().toString();
        dueNow(); pipeline.drain();
        assertThat(ff().requests.stream().anyMatch(b -> b.contains("addToLiveMeeting") && b.contains("abc-defg-hij"))).isTrue();
        assertThat(detail(id).at("/meeting/fireflies/notetakerSentBy").asText()).isEqualTo("automatic");
        dueNow(); pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.get("segments")).hasSize(3);
    }

    @Test
    void instantMeeting_startsNow_invites_firefliesJoinsWhenTheFirstPersonIsIn_andTheSummaryArrives() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        connectFireflies();
        java.time.Instant before = java.time.Instant.now();
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/instant"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("attendees", List.of("priya@acme.test"), "timezone", "Asia/Kolkata", "autoFireflies", true)))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        JsonNode m = json(r);
        String id = m.get("id").asText();
        assertThat(m.get("title").asText()).startsWith("Instant meeting - ");
        assertThat(m.get("meetingUrl").asText()).startsWith("https://meet.google.com/");
        assertThat(java.time.Instant.parse(m.get("meetingAt").asText())).isBetween(before.minusSeconds(60), before.plusSeconds(60));
        assertThat(java.time.Instant.parse(m.get("meetingEndAt").asText())).isEqualTo(java.time.Instant.parse(m.get("meetingAt").asText()).plusSeconds(1800));
        assertThat(m.get("statusDetail").asText()).contains("Open the meeting now").contains("admit it");
        UmaGoogleHttpFake.Req created = cal().requests.stream().filter(q -> "POST".equals(q.method()) && q.url().contains("/events")).findFirst().orElseThrow();
        assertThat(created.url()).contains("sendUpdates=all");
        assertThat(created.body()).contains("priya@acme.test").contains("hangoutsMeet");

        org.bson.Document join = mongoTemplate.getCollection("uma_jobs").find(new org.bson.Document("type", "FIREFLIES_JOIN")).first();
        assertThat(join.getDate("runAfter").toInstant()).as("no fixed wait").isBefore(java.time.Instant.now().plusSeconds(1));

        // nobody has opened the meeting yet: Fireflies isn't sent into an empty call, and it looks again every few seconds
        gg().nobodyYet = true;
        dueNow(); pipeline.drain();
        assertThat(ff().requests.stream().noneMatch(b -> b.contains("addToLiveMeeting"))).as("not into an empty call").isTrue();
        assertThat(detail(id).at("/meeting/statusDetail").asText()).contains("as soon as the first person is in the meeting");
        org.bson.Document again = mongoTemplate.getCollection("uma_jobs").find(new org.bson.Document("type", "FIREFLIES_JOIN")).first();
        assertThat(again.getDate("runAfter").toInstant()).isBefore(java.time.Instant.now().plusSeconds(15));

        // the first person is in: it's sent right away
        gg().nobodyYet = false;
        ff().refuseJoins = 1;                                                // Fireflies still says no at the first try
        ff().date = java.time.Instant.now().toString();
        dueNow(); pipeline.drain();
        assertThat(ff().requests.stream().filter(b -> b.contains("addToLiveMeeting")).count()).as("one refused try").isEqualTo(1);
        assertThat(detail(id).at("/meeting/fireflies").isMissingNode() || detail(id).at("/meeting/fireflies").isNull()
                || detail(id).at("/meeting/fireflies/notetakerSentAt").isNull()).as("not marked as sent").isTrue();
        dueNow(); pipeline.drain();                                          // joined
        assertThat(detail(id).at("/meeting/fireflies/notetakerSentBy").asText()).isEqualTo("automatic");
        dueNow(); pipeline.drain();                                          // transcript fetched and summarised
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
    }

    @Test
    void instantMeeting_withoutFireflies_stillCreatesTheMeetAndWaitsForGoogle() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/instant"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("title", "Quick huddle", "durationMinutes", 15)))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        String id = json(r).get("id").asText();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("type", "FIREFLIES_JOIN"))).isZero();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("type", "FETCH_GOOGLE").append("status", "QUEUED"))).isEqualTo(1);
        assertThat(detail(id).get("statusLabel").asText()).isEqualTo("Waiting for transcript");
        MvcResult noGoogle = mvc.perform(as(post(BASE + "/meetings/instant"), memberToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{}")).andReturn();
        assertThat(json(noGoogle).get("code").asText()).isEqualTo("GOOGLE_NOT_CONNECTED");
    }

    @Test
    void calendarImport_addsUpcomingMeetMeetingsOnce_andFollowsChanges() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        connectFireflies();
        java.time.Instant t = java.time.Instant.now().plusSeconds(7200).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        cal().calendarItems = "[" + UmaGoogleHttpFake.event("ev1", "Design review", t, t.plusSeconds(1800), "https://meet.google.com/aaa-bbbb-ccc", "confirmed")
                + "," + UmaGoogleHttpFake.event("ev2", "Lunch", t, t.plusSeconds(3600), null, "confirmed") + "]";
        MvcResult p = mvc.perform(as(put(BASE + "/connections/google/preferences"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"autoImportCalendar\":true,\"autoFireflies\":true}")).andReturn();
        assertThat(json(p).get("autoImportCalendar").asBoolean()).isTrue();

        assertThat(json(mvc.perform(as(post(BASE + "/connections/google/sync"), ownerToken(), workspaceId)).andReturn()).get("added").asInt()).isEqualTo(1);
        assertThat(json(mvc.perform(as(post(BASE + "/connections/google/sync"), ownerToken(), workspaceId)).andReturn()).get("added").asInt()).as("only once").isZero();
        JsonNode dash = json(mvc.perform(as(get(BASE + "/dashboard"), ownerToken(), workspaceId)).andReturn());
        assertThat(dash.get("upcoming")).hasSize(1);
        String id = dash.at("/upcoming/0/id").asText();
        assertThat(detail(id).at("/meeting/autoFireflies").asBoolean()).isTrue();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("type", "FIREFLIES_JOIN").append("status", "QUEUED"))).isEqualTo(1);

        // moved by 30 minutes in Google Calendar → follows
        java.time.Instant later = t.plusSeconds(1800);
        cal().calendarItems = "[" + UmaGoogleHttpFake.event("ev1", "Design review", later, later.plusSeconds(1800), "https://meet.google.com/aaa-bbbb-ccc", "confirmed") + "]";
        mvc.perform(as(post(BASE + "/connections/google/sync"), ownerToken(), workspaceId)).andReturn();
        assertThat(detail(id).at("/meeting/meetingAt").asText()).isEqualTo(later.toString());

        // cancelled in Google Calendar → cancelled here, nothing will join
        cal().calendarItems = "[" + UmaGoogleHttpFake.event("ev1", "Design review", later, later.plusSeconds(1800), "https://meet.google.com/aaa-bbbb-ccc", "cancelled") + "]";
        mvc.perform(as(post(BASE + "/connections/google/sync"), ownerToken(), workspaceId)).andReturn();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("CANCELLED");
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("status", "QUEUED"))).isZero();
    }

    @Test
    void autoFireflies_waitsUntilTheMeetingHasReallyStarted() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        ff().refuseJoins = 2;
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://zoom.us/j/123456789", "meetingAt", java.time.Instant.now().toString(),
                        "autoFireflies", true)))).andReturn();
        String id = json(link).get("id").asText();
        dueNow(); pipeline.drain();
        assertThat(detail(id).at("/meeting/statusDetail").asText()).contains("Waiting for the meeting to start");
        dueNow(); pipeline.drain();
        dueNow(); pipeline.drain();
        assertThat(detail(id).at("/meeting/fireflies/notetakerSentBy").asText()).isEqualTo("automatic");
        assertThat(ff().requests.stream().filter(b -> b.contains("addToLiveMeeting")).count()).isEqualTo(3);
    }

    /** Reproduces a real test: a 30-minute meeting that ended after one minute must not sit untouched until its planned end. */
    @Test
    void meetingThatEndsEarly_isCheckedSoon_labelledHonestly_andCanBeCheckedNow() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        java.time.Instant start = java.time.Instant.now();
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://meet.google.com/abc-defg-hij", "title", "Weekly sync",
                        "meetingAt", start.toString(), "durationMinutes", 30, "autoFireflies", true)))).andReturn();
        String id = json(link).get("id").asText();
        ff().live = true;
        ff().date = start.toString();
        dueNow(); pipeline.drain();                                         // start time: Fireflies is sent
        org.bson.Document fetch = mongoTemplate.getCollection("uma_jobs").find(new org.bson.Document("type", "FETCH_FIREFLIES")).first();
        java.time.Instant firstLook = fetch.getDate("runAfter").toInstant();
        assertThat(firstLook).as("first look a few minutes after joining, not after the planned end")
                .isBefore(start.plus(java.time.Duration.ofMinutes(10)));

        JsonNode d = detail(id);
        assertThat(d.get("statusLabel").asText()).isEqualTo("Waiting for transcript");
        assertThat(d.at("/capture/pending").toString()).contains("FETCH_FIREFLIES");
        assertThat(json(mvc.perform(as(get(BASE + "/dashboard"), ownerToken(), workspaceId)).andReturn()).at("/inProgress/0/id").asText()).isEqualTo(id);

        // the meeting ended early: "Check now" fetches it straight away
        ff().live = false;
        MvcResult chk = mvc.perform(as(post(BASE + "/meetings/" + id + "/check"), ownerToken(), workspaceId)).andReturn();
        assertThat(chk.getResponse().getStatus()).as(chk.getResponse().getContentAsString()).isEqualTo(200);
        pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
    }

    /** The person ends the call in Google Meet: Prowosma notices within a minute and says what it is waiting for. */
    @Test
    void meetingEnd_isDetectedFromGoogleMeet_andEachStepIsLabelledPlainly() throws Exception {
        enable(ownerToken(), workspaceId);
        connectGoogle();
        java.time.Instant start = java.time.Instant.now().minusSeconds(300);
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://meet.google.com/abc-defg-hij", "meetingAt", start.toString(), "durationMinutes", 60)))).andReturn();
        String id = json(link).get("id").asText();
        org.bson.Document job = mongoTemplate.getCollection("uma_jobs").find(new org.bson.Document("type", "FETCH_GOOGLE")).first();
        assertThat(job.getDate("runAfter").toInstant()).as("Google is asked from the first minute").isBefore(java.time.Instant.now().plusSeconds(5));

        gg().start = start.plusSeconds(30); gg().end = null;                 // call running
        dueNow(); pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.get("statusLabel").asText()).isEqualTo("In progress");
        assertThat(d.at("/capture/phase").asText()).isEqualTo("IN_PROGRESS");
        assertThat(d.at("/capture/googleWatching").asBoolean()).isTrue();
        assertThat(java.time.Instant.parse(d.at("/capture/nextCheckAt").asText())).as("asks again in a minute")
                .isBefore(java.time.Instant.now().plusSeconds(75));

        gg().end = java.time.Instant.now(); gg().transcriptState = "STARTED"; // host ended the call; Google still writing
        dueNow(); pipeline.drain();
        d = detail(id);
        assertThat(d.get("statusLabel").asText()).isEqualTo("Getting transcript");
        assertThat(d.at("/capture/endedAt").asText()).isNotBlank();
        assertThat(d.at("/capture/liveSource").asText()).isEqualTo("Google Meet");

        gg().transcriptState = "FILE_GENERATED";
        dueNow(); pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
    }

    @Test
    void firefliesBeingInTheCall_marksTheMeetingInProgress_andLeavingMarksItEnded() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://zoom.us/j/123456789", "meetingAt", java.time.Instant.now().toString(), "autoFireflies", true)))).andReturn();
        String id = json(link).get("id").asText();
        ff().live = true; ff().date = java.time.Instant.now().toString(); ff().meetingLink = "https://zoom.us/j/123456789";
        dueNow(); pipeline.drain();                                          // Fireflies sent
        dueNow(); pipeline.drain();                                          // Fireflies: in the call
        JsonNode d = detail(id);
        assertThat(d.get("statusLabel").asText()).isEqualTo("In progress");
        assertThat(d.at("/capture/firefliesInMeeting").asBoolean()).isTrue();
        ff().live = false;                                                   // left; transcript ready right away in this script
        dueNow(); pipeline.drain();
        assertThat(detail(id).at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
    }

    private long notetakerRequests() { return ff().requests.stream().filter(b -> b.contains("addToLiveMeeting")).count(); }

    @Test
    void fireflies_manyPeopleClickingSendAtOnce_sendsTheNotetakerOnlyOnce() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        String id = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Weekly sync\"}")).andReturn()).get("id").asText();
        long before = notetakerRequests();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(8);
        java.util.List<java.util.concurrent.Future<Integer>> results = new java.util.ArrayList<>();
        for (int i = 0; i < 8; i++)
            results.add(pool.submit(() -> mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId))
                    .andReturn().getResponse().getStatus()));
        int ok = 0, conflict = 0;
        for (var f : results) { int st = f.get(); if (st == 200) ok++; else if (st == 409) conflict++; }
        pool.shutdown();
        assertThat(ok).as("exactly one request is allowed to send").isEqualTo(1);
        assertThat(conflict).as("the others are told it was already sent").isEqualTo(7);
        assertThat(notetakerRequests() - before).as("Fireflies was asked once").isEqualTo(1);
        MvcResult again = mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn();
        assertThat(again.getResponse().getStatus()).isEqualTo(409);
        assertThat(again.getResponse().getContentAsString()).contains("already sent");
        assertThat(notetakerRequests() - before).isEqualTo(1);
    }

    @Test
    void fireflies_pressingJoinInProwosma_sendsTheNotetakerByItself_once() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        String id = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://zoom.us/j/123456789\",\"title\":\"Weekly sync\",\"autoFireflies\":false}")).andReturn()).get("id").asText();
        long before = notetakerRequests();
        for (int i = 0; i < 3; i++)                                           // Join pressed again and again, by different people
            assertThat(mvc.perform(as(post(BASE + "/meetings/" + id + "/started"), ownerToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(200);
        dueNow();
        pipeline.drain();
        assertThat(notetakerRequests() - before).as("sent automatically, exactly once").isEqualTo(1);
        assertThat(detail(id).at("/meeting/fireflies/notetakerSentBy").asText()).isEqualTo("automatic");
    }

    @Test
    void fireflies_switchedOffOnPurpose_isNotSwitchedBackOnByJoining() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        String id = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://zoom.us/j/123456789\",\"title\":\"Weekly sync\"}")).andReturn()).get("id").asText();
        mvc.perform(as(put(BASE + "/meetings/" + id + "/automation"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content("{\"autoFireflies\":false}")).andReturn();
        long before = notetakerRequests();
        mvc.perform(as(post(BASE + "/meetings/" + id + "/started"), ownerToken(), workspaceId)).andReturn();
        dueNow();
        pipeline.drain();
        assertThat(notetakerRequests() - before).isZero();
    }

    @Test
    void fireflies_twoEntriesForTheSameLink_shareOneSend() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        String body = "{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Weekly sync\"}";
        String a = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn()).get("id").asText();
        String b = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn()).get("id").asText();
        long before = notetakerRequests();
        assertThat(mvc.perform(as(post(BASE + "/meetings/" + a + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(as(post(BASE + "/meetings/" + b + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(409);
        assertThat(notetakerRequests() - before).isEqualTo(1);
    }

    @Test
    void fireflies_aFailedSend_doesNotBlockTheNextAttempt() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        String id = json(mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"title\":\"Weekly sync\"}")).andReturn()).get("id").asText();
        MvcResult first;
        ff().refuseJoins = 1;                                   // Fireflies refuses the first join
        first = mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn();
        assertThat(first.getResponse().getStatus()).isNotEqualTo(200);
        assertThat(mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void oneCaptureRouteGivingUp_doesNotFailTheMeetingWhileTheOtherIsOnItsWay() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        connectGoogle();                                                     // existing-assistant connection: transcripts only
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://meet.google.com/abc-defg-hij", "meetingAt", java.time.Instant.now().minusSeconds(4 * 3600).toString(),
                        "durationMinutes", 30)))).andReturn();
        String id = json(link).get("id").asText();
        mvc.perform(as(post(BASE + "/meetings/" + id + "/fireflies/notetaker"), ownerToken(), workspaceId)).andReturn();
        ff().live = true;                                                    // Fireflies still busy
        gg().start = java.time.Instant.now().minusSeconds(4 * 3600);        // Google: ended long ago, no transcript
        gg().end = gg().start.plusSeconds(600);
        gg().transcriptState = null;
        mongoTemplate.getCollection("uma_jobs").updateMany(new org.bson.Document("type", "FETCH_GOOGLE"),
                new org.bson.Document("$set", new org.bson.Document("runAfter", java.util.Date.from(java.time.Instant.now().minusSeconds(1)))));
        pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).as("Fireflies is still on its way").isEqualTo("CREATED");
        assertThat(d.at("/meeting/statusDetail").asText()).isNotBlank();
    }

    @Test
    void autoFireflies_canBeSwitchedOffForAMeeting() throws Exception {
        enable(ownerToken(), workspaceId);
        connectFireflies();
        MvcResult link = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("url", "https://zoom.us/j/123456789", "meetingAt", java.time.Instant.now().plusSeconds(3600).toString(),
                        "autoFireflies", true)))).andReturn();
        String id = json(link).get("id").asText();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("type", "FIREFLIES_JOIN").append("status", "QUEUED"))).isEqualTo(1);
        mvc.perform(as(put(BASE + "/meetings/" + id + "/automation"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"autoFireflies\":false}")).andReturn();
        assertThat(mongoTemplate.getCollection("uma_jobs").countDocuments(new org.bson.Document("type", "FIREFLIES_JOIN").append("status", "QUEUED"))).isZero();
        assertThat(detail(id).at("/meeting/autoFireflies").asBoolean()).isFalse();
    }

    @Test
    void scheduling_needsGoogleCalendar() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/schedule"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("title", "x", "start", java.time.Instant.now().plusSeconds(600).toString())))).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(r).get("code").asText()).isEqualTo("GOOGLE_NOT_CONNECTED");
    }

    // ── scheduling: our own invitation e-mails, resend, calendar listing, validation ──

    java.time.Instant inOneHour() { return java.time.Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.MINUTES); }

    MvcResult schedule(String token, Map<String, Object> body) throws Exception {
        return mvc.perform(as(post(BASE + "/meetings/schedule"), token, workspaceId).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body))).andReturn();
    }

    java.util.Set<String> mailedTo(int calls) {
        org.mockito.ArgumentCaptor<String> to = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(mailServer, org.mockito.Mockito.timeout(5000).times(calls)).sendHtmlEmail(to.capture(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
        return to.getAllValues().stream().map(String::toLowerCase).collect(java.util.stream.Collectors.toSet());
    }

    @Test
    void scheduling_alsoEmailsEveryGuestOurselves_exceptTheOrganizerAndGmailGuests_withTheTimeInTheOrganizersZone() throws Exception {
        org.mockito.Mockito.when(mailServer.sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
        enable(ownerToken(), workspaceId);
        signInGoogle();
        java.time.Instant start = inOneHour();
        MvcResult r = schedule(ownerToken(), Map.of("title", "Titan test", "start", start.toString(), "durationMinutes", 30, "timezone", "Asia/Kolkata",
                "attendees", List.of("a@wilmarcs.services", "B@wilmarcs.services", "c@wilmarcs.services", "someone@gmail.com", ownerEmail)));
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        assertThat(mailedTo(3)).containsExactlyInAnyOrder("a@wilmarcs.services", "b@wilmarcs.services", "c@wilmarcs.services");
        org.mockito.ArgumentCaptor<String> subject = org.mockito.ArgumentCaptor.forClass(String.class), html = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(mailServer, org.mockito.Mockito.atLeastOnce()).sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(), subject.capture(), html.capture());
        assertThat(subject.getValue()).contains("Titan test");
        assertThat(html.getValue()).contains("https://meet.google.com/abc-defg-hij").contains("IST");
        // and the calendar still got the whole list, so Google's own invitation goes out too
        assertThat(cal().requests.stream().filter(q -> "POST".equals(q.method()) && q.url().contains("/events")).findFirst().orElseThrow().body())
                .contains("a@wilmarcs.services").contains("someone@gmail.com");
    }

    @Test
    void scheduling_aMailServerFailure_doesNotLoseTheMeeting() throws Exception {
        org.mockito.Mockito.when(mailServer.sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenThrow(new RuntimeException("smtp down"));
        enable(ownerToken(), workspaceId);
        signInGoogle();
        MvcResult r = schedule(ownerToken(), Map.of("title", "Still saved", "start", inOneHour().toString(), "attendees", List.of("a@x.test")));
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        assertThat(mongoTemplate.getCollection("uma_meetings").countDocuments(new org.bson.Document("title", "Still saved"))).isEqualTo(1);
    }

    @Test
    void scheduling_rulesAreEnforced_andNothingIsCreatedWhenARuleFails() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        java.time.Instant ok = inOneHour();
        assertThat(json(schedule(ownerToken(), Map.of("title", "x", "start", ok.minusSeconds(7200).toString()))).get("code").asText()).isEqualTo("IN_THE_PAST");
        assertThat(json(schedule(ownerToken(), Map.of("title", "x", "start", ok.toString(), "durationMinutes", 1))).get("code").asText()).isEqualTo("BAD_DURATION");
        assertThat(json(schedule(ownerToken(), Map.of("title", "x", "start", ok.toString(), "durationMinutes", 721))).get("code").asText()).isEqualTo("BAD_DURATION");
        assertThat(json(schedule(ownerToken(), Map.of("title", "x", "start", ok.toString(), "attendees", List.of("a@x.test", "oops")))).get("code").asText()).isEqualTo("BAD_EMAIL");
        List<String> many = new java.util.ArrayList<>();
        for (int i = 0; i < 101; i++) many.add("p" + i + "@x.test");
        assertThat(json(schedule(ownerToken(), Map.of("title", "x", "start", ok.toString(), "attendees", many))).get("code").asText()).isEqualTo("TOO_MANY");
        assertThat(schedule(ownerToken(), Map.of("title", "x", "start", ok.toString(), "autoFireflies", true)).getResponse().getStatus()).as("Fireflies not connected").isEqualTo(409);
        MvcResult noTime = schedule(ownerToken(), Map.of("title", "x"));
        assertThat(noTime.getResponse().getStatus()).isEqualTo(400);
        assertThat(cal().requests.stream().noneMatch(q -> "POST".equals(q.method()) && q.url().contains("/events"))).as("Google was never asked").isTrue();
        assertThat(mongoTemplate.getCollection("uma_meetings").countDocuments()).isZero();
    }

    @Test
    void scheduling_aGuestListWithDuplicatesAndCapitals_isCleaned() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        MvcResult r = schedule(ownerToken(), Map.of("title", "Dupes", "start", inOneHour().toString(), "attendees", List.of("Ann@X.test", "ann@x.test", " ANN@x.test ", "")));
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        assertThat(json(r).get("attendees")).hasSize(1);
        assertThat(json(r).get("attendees").get(0).asText()).isEqualTo("ann@x.test");
    }

    @Test
    void resend_addsWhoeverIsMissingFromTheCalendarEvent_andEmailsTheRest_onceAMinute() throws Exception {
        org.mockito.Mockito.when(mailServer.sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
        enable(ownerToken(), workspaceId);
        signInGoogle();
        MvcResult r = schedule(ownerToken(), Map.of("title", "Resend me", "start", inOneHour().toString(), "attendees", List.of("a@acme.test", "b@acme.test", "g@gmail.com")));
        String id = json(r).get("id").asText();
        mailedTo(2);
        org.mockito.Mockito.clearInvocations(mailServer);
        cal().requests.clear();
        // Google's event only has the organizer: the three guests were "lost" on the way
        MvcResult res = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), ownerToken(), workspaceId)).andReturn();
        assertThat(res.getResponse().getStatus()).as(res.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode out = json(res);
        List<String> added = new java.util.ArrayList<>(); out.get("addedToCalendar").forEach(n -> added.add(n.asText()));
        List<String> emailed = new java.util.ArrayList<>(); out.get("emailed").forEach(n -> emailed.add(n.asText()));
        assertThat(added).containsExactlyInAnyOrder("a@acme.test", "b@acme.test", "g@gmail.com");
        assertThat(emailed).containsExactlyInAnyOrder("a@acme.test", "b@acme.test");          // the gmail guest gets Google's own invitation
        assertThat(out.get("failed")).isEmpty();
        assertThat(cal().requests.stream().anyMatch(q -> "PATCH".equals(q.method()) && q.url().contains("sendUpdates=all") && q.body().contains("g@gmail.com"))).isTrue();
        // straight away again
        MvcResult again = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), ownerToken(), workspaceId)).andReturn();
        assertThat(again.getResponse().getStatus()).isEqualTo(429);
        assertThat(json(again).get("code").asText()).isEqualTo("TOO_SOON");
    }

    @Test
    void resend_whenGoogleCantBeUpdated_theEmailsStillGoOut_andTheNoteSaysWhy() throws Exception {
        org.mockito.Mockito.when(mailServer.sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
        enable(ownerToken(), workspaceId);
        signInGoogle();
        String id = json(schedule(ownerToken(), Map.of("title", "Calendar down", "start", inOneHour().toString(), "attendees", List.of("a@acme.test", "g@gmail.com")))).get("id").asText();
        mailedTo(1);
        org.mockito.Mockito.clearInvocations(mailServer);
        cal().calendarStatus = 500;
        MvcResult res = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), ownerToken(), workspaceId)).andReturn();
        assertThat(res.getResponse().getStatus()).as(res.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode out = json(res);
        assertThat(out.get("addedToCalendar")).isEmpty();
        assertThat(out.get("calendarNote").asText()).isNotBlank();
        List<String> emailed = new java.util.ArrayList<>(); out.get("emailed").forEach(n -> emailed.add(n.asText()));
        assertThat(emailed).containsExactlyInAnyOrder("a@acme.test", "g@gmail.com");     // Google couldn't be updated, so nobody is skipped
    }

    @Test
    void resend_canBeNarrowedToSomePeople_andRefusesWhenThereIsNobody() throws Exception {
        org.mockito.Mockito.when(mailServer.sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
        enable(ownerToken(), workspaceId);
        signInGoogle();
        String id = json(schedule(ownerToken(), Map.of("title", "Narrow", "start", inOneHour().toString(), "attendees", List.of("a@acme.test", "b@acme.test")))).get("id").asText();
        mailedTo(2);
        org.mockito.Mockito.clearInvocations(mailServer);
        MvcResult res = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"emails\":[\"B@acme.test\"]}")).andReturn();
        assertThat(res.getResponse().getStatus()).isEqualTo(200);
        assertThat(json(res).get("emailed")).hasSize(1);
        assertThat(json(res).get("emailed").get(0).asText()).isEqualTo("b@acme.test");
        String solo = json(schedule(ownerToken(), Map.of("title", "Solo", "start", inOneHour().plusSeconds(7200).toString(), "attendees", List.of(ownerEmail)))).get("id").asText();
        MvcResult none = mvc.perform(as(post(BASE + "/meetings/" + solo + "/resend-invites"), ownerToken(), workspaceId)).andReturn();
        assertThat(none.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(none).get("code").asText()).isEqualTo("NO_ONE");
        MvcResult missing = mvc.perform(as(post(BASE + "/meetings/does-not-exist/resend-invites"), ownerToken(), workspaceId)).andReturn();
        assertThat(missing.getResponse().getStatus()).isIn(403, 404);
    }

    @Test
    void resend_isRefusedForOtherPeoplesMeetings_andOtherWorkspaces() throws Exception {
        enable(ownerToken(), workspaceId);
        signInGoogle();
        String id = json(schedule(ownerToken(), Map.of("title", "Mine", "start", inOneHour().toString(), "attendees", List.of("a@acme.test")))).get("id").asText();
        org.mockito.Mockito.clearInvocations(mailServer);
        MvcResult other = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), otherOwnerToken(), otherWorkspaceId)).andReturn();
        assertThat(other.getResponse().getStatus()).isIn(403, 404);
        MvcResult member = mvc.perform(as(post(BASE + "/meetings/" + id + "/resend-invites"), memberToken(), workspaceId)).andReturn();
        assertThat(member.getResponse().getStatus()).as(member.getResponse().getContentAsString()).isIn(403, 404);
        org.mockito.Mockito.verify(mailServer, org.mockito.Mockito.after(300).never()).sendHtmlEmail(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void googleCalendarListing_showsTheEvents_rejectsBadRanges_andNeedsAConnection() throws Exception {
        enable(ownerToken(), workspaceId);
        java.time.Instant from = java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MINUTES), to = from.plusSeconds(86400 * 7L);
        MvcResult notYet = mvc.perform(as(get(BASE + "/google-calendar/events").param("from", from.toString()).param("to", to.toString()), ownerToken(), workspaceId)).andReturn();
        assertThat(notYet.getResponse().getStatus()).isEqualTo(409);
        signInGoogle();
        cal().calendarItems = "[" + UmaGoogleHttpFake.event("e1", "Board sync", from.plusSeconds(3600), from.plusSeconds(5400), "https://meet.google.com/zzz-zzzz-zzz", "confirmed") + ","
                + UmaGoogleHttpFake.event("e2", "Cancelled one", from.plusSeconds(7200), from.plusSeconds(9000), null, "cancelled") + "]";
        MvcResult ok = mvc.perform(as(get(BASE + "/google-calendar/events").param("from", from.toString()).param("to", to.toString()), ownerToken(), workspaceId)).andReturn();
        assertThat(ok.getResponse().getStatus()).as(ok.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(ok)).hasSize(1);
        assertThat(json(ok).get(0).get("title").asText()).isEqualTo("Board sync");
        assertThat(json(ok).get(0).get("meetUrl").asText()).isEqualTo("https://meet.google.com/zzz-zzzz-zzz");
        for (String[] bad : new String[][]{{to.toString(), from.toString()}, {from.toString(), from.plusSeconds(86400L * 90).toString()}}) {
            MvcResult r = mvc.perform(as(get(BASE + "/google-calendar/events").param("from", bad[0]).param("to", bad[1]), ownerToken(), workspaceId)).andReturn();
            assertThat(r.getResponse().getStatus()).isEqualTo(400);
            assertThat(json(r).get("code").asText()).isEqualTo("BAD_RANGE");
        }
        cal().calendarStatus = 500;
        MvcResult down = mvc.perform(as(get(BASE + "/google-calendar/events").param("from", from.toString()).param("to", to.toString()), ownerToken(), workspaceId)).andReturn();
        assertThat(down.getResponse().getStatus()).as("Google failing is reported plainly").isBetween(400, 599);
        assertThat(down.getResponse().getContentAsString()).doesNotContain("tok-123");
    }


    void dueNow() {
        mongoTemplate.updateMulti(new Query(Criteria.where("status").is("QUEUED")),
                new org.springframework.data.mongodb.core.query.Update().set("runAfter", java.time.Instant.now().minusSeconds(1)), "uma_jobs");
    }

    // ── input rules ──────────────────────────────────────────────────────

    @Test
    void uploadRules() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult noConsent = upload(ownerToken(), workspaceId, "a.wav", OpenAiCompatibleSttClient.silentWav(), false);
        assertThat(noConsent.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(noConsent).get("code").asText()).isEqualTo("CONSENT_REQUIRED");

        MvcResult exe = upload(ownerToken(), workspaceId, "a.exe", new byte[]{1, 2, 3}, true);
        assertThat(exe.getResponse().getStatus()).isEqualTo(415);

        MvcResult empty = upload(ownerToken(), workspaceId, "a.mp3", new byte[0], true);
        assertThat(empty.getResponse().getStatus()).isEqualTo(400);

        assertThat(mongoTemplate.getCollection("uma_meetings").countDocuments()).as("nothing half-created").isZero();
    }

    @Test
    void damagedAudio_failsWithAPlainReason() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult r = upload(ownerToken(), workspaceId, "broken.mp3", "this is not audio at all".getBytes(), true);
        String id = json(r).get("id").asText();
        pipeline.drain();
        JsonNode m = detail(id).get("meeting");
        assertThat(m.get("status").asText()).isEqualTo("FAILED");
        // with ffmpeg installed the file is checked before sending; without it the engine rejects it
        assertThat(m.get("errorCode").asText()).isIn("UNREADABLE_AUDIO", "NO_SPEECH", "STT_BAD_INPUT");
    }

    @Test
    void meetingLink_detectsProviderHonestly() throws Exception {
        enable(ownerToken(), workspaceId);
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://us02web.zoom.us/j/123456789\"}")).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        assertThat(json(r).get("provider").asText()).isEqualTo("ZOOM");
        assertThat(json(r).get("status").asText()).isEqualTo("CREATED");

        MvcResult bad = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"javascript:alert(1)\"}")).andReturn();
        assertThat(bad.getResponse().getStatus()).isEqualTo(400);

        MvcResult p = mvc.perform(as(get(BASE + "/providers"), ownerToken(), workspaceId)).andReturn();
        String body = p.getResponse().getContentAsString();
        assertThat(body).contains("UNAVAILABLE").doesNotContain("\"liveJoin\",\"state\":\"VERIFIED\"");
    }

    // ── access ───────────────────────────────────────────────────────────

    @Test
    void otherWorkspaceCannotSeeOrTouchIt() throws Exception {
        enable(ownerToken(), workspaceId);
        enable(otherOwnerToken(), otherWorkspaceId);
        String id = uploadOk();
        MvcResult r = mvc.perform(as(get(BASE + "/meetings/" + id), otherOwnerToken(), otherWorkspaceId)).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(404);
        MvcResult del = mvc.perform(as(delete(BASE + "/meetings/" + id), otherOwnerToken(), otherWorkspaceId)).andReturn();
        assertThat(del.getResponse().getStatus()).isEqualTo(404);
        MvcResult dash = mvc.perform(as(get(BASE + "/dashboard"), otherOwnerToken(), otherWorkspaceId)).andReturn();
        assertThat(json(dash).get("recent")).isEmpty();
    }

    @Test
    void privateUntilShared_andOnlyTheAdderOrAnAdminCanApprove() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        pipeline.drain();

        MvcResult hidden = mvc.perform(as(get(BASE + "/meetings/" + id), memberToken(), workspaceId)).andReturn();
        assertThat(hidden.getResponse().getStatus()).as("private by default").isEqualTo(404);

        mvc.perform(as(put(BASE + "/meetings/" + id + "/sharing"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"visibility\":\"WORKSPACE\"}")).andReturn();
        MvcResult seen = mvc.perform(as(get(BASE + "/meetings/" + id), memberToken(), workspaceId)).andReturn();
        assertThat(seen.getResponse().getStatus()).isEqualTo(200);
        assertThat(json(seen).get("canManage").asBoolean()).isFalse();

        String actionId = json(seen).at("/insights/actions/0/id").asText();
        MvcResult approve = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + actionId + "/approve"), memberToken(), workspaceId)).andReturn();
        assertThat(approve.getResponse().getStatus()).isEqualTo(403);
        assertThat(mongoTemplate.count(new Query(Criteria.where("sourceActionKey").regex("^uma:")), Task.class)).isZero();
    }

    @Test
    void viewerCannotAddMeetings() throws Exception {
        enable(ownerToken(), workspaceId);
        User u = new User();
        u.setEmail("viewer@test.com"); u.setName("Viewer"); u.setPassword(passwordEncoder.encode("pass")); u.setRole("USER");
        userRepository.save(u);
        TeamMember m = new TeamMember();
        m.setOrganizationId(workspaceId); m.setEmail("viewer@test.com"); m.setName("Viewer"); m.setRole("VIEWER");
        teamMemberRepository.save(m);
        MvcResult r = upload(jwtUtil.generateToken("viewer@test.com"), workspaceId, "a.wav", OpenAiCompatibleSttClient.silentWav(), true);
        assertThat(r.getResponse().getStatus()).isIn(403);
    }

    @Test
    void deleteRemovesTranscriptAndInsightsButKeepsCreatedTasks() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = uploadOk();
        pipeline.drain();
        String actionId = detail(id).at("/insights/actions/0/id").asText();
        mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + actionId + "/approve"), ownerToken(), workspaceId)).andReturn();
        MvcResult del = mvc.perform(as(delete(BASE + "/meetings/" + id), ownerToken(), workspaceId)).andReturn();
        assertThat(del.getResponse().getStatus()).isEqualTo(204);
        assertThat(mongoTemplate.getCollection("uma_segments").countDocuments()).isZero();
        assertThat(mongoTemplate.getCollection("uma_insights").countDocuments()).isZero();
        assertThat(mongoTemplate.count(new Query(Criteria.where("sourceActionKey").regex("^uma:")), Task.class)).isEqualTo(1);
    }

    @Test
    void separatedSpeakersKeepNeutralLabels_andANameFromTheSpeechServerIsNeverTrusted() throws Exception {
        enable(ownerToken(), workspaceId);
        stt.body = "{\"language\":\"en\",\"segments\":["
                + "{\"start\":0,\"end\":3,\"text\":\"I will send the deck today.\",\"speaker\":\"Speaker 1\"},"
                + "{\"start\":3,\"end\":6,\"text\":\"Thanks, I will review it.\",\"speaker\":\"Ravi Kumar\"},"
                + "{\"start\":6,\"end\":9,\"text\":\"Great, see you Friday.\",\"speaker\":\"Speaker 2\"}]}";
        String id = uploadOk();
        pipeline.drain();
        JsonNode d = detail(id);
        assertThat(d.at("/segments/0/speaker").asText()).isEqualTo("Speaker 1");
        assertThat(d.at("/segments/1/speaker").isNull()).as("a name from the speech server is a guess: dropped").isTrue();
        assertThat(d.at("/segments/2/speaker").asText()).isEqualTo("Speaker 2");
    }

    // ── clearing old meetings ─────────────────────────────────────────────

    String importedMeeting(String token, String title, java.time.Instant at) throws Exception {
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/transcript"), token, workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("text", "Priya: We agreed the plan.\nRavi: Thanks.", "title", title, "meetingAt", at.toString())))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        return json(r).get("id").asText();
    }

    boolean exists(String id) { return mongoTemplate.exists(new Query(Criteria.where("_id").is(id)), "uma_meetings"); }

    @Test
    void meetingsOlderThan15DaysAreDeletedAutomatically_tasksStay_andAdminsCanChangeOrStopIt() throws Exception {
        enable(ownerToken(), workspaceId);
        java.time.Instant now = java.time.Instant.now();
        String old = importedMeeting(ownerToken(), "Old sync", now.minus(java.time.Duration.ofDays(20)));
        String recent = importedMeeting(ownerToken(), "Recent sync", now.minus(java.time.Duration.ofDays(5)));
        pipeline.drain();
        mongoTemplate.save(new Task() {{ setTitle("From the old meeting"); setOrganizationId(workspaceId); setSourceMeetingId(old); setSourceActionKey("uma:" + old + ":x"); }});
        MvcResult upcoming = mvc.perform(as(post(BASE + "/meetings/link"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://meet.google.com/abc-defg-hij\",\"meetingAt\":\"" + now.plus(java.time.Duration.ofDays(3)) + "\"}")).andReturn();
        String future = json(upcoming).get("id").asText();
        assertThat(json(mvc.perform(as(get(BASE + "/dashboard"), ownerToken(), workspaceId)).andReturn()).get("retentionDays").asInt()).isEqualTo(15);

        assertThat(umaService.purgeOldMeetings()).isEqualTo(1);
        assertThat(exists(old)).isFalse();
        assertThat(mongoTemplate.count(new Query(Criteria.where("meetingId").is(old)), "uma_segments")).isZero();
        assertThat(exists(recent)).isTrue();
        assertThat(exists(future)).isTrue();
        assertThat(mongoTemplate.count(new Query(Criteria.where("sourceMeetingId").is(old)), Task.class)).as("tasks stay").isEqualTo(1);

        // a member can't change it; an admin can - shorter, or 0 to keep everything
        MvcResult denied = mvc.perform(as(put(BASE + "/settings/automation"), memberToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"meetingRetentionDays\":1}")).andReturn();
        assertThat(denied.getResponse().getStatus()).isEqualTo(403);
        mvc.perform(as(put(BASE + "/settings/automation"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content("{\"meetingRetentionDays\":0}")).andReturn();
        String older = importedMeeting(ownerToken(), "Ancient", now.minus(java.time.Duration.ofDays(400)));
        pipeline.drain();
        assertThat(umaService.purgeOldMeetings()).isZero();
        assertThat(exists(older)).isTrue();
        MvcResult bad = mvc.perform(as(put(BASE + "/settings/automation"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON).content("{\"meetingRetentionDays\":-3}")).andReturn();
        assertThat(bad.getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void clearOldMeetings_countsThenDeletes_onlyWhatThePersonMayManage_neverUpcomingOrBusy() throws Exception {
        enable(ownerToken(), workspaceId);
        java.time.Instant now = java.time.Instant.now();
        String mine = importedMeeting(memberToken(), "Mine, last month", now.minus(java.time.Duration.ofDays(30)));
        String theirs = importedMeeting(ownerToken(), "Owner's, last month", now.minus(java.time.Duration.ofDays(30)));
        String today = importedMeeting(memberToken(), "Mine, today", now.minus(java.time.Duration.ofHours(2)));
        pipeline.drain();
        String busy = importedMeeting(memberToken(), "Mine, still being summarised", now.minus(java.time.Duration.ofDays(40)));   // not drained

        JsonNode preview = json(mvc.perform(as(get(BASE + "/meetings/cleanup").param("olderThanDays", "15"), memberToken(), workspaceId)).andReturn());
        assertThat(preview.get("count").asInt()).isEqualTo(1);
        assertThat(exists(mine)).as("a preview deletes nothing").isTrue();
        JsonNode done = json(mvc.perform(as(post(BASE + "/meetings/cleanup").param("olderThanDays", "15"), memberToken(), workspaceId)).andReturn());
        assertThat(done.get("deleted").asInt()).isEqualTo(1);
        assertThat(exists(mine)).isFalse();
        assertThat(exists(theirs)).as("someone else's meeting").isTrue();
        assertThat(exists(today)).isTrue();
        assertThat(exists(busy)).as("still being processed").isTrue();
        // 0 = everything that already happened
        assertThat(json(mvc.perform(as(post(BASE + "/meetings/cleanup").param("olderThanDays", "0"), memberToken(), workspaceId)).andReturn())
                .get("deleted").asInt()).isEqualTo(1);
        assertThat(exists(today)).isFalse();
    }

    @Test
    void deleteSeveralAtOnce_skipsWhatThePersonCantDelete() throws Exception {
        enable(ownerToken(), workspaceId);
        java.time.Instant now = java.time.Instant.now();
        String a = importedMeeting(memberToken(), "A", now), b = importedMeeting(memberToken(), "B", now), o = importedMeeting(ownerToken(), "Owner's", now);
        pipeline.drain();
        JsonNode r = json(mvc.perform(as(post(BASE + "/meetings/delete"), memberToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("ids", List.of(a, b, o, "nope"))))).andReturn());
        assertThat(r.get("deleted").asInt()).isEqualTo(2);
        assertThat(r.get("skipped").size()).isEqualTo(2);
        assertThat(exists(a) || exists(b)).isFalse();
        assertThat(exists(o)).isTrue();
        // another workspace can't touch it
        MvcResult other = mvc.perform(as(post(BASE + "/meetings/delete"), otherOwnerToken(), otherWorkspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("ids", List.of(o))))).andReturn();
        assertThat(exists(o)).isTrue();
        assertThat(other.getResponse().getStatus()).isIn(200, 404);
    }

    // ── merged from Meetings (notes) and the first Meeting Assistant ─────

    String notesMeeting(String projectId, String notes, String meetingAt, String title) throws Exception {
        ai.responder = c -> c.system().equals(com.prowosma.backend.uma.ai.InsightPrompts.EXTRACT_SYSTEM)
                ? "{\"summary\":\"Release planning.\","
                  + "\"decisions\":[{\"text\":\"Ship the beta on Monday\",\"decidedBy\":\"Alex\",\"evidence\":[5]}],"
                  + "\"risks\":[{\"text\":\"The payment provider may block the release\",\"kind\":\"BLOCKER\",\"evidence\":[6]}],"
                  + "\"actions\":[{\"title\":\"Write the release notes\",\"owner\":\"Ravi\",\"evidence\":[7]}]}"
                : "{}";
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("title", title); body.put("meetingType", "planning"); body.put("agenda", "Beta date\nRisks");
        body.put("notes", notes); body.put("attendees", List.of("ravi@test.com", " ", "ravi@test.com"));
        body.put("meetingAt", meetingAt);
        if (projectId != null) body.put("projectId", projectId);
        MvcResult r = mvc.perform(as(post(BASE + "/meetings/notes"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(body))).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
        JsonNode m = json(r);
        assertThat(m.get("meetingType").asText()).isEqualTo("PLANNING");
        assertThat(m.get("agenda").asText()).isEqualTo("Beta date\nRisks");
        assertThat(m.get("attendees")).hasSize(1);
        pipeline.drain();
        return m.get("id").asText();
    }

    String notesMeeting(String projectId) throws Exception {
        return notesMeeting(projectId, NOTES, "2026-11-16T09:00:00Z", "Release planning");
    }

    static final String NOTES = "We agreed to ship the beta on Monday.\nThe payment provider may block the release.\nRavi will write the release notes.";

    @Test
    void notesWrittenByHand_becomeAMeetingWithInsights() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = notesMeeting(null);
        JsonNode d = detail(id);
        assertThat(d.at("/meeting/status").asText()).isEqualTo("REVIEW_READY");
        assertThat(d.get("segments").toString()).contains("Agenda:").contains("ship the beta on Monday");
        assertThat(d.at("/insights/decisions/0/text").asText()).isEqualTo("Ship the beta on Monday");

        MvcResult empty = mvc.perform(as(post(BASE + "/meetings/notes"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Nothing\"}")).andReturn();
        assertThat(empty.getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void decisionsAndRisks_goToTheWorkspaceLogsOnce() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = notesMeeting(null);
        JsonNode d = detail(id);
        String decisionId = d.at("/insights/decisions/0/id").asText();
        String riskId = d.at("/insights/risks/0/id").asText();

        MvcResult r1 = mvc.perform(as(post(BASE + "/meetings/" + id + "/decisions/" + decisionId + "/log"), ownerToken(), workspaceId)).andReturn();
        assertThat(r1.getResponse().getStatus()).as(r1.getResponse().getContentAsString()).isEqualTo(200);
        MvcResult r2 = mvc.perform(as(post(BASE + "/meetings/" + id + "/decisions/" + decisionId + "/log"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(r2).get("id").asText()).as("logging twice returns the same entry").isEqualTo(json(r1).get("id").asText());
        assertThat(json(r1).get("sourceMeetingId").asText()).isEqualTo(id);
        assertThat(detail(id).at("/insights/decisions/0/loggedDecisionId").asText()).isEqualTo(json(r1).get("id").asText());

        // RAID is per project: without one the person is asked for it
        MvcResult noProject = mvc.perform(as(post(BASE + "/meetings/" + id + "/risks/" + riskId + "/raid"), ownerToken(), workspaceId)).andReturn();
        assertThat(noProject.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(noProject).get("code").asText()).isEqualTo("PROJECT_NEEDED");
        MvcResult raid = mvc.perform(as(post(BASE + "/meetings/" + id + "/risks/" + riskId + "/raid"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"projectId\":\"proj-1\",\"impact\":\"high\"}")).andReturn();
        assertThat(raid.getResponse().getStatus()).as(raid.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(raid).get("type").asText()).as("a blocker is an ISSUE in the RAID log").isEqualTo("ISSUE");
        assertThat(json(raid).get("impact").asText()).isEqualTo("HIGH");

        // a member who didn't add the meeting can't write to the logs from it
        MvcResult member = mvc.perform(as(post(BASE + "/meetings/" + id + "/decisions/" + decisionId + "/log"), memberToken(), workspaceId)).andReturn();
        assertThat(member.getResponse().getStatus()).isIn(403, 404);
    }

    @Test
    void summaryEdits_areVersionedSurviveRegenerationAndCanBeRestored() throws Exception {
        enable(ownerToken(), workspaceId);
        String id = notesMeeting(null);
        MvcResult e = mvc.perform(as(put(BASE + "/meetings/" + id + "/summary"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"summary\":\"Beta ships Monday; payments are the open risk.\"}")).andReturn();
        assertThat(e.getResponse().getStatus()).as(e.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(e).get("summaryEdited").asBoolean()).isTrue();
        assertThat(json(e).at("/summaryHistory/0/text").asText()).isEqualTo("Release planning.");

        mvc.perform(as(post(BASE + "/meetings/" + id + "/regenerate"), ownerToken(), workspaceId)).andReturn();
        pipeline.drain();
        JsonNode ins = detail(id).get("insights");
        assertThat(ins.get("summary").asText()).as("the person's summary is kept").isEqualTo("Beta ships Monday; payments are the open risk.");
        assertThat(ins.get("summaryHistory")).hasSize(2);

        MvcResult back = mvc.perform(as(post(BASE + "/meetings/" + id + "/summary/versions/1/restore"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(back).get("summary").asText()).isEqualTo("Release planning.");
        MvcResult blank = mvc.perform(as(put(BASE + "/meetings/" + id + "/summary"), ownerToken(), workspaceId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"summary\":\"   \"}")).andReturn();
        assertThat(blank.getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void actionItem_canBeLinkedToAnExistingTaskInsteadOfADuplicate() throws Exception {
        enable(ownerToken(), workspaceId);
        Task existing = new Task();
        existing.setOrganizationId(workspaceId); existing.setTitle("Write release notes for the beta"); existing.setStatus("TODO");
        existing.setSourceActionKey("uma:test-existing");
        existing = mongoTemplate.save(existing);
        String id = notesMeeting(null);
        String actionId = action(detail(id), "Write the release notes").get("id").asText();

        MvcResult sim = mvc.perform(as(get(BASE + "/meetings/" + id + "/actions/" + actionId + "/similar"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(sim).get(0).get("id").asText()).isEqualTo(existing.getId());

        MvcResult link = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + actionId + "/link"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"taskId\":\"" + existing.getId() + "\"}")).andReturn();
        assertThat(link.getResponse().getStatus()).as(link.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(json(link).get("status").asText()).isEqualTo("LINKED");
        assertThat(mongoTemplate.find(new Query(Criteria.where("title").is("Write the release notes")), Task.class)).as("no duplicate created").isEmpty();

        // the linked task shows up as an open action item until it is done
        MvcResult open = mvc.perform(as(get(BASE + "/actions"), ownerToken(), workspaceId)).andReturn();
        assertThat(json(open).toString()).contains("IN_TASKS").contains(existing.getId());
        existing.setStatus("DONE"); mongoTemplate.save(existing);
        assertThat(json(mvc.perform(as(get(BASE + "/actions"), ownerToken(), workspaceId)).andReturn()).toString()).doesNotContain(existing.getId());

        MvcResult other = mvc.perform(as(post(BASE + "/meetings/" + id + "/actions/" + actionId + "/link"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"taskId\":\"missing\"}")).andReturn();
        assertThat(other.getResponse().getStatus()).isEqualTo(404);
    }

    @Test
    void continuity_showsThePreviousMeetingOfTheProjectAndWhatIsStillOpen() throws Exception {
        enable(ownerToken(), workspaceId);
        String first = notesMeeting("proj-9");
        String actionId = action(detail(first), "Write the release notes").get("id").asText();
        MvcResult ap = mvc.perform(as(post(BASE + "/meetings/" + first + "/actions/" + actionId + "/approve"), ownerToken(), workspaceId)).andReturn();
        assertThat(ap.getResponse().getStatus()).as(ap.getResponse().getContentAsString()).isEqualTo(200);

        String second = notesMeeting("proj-9", NOTES, "2026-11-18T09:00:00Z", "Release follow-up");

        JsonNode c = json(mvc.perform(as(get(BASE + "/meetings/" + second + "/continuity"), ownerToken(), workspaceId)).andReturn());
        assertThat(c.at("/previousMeeting/id").asText()).isEqualTo(first);
        assertThat(c.at("/sinceLastMeeting/tasksStillOpen/0/title").asText()).isEqualTo("Write the release notes");
        assertThat(c.at("/counts/openActionItems").asInt()).isGreaterThanOrEqualTo(1);

        JsonNode prep = json(mvc.perform(as(get(BASE + "/prepare").param("projectId", "proj-9"), ownerToken(), workspaceId)).andReturn());
        assertThat(prep.at("/previousMeeting/id").asText()).isEqualTo(second);

        JsonNode trends = json(mvc.perform(as(get(BASE + "/trends").param("days", "400"), ownerToken(), workspaceId)).andReturn());
        assertThat(trends.size()).as("days are clamped to 90").isEqualTo(90);
    }
}
