package com.prowosma.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** GET /api/ai/status: any signed-in person may read it, it is per workspace, and it never contains the API key. */
@DisplayName("GET /api/ai/status")
class AIStatusApiTest extends TwoWorkspaceTestBase {

    private final ObjectMapper om = new ObjectMapper();

    private static final String SECRET = "sk-ant-api03-VERY-SECRET-KEY-VALUE";

    private MvcResult status(String token, String ws) throws Exception {
        return mvc.perform(get("/api/ai/status").header("Authorization", "Bearer " + token).header("X-Workspace-Id", ws)).andReturn();
    }

    private void saveSettings(String token, String ws, String json) throws Exception {
        mvc.perform(post("/api/ai/settings").header("Authorization", "Bearer " + token).header("X-Workspace-Id", ws)
                .contentType(MediaType.APPLICATION_JSON).content(json)).andReturn();
    }

    private JsonNode body(MvcResult r) throws Exception { return om.readTree(r.getResponse().getContentAsString()); }

    @Test @DisplayName("is OFF by default, NEEDS_SETUP without a key, ON with one — and the key is never in any response")
    void walkThroughTheStates() throws Exception {
        MvcResult fresh = status(memberToken(), workspaceId);
        assertThat(fresh.getResponse().getStatus()).isEqualTo(200);
        assertThat(body(fresh).get("state").asText()).isEqualTo("OFF");

        saveSettings(ownerToken(), workspaceId, "{\"aiEnabled\":true,\"apiKey\":\"\",\"apiProvider\":\"ANTHROPIC\",\"model\":\"claude-sonnet-4-20250514\"}");
        assertThat(body(status(memberToken(), workspaceId)).get("state").asText()).isEqualTo("NEEDS_SETUP");

        saveSettings(ownerToken(), workspaceId, "{\"aiEnabled\":true,\"apiKey\":\"" + SECRET + "\",\"apiProvider\":\"ANTHROPIC\",\"model\":\"claude-sonnet-4-20250514\"}");
        MvcResult on = status(memberToken(), workspaceId);
        assertThat(body(on).get("state").asText()).isEqualTo("ON");
        assertThat(body(on).get("provider").asText()).isEqualTo("ANTHROPIC");
        assertThat(on.getResponse().getContentAsString()).doesNotContain(SECRET).doesNotContain("VERY-SECRET").doesNotContain("apiKey");

        saveSettings(ownerToken(), workspaceId, "{\"aiEnabled\":false,\"apiKey\":\"" + SECRET + "\",\"apiProvider\":\"ANTHROPIC\"}");
        assertThat(body(status(memberToken(), workspaceId)).get("state").asText()).isEqualTo("OFF");        // off wins even though a key is saved
    }

    @Test @DisplayName("each workspace sees only its own state")
    void perWorkspace() throws Exception {
        saveSettings(ownerToken(), workspaceId, "{\"aiEnabled\":true,\"apiKey\":\"" + SECRET + "\",\"apiProvider\":\"ANTHROPIC\"}");
        assertThat(body(status(memberToken(), workspaceId)).get("state").asText()).isEqualTo("ON");
        assertThat(body(status(otherOwnerToken(), otherWorkspaceId)).get("state").asText()).isEqualTo("OFF");
    }

    @Test @DisplayName("requires sign-in")
    void needsAuthentication() throws Exception {
        assertThat(mvc.perform(get("/api/ai/status")).andReturn().getResponse().getStatus()).isIn(401, 403);
    }
}
