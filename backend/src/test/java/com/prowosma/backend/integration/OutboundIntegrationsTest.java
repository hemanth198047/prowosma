package com.prowosma.backend.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * GitLab sync and Microsoft Teams messages call hosts the user supplies. These tests cover
 * everything that must be refused BEFORE any request leaves the server (so they need no
 * network): missing configuration, non-https hosts, internal addresses, non-Microsoft Teams
 * URLs, disabled integrations and other workspaces' integrations. The success paths are
 * covered by the importer and card tests, which run without a network too.
 */
@DisplayName("GitLab sync and Teams — refused before anything is sent")
class OutboundIntegrationsTest extends TwoWorkspaceTestBase {

    @Autowired private ObjectMapper objectMapper;

    private String save(String key, String configJson, boolean enabled, String token, String workspace) throws Exception {
        String body = mvc.perform(put("/api/integrations/" + key)
                .header("Authorization", authHeader(token)).header("X-Workspace-Id", workspace)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":" + enabled + ",\"config\":" + configJson + "}"))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("id").asText();
    }

    private String syncGitLab(String id, String token, String workspace, int expectedStatus) throws Exception {
        return mvc.perform(post("/api/integrations/" + id + "/sync/gitlab")
                .header("Authorization", authHeader(token)).header("X-Workspace-Id", workspace))
           .andExpect(status().is(expectedStatus))
           .andReturn().getResponse().getContentAsString();
    }

    // ── GitLab ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GitLab: missing token or project is a readable 400")
    void gitlabMissingConfig() throws Exception {
        String id = save("GITLAB", "{\"projectId\":\"group/project\"}", true, ownerToken(), workspaceId);
        String body = syncGitLab(id, ownerToken(), workspaceId, 400);
        assertThat(body).contains("access token and project are required");
    }

    @Test
    @DisplayName("GitLab: a hostile project value, an http host, and credentials in the host are all refused")
    void gitlabHostileConfig() throws Exception {
        for (String cfg : new String[]{
                "{\"token\":\"t\",\"projectId\":\"../admin\"}",
                "{\"token\":\"t\",\"projectId\":\"g/p?x=1\"}",
                "{\"token\":\"t\",\"projectId\":\"g/p\",\"host\":\"http://gitlab.example.com\"}",
                "{\"token\":\"t\",\"projectId\":\"g/p\",\"host\":\"https://user:pw@gitlab.example.com\"}"}) {
            String id = save("GITLAB", cfg, true, ownerToken(), workspaceId);
            syncGitLab(id, ownerToken(), workspaceId, 400);
        }
    }

    @Test
    @DisplayName("GitLab: a host pointing at an internal address (loopback, private range, cloud metadata) is refused")
    void gitlabInternalHosts() throws Exception {
        for (String host : new String[]{"https://127.0.0.1", "https://localhost", "https://10.0.0.5", "https://169.254.169.254", "https://[::1]"}) {
            String id = save("GITLAB", "{\"token\":\"t\",\"projectId\":\"g/p\",\"host\":\"" + host + "\"}", true, ownerToken(), workspaceId);
            String body = syncGitLab(id, ownerToken(), workspaceId, 400);
            assertThat(body).contains("GitLab URL");
        }
    }

    @Test
    @DisplayName("GitLab: another workspace's integration can't be synced, and can't be used to spend its token")
    void gitlabForeignIntegration() throws Exception {
        String id = save("GITLAB", "{\"token\":\"t\",\"projectId\":\"g/p\"}", true, ownerToken(), workspaceId);
        syncGitLab(id, otherOwnerToken(), otherWorkspaceId, 404);
    }

    @Test
    @DisplayName("GitLab: syncing needs a login")
    void gitlabNeedsLogin() throws Exception {
        String id = save("GITLAB", "{\"token\":\"t\",\"projectId\":\"g/p\"}", true, ownerToken(), workspaceId);
        mvc.perform(post("/api/integrations/" + id + "/sync/gitlab")).andExpect(status().isUnauthorized());
    }

    // ── Teams ────────────────────────────────────────────────────────────────

    private void teams(String id, String token, String workspace, int expectedStatus) throws Exception {
        mvc.perform(post("/api/integrations/" + id + "/sync/teams")
                .header("Authorization", authHeader(token)).header("X-Workspace-Id", workspace)
                .contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"hello\"}"))
           .andExpect(status().is(expectedStatus));
    }

    @Test
    @DisplayName("Teams: a webhook URL that isn't a Microsoft host is refused (this used to be a way to make the server call any URL)")
    void teamsNonMicrosoftUrl() throws Exception {
        for (String url : new String[]{
                "https://evil.example.com/hook", "http://outlook.office.com/webhook/x", "https://169.254.169.254/latest/meta-data/",
                "https://outlook.office.com@evil.example.com/webhook", "https://webhook.office.com.evil.example.com/x", "not a url"}) {
            String id = save("MICROSOFT_TEAMS", "{\"webhookUrl\":\"" + url + "\"}", true, ownerToken(), workspaceId);
            teams(id, ownerToken(), workspaceId, 400);
        }
    }

    @Test
    @DisplayName("Teams: no webhook URL configured, or the integration switched off, is a 400")
    void teamsNotConfigured() throws Exception {
        String noUrl = save("MICROSOFT_TEAMS", "{}", true, ownerToken(), workspaceId);
        teams(noUrl, ownerToken(), workspaceId, 400);
        String off = save("MICROSOFT_TEAMS", "{\"webhookUrl\":\"https://acme.webhook.office.com/webhookb2/x\"}", false, ownerToken(), workspaceId);
        teams(off, ownerToken(), workspaceId, 400);
    }

    @Test
    @DisplayName("Teams: another workspace's integration can't be used")
    void teamsForeignIntegration() throws Exception {
        String id = save("MICROSOFT_TEAMS", "{\"webhookUrl\":\"https://acme.webhook.office.com/webhookb2/x\"}", true, ownerToken(), workspaceId);
        teams(id, otherOwnerToken(), otherWorkspaceId, 404);
    }

    @Test
    @DisplayName("Teams notify: 400 when Teams isn't connected in this workspace, even if another workspace has connected it")
    void teamsNotifyNotConnected() throws Exception {
        save("MICROSOFT_TEAMS", "{\"webhookUrl\":\"https://acme.webhook.office.com/webhookb2/x\"}", true, otherOwnerToken(), otherWorkspaceId);
        mvc.perform(post("/api/integrations/teams/notify")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"t\",\"message\":\"m\"}"))
           .andExpect(status().isBadRequest());
    }
}
