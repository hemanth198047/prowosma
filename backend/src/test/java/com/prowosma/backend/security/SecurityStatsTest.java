package com.prowosma.backend.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.ActivityLog;
import com.prowosma.backend.repository.ActivityLogRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests the fixed SecurityController.getSecurityStats() method.
 *
 * T1  failedLogins24h is 0 with no failed logins in audit log
 * T2  failedLogins24h counts LOGIN_FAILED events from audit log
 * T3  GET /api/security/2fa/status returns 2FA enabled state
 * T4  GET /api/security/sessions returns user sessions list
 */
@DisplayName("SecurityController — stats and 2FA")
class SecurityStatsTest extends ProwosmaTestBase {

    @Autowired private ActivityLogRepository activityLogRepository;
    @Autowired private ObjectMapper          objectMapper;

    @Test
    @DisplayName("T1: failedLogins24h is 0 with no LOGIN_FAILED events")
    void securityStats_noFailedLogins() throws Exception {
        clearActivityLogs();

        String resp = mvc.perform(get("/api/security/stats")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.get("failedLogins24h").asLong()).isEqualTo(0L);
    }

    @Test
    @DisplayName("T2: failedLogins24h counts LOGIN_FAILED events from activity log")
    void securityStats_countsFailedLogins() throws Exception {
        clearActivityLogs();

        // Seed 3 LOGIN_FAILED events
        for (int i = 0; i < 3; i++) {
            ActivityLog log = new ActivityLog();
            log.setOrganizationId(workspaceId);
            log.setAction("LOGIN_FAILED");
            log.setEntityType("USER");
            log.setSeverity("CRITICAL");
            log.setCreatedAt(LocalDateTime.now().minusMinutes(i * 10));
            activityLogRepository.save(log);
        }

        String resp = mvc.perform(get("/api/security/stats")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.get("failedLogins24h").asLong()).isEqualTo(3L);
    }

    @Test
    @DisplayName("T3: GET /api/security/2fa/status returns enabled state")
    void get2faStatus() throws Exception {
        String resp = mvc.perform(get("/api/security/2fa/status")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.has("enabled")).isTrue();
    }

    @Test
    @DisplayName("T4: GET /api/security/sessions returns array")
    void getSessions_returnsList() throws Exception {
        String resp = mvc.perform(get("/api/security/sessions")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();

        // Should be a JSON array (may be empty if no sessions recorded)
        JsonNode json = objectMapper.readTree(resp);
        assertThat(json.isArray()).isTrue();
    }
}
