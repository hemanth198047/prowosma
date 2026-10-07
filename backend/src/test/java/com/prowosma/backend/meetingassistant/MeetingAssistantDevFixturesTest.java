package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.MeetingSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** SIMULATED meetings only — exercises the lifecycle and recovery paths; no real platform is contacted. */
@TestPropertySource(properties = "app.meeting-assistant.dev-fixtures-enabled=true")
@DisplayName("Meeting Assistant lifecycle — simulated fixtures")
class MeetingAssistantDevFixturesTest extends ProwosmaTestBase {

    private static final String BASE = "/api/meeting-assistant";
    private static final String MEET = "https://meet.google.com/xyz-abcd-efg";
    @Autowired private ObjectMapper om;
    @Autowired private MeetingSessionRepository sessionRepository;

    /** Remove documents but KEEP indexes — the unique active-session index is part of what is under test. */
    private void clear(String collection) {
        mongoTemplate.remove(new org.springframework.data.mongodb.core.query.Query(), collection);
    }

        @BeforeEach
    void setUp() throws Exception {
        clear("meeting_sessions");
        clear("meeting_integrations");
        mvc.perform(as(put("/api/admin/meeting-assistant/platforms/GOOGLE_MEET/enabled"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}")).andExpect(status().isOk());
    }

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b) {
        return b.header("Authorization", authHeader(adminToken())).header("X-Workspace-Id", workspaceId);
    }

    private JsonNode createSimulated() throws Exception {
        MvcResult r = mvc.perform(as(post(BASE + "/sessions")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"meetingUrl\":\"" + MEET + "\",\"title\":\"Demo\",\"simulated\":true}")).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        return om.readTree(r.getResponse().getContentAsString());
    }

    private int advance(String id, String to) throws Exception {
        return mvc.perform(as(post(BASE + "/sessions/" + id + "/dev/advance")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + to + "\"}")).andReturn().getResponse().getStatus();
    }

    @Test @DisplayName("simulated sessions are labelled and flagged")
    void labelled() throws Exception {
        JsonNode j = createSimulated();
        assertThat(j.get("title").asText()).startsWith("[SIMULATED]");
        assertThat(j.get("simulated").asBoolean()).isTrue();
    }

    @Test @DisplayName("illegal transitions are refused; legal ones are recorded in history")
    void transitions() throws Exception {
        String id = createSimulated().get("id").asText();
        assertThat(advance(id, "READY_FOR_REVIEW")).isEqualTo(409);   // cannot skip PROCESSING
        assertThat(advance(id, "PROCESSING")).isEqualTo(200);
        assertThat(advance(id, "READY_FOR_REVIEW")).isEqualTo(200);
        assertThat(advance(id, "COMPLETED")).isEqualTo(200);
        assertThat(advance(id, "PROCESSING")).isEqualTo(409);         // completed is final
        assertThat(sessionRepository.findById(id).orElseThrow().getHistory()).hasSize(4);
        assertThat(sessionRepository.findById(id).orElseThrow().getActiveKey()).isNull();
    }

    @Test @DisplayName("failure explains itself and retry works once; retry is blocked if the meeting was re-requested meanwhile")
    void failureAndRetry() throws Exception {
        String id = createSimulated().get("id").asText();
        assertThat(advance(id, "FAILED")).isEqualTo(200);
        JsonNode failed = om.readTree(mvc.perform(as(get(BASE + "/sessions/" + id))).andReturn().getResponse().getContentAsString());
        assertThat(failed.get("failureCode").asText()).isEqualTo("SIMULATED_FAILURE");
        assertThat(failed.get("recoveryAction").asText()).isNotBlank();

        JsonNode second = createSimulated();                          // re-requested while the first is failed
        mvc.perform(as(post(BASE + "/sessions/" + id + "/retry"))).andExpect(status().isConflict());
        mvc.perform(as(post(BASE + "/sessions/" + second.get("id").asText() + "/cancel"))).andExpect(status().isOk());
        mvc.perform(as(post(BASE + "/sessions/" + id + "/retry"))).andExpect(status().isOk());
        assertThat(sessionRepository.findById(id).orElseThrow().getRetryCount()).isEqualTo(1);
    }
}
