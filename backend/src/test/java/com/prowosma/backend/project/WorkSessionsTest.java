package com.prowosma.backend.project;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.WorkSession;
import com.prowosma.backend.service.WorkSessionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** Start/Stop work on a project: one running timer per person, time per editor, who sees whose time. */
class WorkSessionsTest extends ProwosmaTestBase {
    final ObjectMapper om = new ObjectMapper();
    @Autowired WorkSessionService service;
    String film, teaser;

    @BeforeEach
    void setUp() {
        mongoTemplate.remove(new Query(), WorkSession.class);
        film = project("Wedding film"); teaser = project("Teaser");
    }

    String project(String name) {
        Project p = new Project(); p.setOrganizationId(workspaceId); p.setName(name); p.setCreatedBy(ownerEmail);
        return mongoTemplate.save(p).getId();
    }
    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String token) {
        return b.header("Authorization", authHeader(token)).header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON);
    }
    JsonNode call(MockHttpServletRequestBuilder b, String token, String body, int status) throws Exception {
        MvcResult r = mvc.perform(as(b, token).content(body == null ? "" : body)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(status);
        String s = r.getResponse().getContentAsString();
        return s.isEmpty() || !s.startsWith("{") ? null : om.readTree(s);
    }

    @Test
    void startingAnotherProjectStopsTheFirst_andStopEndsIt() throws Exception {
        JsonNode a = call(post("/api/work-sessions/start"), memberToken(), "{\"projectId\":\"" + film + "\"}", 200);
        assertThat(a.get("projectName").asText()).isEqualTo("Wedding film");
        assertThat(call(get("/api/work-sessions/me"), memberToken(), null, 200).at("/running/projectId").asText()).isEqualTo(film);
        // starting the same one again changes nothing
        assertThat(call(post("/api/work-sessions/start"), memberToken(), "{\"projectId\":\"" + film + "\"}", 200).get("id").asText()).isEqualTo(a.get("id").asText());

        call(post("/api/work-sessions/start"), memberToken(), "{\"projectId\":\"" + teaser + "\"}", 200);
        WorkSession first = mongoTemplate.findById(a.get("id").asText(), WorkSession.class);
        assertThat(first.getEndedAt()).isNotNull();
        assertThat(first.getEndedBy()).isEqualTo("SWITCHED");
        assertThat(mongoTemplate.count(new Query(org.springframework.data.mongodb.core.query.Criteria.where("openKey").ne(null)), WorkSession.class)).isEqualTo(1);

        JsonNode stopped = call(post("/api/work-sessions/stop"), memberToken(), "{}", 200);
        assertThat(stopped.at("/stopped/projectId").asText()).isEqualTo(teaser);
        assertThat(stopped.get("running").isNull()).isTrue();
        call(post("/api/work-sessions/start"), memberToken(), "{\"projectId\":\"nope\"}", 404);
    }

    @Test
    void theProjectShowsHoursPerEditor_managersSeeEveryone_othersOnlyThemselves() throws Exception {
        Instant t0 = Instant.now().minus(Duration.ofHours(5));
        service.start(workspaceId, memberEmail, film, null, t0);                    // 2 h
        service.stop(workspaceId, memberEmail, null, t0.plus(Duration.ofHours(2)), "SELF");
        service.start(workspaceId, adminEmail, film, "rough cut", t0);              // 90 min
        service.stop(workspaceId, adminEmail, null, t0.plus(Duration.ofMinutes(90)), "SELF");

        JsonNode owner = call(get("/api/work-sessions/project/" + film + "?days=7"), ownerToken(), null, 200);
        assertThat(owner.get("everyone").asBoolean()).isTrue();
        assertThat(owner.get("totalMinutes").asLong()).isEqualTo(210);
        assertThat(owner.at("/people/0/email").asText()).isEqualTo(memberEmail);
        assertThat(owner.at("/people/0/minutes").asLong()).isEqualTo(120);
        assertThat(owner.at("/people/1/minutes").asLong()).isEqualTo(90);

        JsonNode member = call(get("/api/work-sessions/project/" + film + "?days=7"), memberToken(), null, 200);
        assertThat(member.get("everyone").asBoolean()).isFalse();
        assertThat(member.get("people").size()).isEqualTo(1);
        assertThat(member.get("totalMinutes").asLong()).isEqualTo(120);

        String csv = mvc.perform(as(get("/api/work-sessions/export.csv?days=7&projectId=" + film), ownerToken())).andReturn().getResponse().getContentAsString();
        assertThat(csv).startsWith("Project,Person,Email").contains("\"rough cut\"").contains(",120,2.00,");
        String mine = mvc.perform(as(get("/api/work-sessions/export.csv?days=7"), memberToken())).andReturn().getResponse().getContentAsString();
        assertThat(mine).contains(memberEmail).doesNotContain(adminEmail);
    }

    @Test
    void aForgottenTimerIsCappedAt12Hours() {
        Instant t0 = Instant.now().minus(Duration.ofHours(20));
        service.start(workspaceId, memberEmail, film, null, t0);
        assertThat(service.closeForgotten(Instant.now())).isEqualTo(1);
        WorkSession s = mongoTemplate.findAll(WorkSession.class).get(0);
        assertThat(s.getMinutes()).isEqualTo(12 * 60);
        assertThat(s.getEndedBy()).isEqualTo("AUTO");
    }

    @Test
    void csvCellsCantBecomeFormulas() {
        assertThat(com.prowosma.backend.controller.WorkSessionController.csv("=HYPERLINK(1)")).isEqualTo("\"'=HYPERLINK(1)\"");
    }

    @Test
    void clockingOutOfTheDayStopsTheProjectTimer() throws Exception {
        call(post("/api/admin/features"), ownerToken(), "{\"key\":\"attendance\",\"enabled\":true}", 200);
        call(post("/api/attendance/me/clock-in"), memberToken(), "{\"workMode\":\"REMOTE\"}", 200);
        call(post("/api/work-sessions/start"), memberToken(), "{\"projectId\":\"" + film + "\"}", 200);
        call(post("/api/attendance/me/clock-out"), memberToken(), "{}", 200);
        WorkSession s = mongoTemplate.findAll(WorkSession.class).get(0);
        assertThat(s.getEndedBy()).isEqualTo("CLOCKED_OUT");
    }
}
