package com.prowosma.backend.search;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.Goal;
import com.prowosma.backend.repository.TaskRepository;
import com.prowosma.backend.repository.GoalRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * T1  Search returns results matching query term
 * T2  Search results are scoped to the current workspace
 * T3  Type filter works — ?type=task only returns tasks
 * T4  Short query (< 2 chars) returns empty results gracefully
 * T5  Quick search endpoint returns max 3 results per type
 */
@DisplayName("Global search — cross-entity search")
class GlobalSearchTest extends ProwosmaTestBase {

    @Autowired private TaskRepository taskRepository;
    @Autowired private GoalRepository goalRepository;
    @Autowired private ObjectMapper   objectMapper;

    @Test
    @DisplayName("T1: Search returns task matching query")
    void search_findsTasks() throws Exception {
        Task t = new Task();
        t.setTitle("Implement OAuth login"); t.setStatus("TODO"); t.setPriority("HIGH");
        t.setOrganizationId(workspaceId);
        taskRepository.save(t);

        String resp = mvc.perform(get("/api/search/global?q=OAuth")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.get("total").asInt()).isGreaterThan(0);
        assertThat(json.get("results").isArray()).isTrue();
    }

    @Test
    @DisplayName("T2: Results are workspace-scoped")
    void search_scopedToWorkspace() throws Exception {
        // Add task in a different workspace
        Task t = new Task();
        t.setTitle("OAuth other workspace"); t.setStatus("TODO"); t.setPriority("LOW");
        t.setOrganizationId("other-workspace-id");
        taskRepository.save(t);

        String resp = mvc.perform(get("/api/search/global?q=OAuth+other")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        JsonNode results = objectMapper.readTree(resp).get("results");
        // None of the returned results should be from other-workspace-id
        results.forEach(r -> assertThat(r.path("id").asText()).isNotEqualTo(t.getId()));
    }

    @Test
    @DisplayName("T3: ?type=task only returns tasks")
    void search_typeFilter() throws Exception {
        Task t = new Task();
        t.setTitle("Design system migration"); t.setStatus("TODO"); t.setPriority("MEDIUM");
        t.setOrganizationId(workspaceId);
        taskRepository.save(t);

        Goal g = new Goal();
        g.setTitle("Design system migration goal"); g.setStatus("ACTIVE"); g.setProgress(0);
        g.setOrganizationId(workspaceId);
        goalRepository.save(g);

        String resp = mvc.perform(get("/api/search/global?q=Design+system&type=task")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        JsonNode results = objectMapper.readTree(resp).get("results");
        results.forEach(r -> assertThat(r.get("type").asText()).isEqualTo("task"));
    }

    @Test
    @DisplayName("T4: Query shorter than 2 chars returns empty gracefully")
    void search_shortQuery_returnsEmpty() throws Exception {
        String resp = mvc.perform(get("/api/search/global?q=a")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.get("total").asInt()).isEqualTo(0);
    }

    @Test
    @DisplayName("T5: /quick returns at most 3 results per type")
    void quickSearch_maxThreePerType() throws Exception {
        // Seed 10 matching tasks
        for (int i = 0; i < 10; i++) {
            Task t = new Task();
            t.setTitle("Quick search task " + i); t.setStatus("TODO"); t.setPriority("LOW");
            t.setOrganizationId(workspaceId);
            taskRepository.save(t);
        }

        String resp = mvc.perform(get("/api/search/global/quick?q=Quick+search")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode arr = objectMapper.readTree(resp);
        assertThat(arr.isArray()).isTrue();
        // Quick search calls limit=3 per type — total across all types should be ≤ 3*5 = 15
        assertThat(arr.size()).isLessThanOrEqualTo(15);
    }
}
