package com.prowosma.backend.tasks;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.model.TeamMember;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/** A task's history holds that task's changes only - each one meaningful - not the whole workspace's log. */
class TaskHistoryTest extends ProwosmaTestBase {
    final ObjectMapper om = new ObjectMapper();
    String memberId;

    @BeforeEach
    void setUp() {
        mongoTemplate.remove(new Query(), ActivityLog.class);
        memberId = teamMemberRepository.findByOrganizationId(workspaceId).stream().filter(t -> memberEmail.equals(t.getEmail())).map(TeamMember::getId).findFirst().orElseThrow();
    }

    MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b) {
        return b.header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId).contentType(MediaType.APPLICATION_JSON);
    }
    JsonNode call(MockHttpServletRequestBuilder b, String body) throws Exception {
        MvcResult r = mvc.perform(as(b).content(body == null ? "" : body)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
        return om.readTree(r.getResponse().getContentAsString());
    }

    @Test
    void historyIsThisTasksMeaningfulChangesOnly() throws Exception {
        String id = call(post("/api/tasks"), "{\"title\":\"Colour grade reel\",\"status\":\"TODO\",\"priority\":\"MEDIUM\"}").get("id").asText();
        String other = call(post("/api/tasks"), "{\"title\":\"Some other task\",\"status\":\"TODO\",\"priority\":\"LOW\"}").get("id").asText();
        call(patch("/api/tasks/" + other), "{\"status\":\"IN_PROGRESS\"}");

        call(patch("/api/tasks/" + id), "{\"status\":\"IN_PROGRESS\"}");
        call(patch("/api/tasks/" + id), "{\"assigneeIds\":[\"" + memberId + "\"]}");
        call(patch("/api/tasks/" + id), "{\"dueDate\":\"2026-11-27T10:00:00\"}");
        call(patch("/api/tasks/" + id), "{\"title\":\"Colour grade reel v2\"}");
        call(post("/api/tasks/" + id + "/comments"), "{\"text\":\"Looks great\",\"mentions\":[]}");
        int before = (int) mongoTemplate.count(new Query(), ActivityLog.class);
        call(patch("/api/tasks/" + id), "{\"status\":\"IN_PROGRESS\"}");              // nothing changed: nothing logged
        assertThat(mongoTemplate.count(new Query(), ActivityLog.class)).isEqualTo(before);

        JsonNode h = call(get("/api/activity-logs/task/" + id), null);
        List<String> kinds = new ArrayList<>();
        h.get("entries").forEach(e -> kinds.add(e.get("kind").asText() + ":" + e.get("newValue").asText("")));
        assertThat(kinds).containsExactlyInAnyOrder("CREATED:Colour grade reel", "STATUS:IN_PROGRESS", "ASSIGNMENT:Test Member", "DUE:27 Nov 2026",
                "DETAILS:Colour grade reel v2", "COMMENT:Looks great");
        assertThat(h.toString()).doesNotContain("Some other task");
        assertThat(h.at("/entries/0/byName").asText()).isNotEqualTo("owner");                // a real name, not the start of an email

        // the general endpoint now honours the task filter too (it used to return the whole workspace)
        JsonNode generic = call(get("/api/activity-logs?taskId=" + id + "&limit=200"), null);
        generic.get("data").forEach(e -> assertThat(e.toString()).doesNotContain("Some other task"));
        assertThat(generic.get("data").size()).isEqualTo(6);
    }
}
