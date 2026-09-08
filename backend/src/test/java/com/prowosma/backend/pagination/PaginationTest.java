package com.prowosma.backend.pagination;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.repository.TaskRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fix-4: Verify that pagination works correctly on the task list endpoint.
 *
 * Covers:
 *   T1  GET /api/tasks returns PagedResponse shape (data, page, size, totalElements)
 *   T2  page=0&size=5 returns only 5 items even when 20 exist
 *   T3  page=1&size=5 returns the second page
 *   T4  totalElements reflects all tasks for the workspace
 *   T5  hasNext is true when more pages exist, false on the last page
 */
@DisplayName("Pagination — task list endpoint")
class PaginationTest extends ProwosmaTestBase {

    @Autowired private TaskRepository taskRepository;
    @Autowired private ObjectMapper   objectMapper;

    private void seed(int count) {
        taskRepository.deleteAll();
        IntStream.range(0, count).forEach(i -> {
            Task t = new Task();
            t.setTitle("Task " + i);
            t.setStatus("TODO");
            t.setPriority("MEDIUM");
            t.setOrganizationId(workspaceId);
            taskRepository.save(t);
        });
    }

    @Test
    @DisplayName("T1: Response has PagedResponse structure")
    void response_hasPagedShape() throws Exception {
        seed(3);
        String body = mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(body);
        assertThat(json.has("data")).isTrue();
        assertThat(json.has("page")).isTrue();
        assertThat(json.has("size")).isTrue();
        assertThat(json.has("totalElements")).isTrue();
        assertThat(json.has("hasNext")).isTrue();
    }

    @Test
    @DisplayName("T2: page=0&size=5 returns at most 5 items")
    void pageSizeIsRespected() throws Exception {
        seed(20);
        String body = mvc.perform(get("/api/tasks?page=0&size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(body);
        assertThat(json.get("data").size()).isEqualTo(5);
    }

    @Test
    @DisplayName("T3: page=1 returns second page")
    void secondPage_isDifferentFromFirst() throws Exception {
        seed(20);

        String page0 = mvc.perform(get("/api/tasks?page=0&size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        String page1 = mvc.perform(get("/api/tasks?page=1&size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        // First IDs on page 0 should differ from page 1
        JsonNode p0 = objectMapper.readTree(page0).get("data");
        JsonNode p1 = objectMapper.readTree(page1).get("data");
        assertThat(p0.get(0).get("id").asText())
            .isNotEqualTo(p1.get(0).get("id").asText());
    }

    @Test
    @DisplayName("T4: totalElements matches database count")
    void totalElements_matchesDb() throws Exception {
        seed(12);
        String body = mvc.perform(get("/api/tasks?size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        long total = objectMapper.readTree(body).get("totalElements").asLong();
        assertThat(total).isEqualTo(12L);
    }

    @Test
    @DisplayName("T5: hasNext=true when more pages exist, false on last page")
    void hasNext_correctOnLastPage() throws Exception {
        seed(6);

        // Page 0, size 5 → hasNext should be true (6 items, showing 0..4)
        String p0 = mvc.perform(get("/api/tasks?page=0&size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();
        assertThat(objectMapper.readTree(p0).get("hasNext").asBoolean()).isTrue();

        // Page 1, size 5 → hasNext should be false (only 1 item left)
        String p1 = mvc.perform(get("/api/tasks?page=1&size=5")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();
        assertThat(objectMapper.readTree(p1).get("hasNext").asBoolean()).isFalse();
    }
}
