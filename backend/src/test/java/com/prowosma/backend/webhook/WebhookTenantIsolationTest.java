package com.prowosma.backend.webhook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.model.Webhook;
import com.prowosma.backend.repository.WebhookRepository;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The outbound-webhook management API used to be reachable by anyone: /api/webhooks/**
 * was public (meant for the Stripe and email callbacks that share the prefix), and every
 * by-id endpoint fetched the webhook with no check that it belonged to the caller's
 * workspace — so its signing secret could be read, rotated or deleted across workspaces.
 */
@DisplayName("Webhooks — authentication and workspace isolation")
class WebhookTenantIsolationTest extends TwoWorkspaceTestBase {

    @Autowired private WebhookRepository webhookRepository;
    @Autowired private ObjectMapper      objectMapper;

    private Webhook seed(String workspace, String secret) {
        Webhook wh = new Webhook();
        wh.setOrganizationId(workspace);
        wh.setUrl("https://example.com/" + secret);
        wh.setSecret(secret);
        wh.setActive(true);
        wh.setEvents(List.of("task.created"));
        wh.setCreatedAt(LocalDateTime.now());
        return webhookRepository.save(wh);
    }

    // ── authentication ───────────────────────────────────────────────────────

    @Test
    @DisplayName("the management API requires a login (it used to be open)")
    void managementApi_requiresAuthentication() throws Exception {
        Webhook wh = seed(workspaceId, "whsec_anon");

        mvc.perform(get("/api/webhooks")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/webhooks/" + wh.getId())).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/webhooks")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://evil.example.com\"}"))
           .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/webhooks/" + wh.getId() + "/rotate-secret")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/webhooks/" + wh.getId())).andExpect(status().isUnauthorized());

        assertThat(webhookRepository.findById(wh.getId())).isPresent();
    }

    @Test
    @DisplayName("the Stripe callback is still reachable without a login (it authenticates by signature)")
    void stripeCallback_staysPublic() throws Exception {
        int status = mvc.perform(post("/api/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
           .andReturn().getResponse().getStatus();
        assertThat(status).isNotIn(401, 403);
    }

    @Test
    @DisplayName("a request with no X-Workspace-Id is rejected instead of matching un-owned webhooks")
    void missingWorkspaceHeader_isBadRequest() throws Exception {
        mvc.perform(get("/api/webhooks")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a Viewer can no longer create webhooks")
    void viewer_cannotCreate() throws Exception {
        User viewer = new User();
        viewer.setEmail("viewer@test.com");
        viewer.setName("Test Viewer");
        viewer.setPassword(passwordEncoder.encode("pass"));
        viewer.setRole("USER");
        userRepository.save(viewer);
        TeamMember record = new TeamMember();
        record.setOrganizationId(workspaceId);
        record.setEmail("viewer@test.com");
        record.setName("Test Viewer");
        record.setRole("VIEWER");
        teamMemberRepository.save(record);

        mvc.perform(post("/api/webhooks")
                .header("Authorization", authHeader(jwtUtil.generateToken("viewer@test.com")))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"https://example.com/v\"}"))
           .andExpect(status().isForbidden());
    }

    // ── isolation ────────────────────────────────────────────────────────────

    @Test
    @DisplayName("another workspace's webhook can't be read, edited, toggled, rotated or pinged by id — it looks like it doesn't exist")
    void foreignWebhook_isInvisibleByIdEverywhere() throws Exception {
        Webhook foreign = seed(otherWorkspaceId, "whsec_foreign");
        String id = foreign.getId();

        mvc.perform(get("/api/webhooks/" + id)
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());
        mvc.perform(put("/api/webhooks/" + id)
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"url\":\"https://evil.example.com\"}"))
           .andExpect(status().isNotFound());
        mvc.perform(patch("/api/webhooks/" + id + "/toggle")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());
        mvc.perform(post("/api/webhooks/" + id + "/rotate-secret")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());
        mvc.perform(post("/api/webhooks/" + id + "/test")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());

        Webhook after = webhookRepository.findById(id).orElseThrow();
        assertThat(after.getSecret()).isEqualTo("whsec_foreign");
        assertThat(after.getUrl()).isEqualTo("https://example.com/whsec_foreign");
        assertThat(after.isActive()).isTrue();
    }

    @Test
    @DisplayName("deleting another workspace's webhook by id does nothing")
    void foreignWebhook_cannotBeDeleted() throws Exception {
        Webhook foreign = seed(otherWorkspaceId, "whsec_keep");

        mvc.perform(delete("/api/webhooks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());       // idempotent, same answer as for an id that doesn't exist

        assertThat(webhookRepository.findById(foreign.getId())).isPresent();
    }

    @Test
    @DisplayName("the list contains only this workspace's webhooks")
    void list_excludesForeignWebhooks() throws Exception {
        Webhook mine = seed(workspaceId, "whsec_mine");
        Webhook foreign = seed(otherWorkspaceId, "whsec_theirs");

        String body = mvc.perform(get("/api/webhooks")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode data = objectMapper.readTree(body).get("data");
        List<String> ids = new java.util.ArrayList<>();
        data.forEach(n -> ids.add(n.get("id").asText()));
        assertThat(ids).contains(mine.getId()).doesNotContain(foreign.getId());
    }

    @Test
    @DisplayName("the owner's own webhook still works end to end")
    void ownWebhook_stillWorks() throws Exception {
        Webhook mine = seed(workspaceId, "whsec_own");

        mvc.perform(get("/api/webhooks/" + mine.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        mvc.perform(patch("/api/webhooks/" + mine.getId() + "/toggle")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        assertThat(webhookRepository.findById(mine.getId()).orElseThrow().isActive()).isFalse();
    }
}
