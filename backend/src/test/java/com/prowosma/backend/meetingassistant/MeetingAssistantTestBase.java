package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.MeetingSessionRepository;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * Shared helpers for the Meeting Assistant integration tests. Clears documents but keeps indexes (they are under test).
 * The background poller is switched off so tests drive the job queue deterministically via MeetingJobRunner.runOnce().
 */
@TestPropertySource(properties = "app.meeting-assistant.jobs-enabled=false")
abstract class MeetingAssistantTestBase extends TwoWorkspaceTestBase {

    static final String MEET = "https://meet.google.com/abc-defg-hij";
    static final String TEAMS = "https://teams.microsoft.com/meet/123456789012";
    static final String BASE = "/api/meeting-assistant";
    static final String ADMIN = "/api/admin/meeting-assistant";

    @Autowired protected ObjectMapper om;
    @Autowired protected MeetingSessionRepository sessionRepository;

    @BeforeEach
    void resetMeetingData() throws Exception {
        for (String c : new String[]{"meeting_sessions", "meeting_integrations", "meeting_assistant_settings", "transcript_segments",
                "meeting_jobs", "meeting_audit_events", "meeting_user_connections", "meeting_oauth_states",
                "meeting_artifacts", "meeting_artifact_heads", "meeting_generations", "ai_settings",
                "meeting_actions", "meeting_proposed_projects", "meeting_extractions"}) {
            mongoTemplate.remove(new org.springframework.data.mongodb.core.query.Query(), c);
        }
        for (String p : new String[]{"GOOGLE_MEET", "MS_TEAMS"}) {
            mvc.perform(as(put(ADMIN + "/platforms/" + p + "/enabled"), ownerToken(), workspaceId)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}"));
        }
    }

    protected MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token, String ws) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", ws);
    }

    protected JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    protected MvcResult createSession(String token, String ws, String url) throws Exception {
        return mvc.perform(as(post(BASE + "/sessions"), token, ws).contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("meetingUrl", url, "title", "Weekly sync")))).andReturn();
    }

    protected String createSessionId(String token, String ws, String url) throws Exception {
        MvcResult r = createSession(token, ws, url);
        if (r.getResponse().getStatus() != 201) throw new AssertionError("create failed: " + r.getResponse().getContentAsString());
        return json(r).get("id").asText();
    }

    protected MvcResult uploadTranscript(String token, String ws, String id, String content, String format) throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("content", content);
        if (format != null) body.put("format", format);
        return mvc.perform(as(post(BASE + "/sessions/" + id + "/transcript"), token, ws)
                .contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(body))).andReturn();
    }

    protected String tokenForNewRole(String email, String role) {
        User u = new User();
        u.setEmail(email); u.setName(role); u.setPassword(passwordEncoder.encode("pass")); u.setRole("USER");
        userRepository.save(u);
        TeamMember m = new TeamMember();
        m.setOrganizationId(workspaceId); m.setEmail(email); m.setName(role); m.setRole(role);
        teamMemberRepository.save(m);
        return jwtUtil.generateToken(email);
    }

    protected MeetingSession session(String id) { return sessionRepository.findById(id).orElseThrow(); }

    protected long segmentCount(String sessionId) {
        return mongoTemplate.count(new org.springframework.data.mongodb.core.query.Query(
                org.springframework.data.mongodb.core.query.Criteria.where("sessionId").is(sessionId)),
                com.prowosma.backend.model.TranscriptSegment.class);
    }
}
