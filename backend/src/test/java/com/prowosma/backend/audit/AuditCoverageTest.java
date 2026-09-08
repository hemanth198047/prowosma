package com.prowosma.backend.audit;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.repository.ActivityLogRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies that the newly wired audit log services actually emit events.
 *
 * T1  POST /api/sprints → CREATED in audit log
 * T2  DELETE /api/sprints/{id} → DELETED in audit log
 * T3  POST /api/categories → CREATED in audit log
 * T4  POST /api/api-keys → API_KEY_CREATED in audit log
 * T5  POST /api/docs → CREATED in audit log (DocService)
 * T6  Audit log export CSV endpoint is accessible and returns CSV headers
 */
@DisplayName("Audit log coverage — newly wired services")
class AuditCoverageTest extends ProwosmaTestBase {

    @Autowired private ActivityLogRepository activityLogRepository;

    @BeforeEach
    void clearLogs() { clearActivityLogs(); }

    @Test
    @DisplayName("T1: POST /api/sprints writes CREATED audit log")
    void sprint_create_audit() throws Exception {
        mvc.perform(post("/api/sprints")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Sprint 1\",\"goal\":\"Ship MVP\"}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "CREATED".equals(l.getAction()) && "SPRINT".equals(l.getEntityType()));
    }

    @Test
    @DisplayName("T2: DELETE /api/sprints/{id} writes DELETED audit log")
    void sprint_delete_audit() throws Exception {
        // Create first
        String resp = mvc.perform(post("/api/sprints")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Sprint Del\",\"goal\":\"Delete me\"}"))
           .andReturn().getResponse().getContentAsString();

        String id = com.fasterxml.jackson.databind.node.ObjectNode.class
            .cast(new com.fasterxml.jackson.databind.ObjectMapper().readTree(resp)).get("id").asText();

        clearActivityLogs();

        mvc.perform(delete("/api/sprints/" + id)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "DELETED".equals(l.getAction()) && "SPRINT".equals(l.getEntityType()));
    }

    @Test
    @DisplayName("T3: POST /api/categories writes CREATED audit log")
    void category_create_audit() throws Exception {
        mvc.perform(post("/api/categories")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Frontend\",\"color\":\"#6366f1\"}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "CREATED".equals(l.getAction()) && "CATEGORY".equals(l.getEntityType()));
    }

    @Test
    @DisplayName("T4: POST /api/api-keys writes API_KEY_CREATED audit log")
    void apiKey_create_audit() throws Exception {
        mvc.perform(post("/api/api-keys")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"CI Key\",\"scopes\":[\"tasks:read\"]}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "API_KEY_CREATED".equals(l.getAction()));
    }

    @Test
    @DisplayName("T5: POST /api/docs writes CREATED audit log")
    void doc_create_audit() throws Exception {
        mvc.perform(post("/api/docs")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"RFC 001\",\"workspaceId\":\"" + workspaceId + "\"}"))
           .andExpect(status().isOk());

        List<ActivityLog> logs = activityLogRepository.findByOrganizationId(workspaceId);
        assertThat(logs).anyMatch(l -> "CREATED".equals(l.getAction()) && "DOC".equals(l.getEntityType()));
    }

    @Test
    @DisplayName("T6: GET /api/activity-logs/export/csv returns CSV with headers")
    void auditLog_csvExport_hasHeaders() throws Exception {
        // Seed one log
        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Export Test\",\"status\":\"TODO\",\"priority\":\"LOW\"}"))
           .andExpect(status().isOk());

        String csv = mvc.perform(get("/api/activity-logs/export/csv")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        // CSV must have headers
        assertThat(csv).contains("Date,Time,Performed By,Action");
    }
}
