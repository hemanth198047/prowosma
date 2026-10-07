package com.prowosma.backend.meetingassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.MeetingSession;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.MeetingSessionRepository;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Meeting Assistant API — foundation")
class MeetingAssistantApiTest extends TwoWorkspaceTestBase {

    private static final String MEET = "https://meet.google.com/abc-defg-hij";
    private static final String BASE = "/api/meeting-assistant";
    private static final String ADMIN = "/api/admin/meeting-assistant";

    @Autowired private ObjectMapper om;
    @Autowired private MeetingSessionRepository sessionRepository;

    /** Remove documents but KEEP indexes — the unique active-session index is part of what is under test. */
    private void clear(String collection) {
        mongoTemplate.remove(new org.springframework.data.mongodb.core.query.Query(), collection);
    }

        @BeforeEach
    void enableGoogleMeet() throws Exception {
        clear("meeting_sessions");
        clear("meeting_integrations");
        clear("meeting_assistant_settings");
        mvc.perform(as(put(ADMIN + "/platforms/GOOGLE_MEET/enabled"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":true}"))
           .andExpect(status().isOk());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token, String ws) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", ws);
    }

    private MvcResult create(String token, String ws, String url, String scheduledFor) throws Exception {
        String body = om.writeValueAsString(java.util.Map.of(
                "meetingUrl", url, "title", "Weekly sync",
                "scheduledFor", scheduledFor == null ? "" : scheduledFor));
        return mvc.perform(as(post(BASE + "/sessions"), token, ws)
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn();
    }

    private JsonNode json(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    private String tokenForNewRole(String email, String role) {
        User u = new User();
        u.setEmail(email); u.setName(role); u.setPassword(passwordEncoder.encode("pass")); u.setRole("USER");
        userRepository.save(u);
        TeamMember m = new TeamMember();
        m.setOrganizationId(workspaceId); m.setEmail(email); m.setName(role); m.setRole(role);
        teamMemberRepository.save(m);
        return jwtUtil.generateToken(email);
    }

    // ── creation & validation ────────────────────────────────────────────────

    @Test @DisplayName("a member can register a meeting; the status never claims live attendance")
    void createsSession() throws Exception {
        MvcResult r = create(memberToken(), workspaceId, MEET, null);
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        JsonNode j = json(r);
        assertThat(j.get("status").asText()).isEqualTo("AWAITING_TRANSCRIPT");
        assertThat(j.get("provider").asText()).isEqualTo("GOOGLE_MEET");
        assertThat(j.get("statusDetail").asText()).doesNotContainIgnoringCase("listening").doesNotContainIgnoringCase("joined");
        assertThat(j.has("activeKey")).isFalse();      // internals are not exposed
    }

    @Test @DisplayName("invalid, unsupported and disabled-platform links are refused with plain explanations")
    void rejectsBadUrls() throws Exception {
        assertThat(create(memberToken(), workspaceId, "not a url", null).getResponse().getStatus()).isEqualTo(400);
        MvcResult zoom = create(memberToken(), workspaceId, "https://us02web.zoom.us/j/123456789", null);
        assertThat(zoom.getResponse().getStatus()).isEqualTo(400);
        assertThat(json(zoom).get("error").asText()).isEqualTo("UNSUPPORTED_PLATFORM");
        MvcResult teams = create(memberToken(), workspaceId, "https://teams.microsoft.com/meet/123456789012", null);
        assertThat(teams.getResponse().getStatus()).isEqualTo(409);               // Teams not enabled
        assertThat(json(teams).get("error").asText()).isEqualTo("PROVIDER_DISABLED");
    }

    @Test @DisplayName("scheduling in the past or absurdly far ahead is refused")
    void scheduleBounds() throws Exception {
        String past = Instant.now().minus(1, ChronoUnit.HOURS).toString();
        String far = Instant.now().plus(800, ChronoUnit.DAYS).toString();
        assertThat(json(create(memberToken(), workspaceId, MEET, past)).get("error").asText()).isEqualTo("SCHEDULE_IN_PAST");
        assertThat(json(create(memberToken(), workspaceId, MEET, far)).get("error").asText()).isEqualTo("SCHEDULE_TOO_FAR");
    }

    // ── duplicates & recurring meetings ─────────────────────────────────────

    @Test @DisplayName("a second request for the same occurrence is rejected; after cancelling it is allowed again")
    void duplicatePrevention() throws Exception {
        MvcResult first = create(memberToken(), workspaceId, MEET, null);
        MvcResult dup = create(memberToken(), workspaceId, MEET, null);
        assertThat(dup.getResponse().getStatus()).isEqualTo(409);
        assertThat(json(dup).get("error").asText()).isEqualTo("DUPLICATE_SESSION");
        assertThat(json(dup).get("existingSessionId").asText()).isEqualTo(json(first).get("id").asText());

        mvc.perform(as(post(BASE + "/sessions/" + json(first).get("id").asText() + "/cancel"), memberToken(), workspaceId))
           .andExpect(status().isOk());
        assertThat(create(memberToken(), workspaceId, MEET, null).getResponse().getStatus()).isEqualTo(201);
    }

    @Test @DisplayName("recurring meetings sharing one URL: different occurrences coexist")
    void recurringOccurrences() throws Exception {
        String morning = Instant.now().plus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS).toString();
        String evening = Instant.now().plus(1, ChronoUnit.DAYS).plus(9, ChronoUnit.HOURS).truncatedTo(ChronoUnit.HOURS).toString();
        assertThat(create(memberToken(), workspaceId, MEET, morning).getResponse().getStatus()).isEqualTo(201);
        assertThat(create(memberToken(), workspaceId, MEET, evening).getResponse().getStatus()).isEqualTo(201);
        assertThat(create(memberToken(), workspaceId, MEET, morning).getResponse().getStatus()).isEqualTo(409);
    }

    @Test @DisplayName("simultaneous requests create exactly one session (enforced by the database index)")
    void concurrentRequestsCreateOne() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(6);
        String token = memberToken();
        List<Future<Integer>> results = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            Callable<Integer> c = () -> create(token, workspaceId, MEET, null).getResponse().getStatus();
            results.add(pool.submit(c));
        }
        int created = 0, conflicts = 0;
        for (Future<Integer> f : results) { int s = f.get(); if (s == 201) created++; else if (s == 409) conflicts++; }
        pool.shutdown();
        assertThat(created).isEqualTo(1);
        assertThat(conflicts).isEqualTo(5);
        assertThat(sessionRepository.count()).isEqualTo(1);
    }

    // ── access control ──────────────────────────────────────────────────────

    @Test @DisplayName("viewers cannot send the assistant")
    void viewerBlocked() throws Exception {
        String viewer = tokenForNewRole("viewer@test.com", "VIEWER");
        assertThat(create(viewer, workspaceId, MEET, null).getResponse().getStatus()).isEqualTo(403);
    }

    @Test @DisplayName("a private meeting is invisible to other members until shared; sharing is limited to workspace members")
    void privateUntilShared() throws Exception {
        String id = json(create(ownerToken(), workspaceId, MEET, null)).get("id").asText();
        mvc.perform(as(get(BASE + "/sessions/" + id), memberToken(), workspaceId)).andExpect(status().isNotFound());
        assertThat(om.readTree(mvc.perform(as(get(BASE + "/sessions"), memberToken(), workspaceId)).andReturn()
                .getResponse().getContentAsString()).size()).isZero();

        mvc.perform(as(put(BASE + "/sessions/" + id + "/access"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sharedWith\":[\"stranger@elsewhere.com\"]}"))
           .andExpect(status().isBadRequest());
        mvc.perform(as(put(BASE + "/sessions/" + id + "/access"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sharedWith\":[\"" + memberEmail + "\"]}"))
           .andExpect(status().isOk());
        mvc.perform(as(get(BASE + "/sessions/" + id), memberToken(), workspaceId)).andExpect(status().isOk());
    }

    @Test @DisplayName("a shared reader cannot cancel someone else's meeting")
    void sharedReaderCannotManage() throws Exception {
        String id = json(create(ownerToken(), workspaceId, MEET, null)).get("id").asText();
        mvc.perform(as(put(BASE + "/sessions/" + id + "/access"), ownerToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"visibility\":\"WORKSPACE\"}")).andExpect(status().isOk());
        mvc.perform(as(post(BASE + "/sessions/" + id + "/cancel"), memberToken(), workspaceId)).andExpect(status().isForbidden());
    }

    @Test @DisplayName("another organization cannot read, cancel or list our meetings")
    void crossOrganizationIsolation() throws Exception {
        String id = json(create(ownerToken(), workspaceId, MEET, null)).get("id").asText();

        // Other owner, acting in THEIR workspace, asks for our session id
        mvc.perform(as(get(BASE + "/sessions/" + id), otherOwnerToken(), otherWorkspaceId)).andExpect(status().isNotFound());
        mvc.perform(as(post(BASE + "/sessions/" + id + "/cancel"), otherOwnerToken(), otherWorkspaceId)).andExpect(status().isNotFound());
        assertThat(om.readTree(mvc.perform(as(get(BASE + "/sessions"), otherOwnerToken(), otherWorkspaceId)).andReturn()
                .getResponse().getContentAsString()).size()).isZero();
        // Other owner pretending to be in OUR workspace
        mvc.perform(as(get(BASE + "/sessions/" + id), otherOwnerToken(), workspaceId)).andExpect(status().isForbidden());

        assertThat(sessionRepository.findAll()).hasSize(1);
        assertThat(sessionRepository.findAll().get(0).getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
    }

    // ── admin configuration ─────────────────────────────────────────────────

    @Test @DisplayName("admin endpoints are admin-only, for reads as well as writes")
    void adminOnly() throws Exception {
        mvc.perform(as(get(ADMIN + "/settings"), memberToken(), workspaceId)).andExpect(status().isForbidden());
        mvc.perform(as(get(ADMIN + "/platforms"), memberToken(), workspaceId)).andExpect(status().isForbidden());
        mvc.perform(as(get(ADMIN + "/settings"), adminToken(), workspaceId)).andExpect(status().isOk());
    }

    @Test @DisplayName("Test Connection reports honestly that no sign-in exists yet")
    void testConnectionIsHonest() throws Exception {
        MvcResult r = mvc.perform(as(post(ADMIN + "/platforms/GOOGLE_MEET/test"), adminToken(), workspaceId)).andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(200);
        assertThat(json(r).get("healthy").asBoolean()).isFalse();
        assertThat(json(r).get("connectionStatus").asText()).isEqualTo("NOT_CONNECTED");
    }

    @Test @DisplayName("settings: automatic creation cannot be switched on yet; admins can't be locked out of sending")
    void settingsValidation() throws Exception {
        mvc.perform(as(put(ADMIN + "/settings"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"autoCreateTasks\":true}"))
           .andExpect(status().isConflict());
        MvcResult r = mvc.perform(as(put(ADMIN + "/settings"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"sendRoles\":[]}")).andReturn();
        assertThat(json(r).get("sendRoles").toString()).contains("OWNER").contains("ADMIN").doesNotContain("MEMBER");
        assertThat(create(memberToken(), workspaceId, MEET, null).getResponse().getStatus()).isEqualTo(403);
        mvc.perform(as(put(ADMIN + "/settings"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"transcriptRetentionDays\":0}"))
           .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("disabling a platform stops new requests for it")
    void disablingBlocksRequests() throws Exception {
        mvc.perform(as(put(ADMIN + "/platforms/GOOGLE_MEET/enabled"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":false}")).andExpect(status().isOk());
        assertThat(json(create(memberToken(), workspaceId, MEET, null)).get("error").asText()).isEqualTo("PROVIDER_DISABLED");
    }

    @Test @DisplayName("simulated meetings and dev transitions are unavailable unless explicitly enabled")
    void devFixturesOffByDefault() throws Exception {
        String body = "{\"meetingUrl\":\"" + MEET + "\",\"simulated\":true}";
        mvc.perform(as(post(BASE + "/sessions"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        String id = json(create(adminToken(), workspaceId, MEET, null)).get("id").asText();
        mvc.perform(as(post(BASE + "/sessions/" + id + "/dev/advance"), adminToken(), workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"PROCESSING\"}")).andExpect(status().isNotFound());
    }

    @Test @DisplayName("a retry of a non-failed meeting is refused")
    void retryOnlyFailed() throws Exception {
        String id = json(create(memberToken(), workspaceId, MEET, null)).get("id").asText();
        mvc.perform(as(post(BASE + "/sessions/" + id + "/retry"), memberToken(), workspaceId)).andExpect(status().isConflict());
        MeetingSession s = sessionRepository.findById(id).orElseThrow();
        assertThat(s.getStatus()).isEqualTo("AWAITING_TRANSCRIPT");
    }
}
