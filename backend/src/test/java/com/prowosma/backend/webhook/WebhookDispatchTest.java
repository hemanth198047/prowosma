package com.prowosma.backend.webhook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Webhook;
import com.prowosma.backend.repository.WebhookRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Fix-4: Verify webhook CRUD and that dispatch goes through the secure path.
 *
 * Covers:
 *   T1  POST /api/webhooks creates a webhook with a secret
 *   T2  GET /api/webhooks lists webhooks for the workspace
 *   T3  POST /api/webhooks/{id}/rotate-secret generates a new secret
 *   T4  POST /api/webhooks/dispatch returns queued:true (Fix-3 path)
 *   T5  DELETE /api/webhooks/{id} removes the webhook
 *   T6  Event types endpoint returns expected event list
 */
@DisplayName("Webhook — CRUD and dispatch path (Fix-3 verification)")
class WebhookDispatchTest extends ProwosmaTestBase {

    @Autowired private WebhookRepository webhookRepository;
    @Autowired private ObjectMapper       objectMapper;

    @Test
    @DisplayName("T1: POST /api/webhooks creates webhook with auto-generated secret")
    void createWebhook_hasSecret() throws Exception {
        String body = mvc.perform(post("/api/webhooks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://example.com/hook\",\"description\":\"Test hook\"," +
                         "\"events\":[\"task.created\"]}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(body);
        assertThat(json.get("secret").asText()).startsWith("whsec_");
    }

    @Test
    @DisplayName("T2: GET /api/webhooks lists only workspace webhooks")
    void listWebhooks_scopedToWorkspace() throws Exception {
        // Seed one webhook
        Webhook wh = new Webhook();
        wh.setOrganizationId(workspaceId);
        wh.setUrl("https://example.com/a");
        wh.setSecret("whsec_test");
        wh.setActive(true);
        wh.setEvents(List.of("task.created"));
        wh.setCreatedAt(LocalDateTime.now());
        webhookRepository.save(wh);

        String resp = mvc.perform(get("/api/webhooks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        // /api/webhooks returns the same paginated envelope as /api/tasks,
        // /api/projects, etc. ({"data":[...],"page":...,"totalElements":...})
        // rather than a bare array.
        assertThat(json.get("data").isArray()).isTrue();
        assertThat(json.get("data").size()).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("T3: POST /api/webhooks/{id}/rotate-secret returns new secret")
    void rotateSecret_returnsNewSecret() throws Exception {
        Webhook wh = new Webhook();
        wh.setOrganizationId(workspaceId);
        wh.setUrl("https://example.com/b");
        wh.setSecret("whsec_old");
        wh.setActive(true);
        wh.setEvents(List.of("task.created"));
        wh.setCreatedAt(LocalDateTime.now());
        wh = webhookRepository.save(wh);

        String resp = mvc.perform(post("/api/webhooks/" + wh.getId() + "/rotate-secret")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        String newSecret = json.get("secret").asText();
        assertThat(newSecret).startsWith("whsec_");
        assertThat(newSecret).isNotEqualTo("whsec_old");
    }

    @Test
    @DisplayName("T4: POST /api/webhooks/dispatch returns queued:true (Fix-3 — HMAC path)")
    void dispatch_usesSecurePath() throws Exception {
        String resp = mvc.perform(post("/api/webhooks/dispatch")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"event\":\"task.created\",\"data\":{\"title\":\"Test\"}}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var json = objectMapper.readTree(resp);
        // Fix-3: dispatch now goes through WebhookService.fire() not raw RestTemplate
        assertThat(json.has("queued")).isTrue();
        assertThat(json.get("queued").asBoolean()).isTrue();
        assertThat(json.get("message").asText()).contains("HMAC-signed");
    }

    @Test
    @DisplayName("T5: DELETE /api/webhooks/{id} removes the webhook")
    void deleteWebhook() throws Exception {
        Webhook wh = new Webhook();
        wh.setOrganizationId(workspaceId);
        wh.setUrl("https://example.com/c");
        wh.setSecret("whsec_x");
        wh.setActive(true);
        wh.setEvents(List.of("task.deleted"));
        wh.setCreatedAt(LocalDateTime.now());
        wh = webhookRepository.save(wh);

        mvc.perform(delete("/api/webhooks/" + wh.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        assertThat(webhookRepository.findById(wh.getId())).isEmpty();
    }

    @Test
    @DisplayName("T6: GET /api/webhooks/event-types returns at least 10 event types")
    void eventTypes_returnsExpectedList() throws Exception {
        String resp = mvc.perform(get("/api/webhooks/event-types")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        var arr = objectMapper.readTree(resp);
        assertThat(arr.isArray()).isTrue();
        assertThat(arr.size()).isGreaterThanOrEqualTo(10);
    }
}
