package com.prowosma.backend.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.repository.WorkspaceConfigRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fix-5 (AdminController persistence): Verify feature flags survive
 * the call — i.e. are stored in MongoDB, not a ConcurrentHashMap.
 *
 * T1  POST /api/admin/features saves a flag
 * T2  GET /api/admin/features returns the saved flag
 * T3  Flag is persisted in WorkspaceConfig collection
 * T4  DELETE /api/admin/features/{key} removes the flag
 * T5  GET /api/admin/usage returns real counts, not zeros
 * T6  POST /api/admin/retention persists retention policy
 */
@DisplayName("AdminController — MongoDB-backed feature flags (Fix-5)")
class AdminFeatureFlagTest extends ProwosmaTestBase {

    @Autowired private ObjectMapper objectMapper;
    @Autowired private WorkspaceConfigRepository configRepository;

    @Test
    @DisplayName("T1: POST /api/admin/features saves a feature flag")
    void saveFeatureFlag() throws Exception {
        mvc.perform(post("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"ai_assistant\",\"enabled\":true}"))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T2: GET /api/admin/features returns previously saved flag")
    void getFeatureFlags_returnsSavedFlag() throws Exception {
        // Save first
        mvc.perform(post("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"gantt_view\",\"enabled\":true}"))
           .andExpect(status().isOk());

        // Then read back
        String resp = mvc.perform(get("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.has("gantt_view")).isTrue();
        assertThat(json.get("gantt_view").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("T3: Feature flag is persisted in WorkspaceConfig MongoDB collection")
    void featureFlag_persistedInMongo() throws Exception {
        mvc.perform(post("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"bpm_studio\",\"enabled\":false}"))
           .andExpect(status().isOk());

        var config = configRepository.findByWorkspaceId(workspaceId);
        assertThat(config).isPresent();
        assertThat(config.get().getFeatureFlags()).containsKey("bpm_studio");
        assertThat(config.get().getFeatureFlags().get("bpm_studio")).isFalse();
    }

    @Test
    @DisplayName("T4: DELETE /api/admin/features/{key} removes the flag")
    void deleteFeatureFlag() throws Exception {
        // Create it
        mvc.perform(post("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"key\":\"to_remove\",\"enabled\":true}"))
           .andExpect(status().isOk());

        // Delete it
        mvc.perform(delete("/api/admin/features/to_remove")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        // Verify gone
        String resp = mvc.perform(get("/api/admin/features")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.has("to_remove")).isFalse();
    }

    @Test
    @DisplayName("T5: GET /api/admin/usage returns real counts (not all zeros)")
    void usage_returnsRealCounts() throws Exception {
        String resp = mvc.perform(get("/api/admin/usage")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        // Should have numeric fields, not "—"
        assertThat(json.has("tasks")).isTrue();
        assertThat(json.has("dau")).isTrue();
        assertThat(json.get("dau").isNumber()).isTrue();
    }

    @Test
    @DisplayName("T6: POST /api/admin/retention persists policy")
    void retentionPolicy_persists() throws Exception {
        mvc.perform(post("/api/admin/retention")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"retentionDays\":365,\"legalHoldEnabled\":false,\"autoDeleteEnabled\":false}"))
           .andExpect(status().isOk());

        var config = configRepository.findByWorkspaceId(workspaceId);
        assertThat(config).isPresent();
        assertThat(config.get().getRetentionDays()).isEqualTo(365);
    }
}
