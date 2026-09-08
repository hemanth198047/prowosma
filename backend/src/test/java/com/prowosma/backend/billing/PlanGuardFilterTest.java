package com.prowosma.backend.billing;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies PlanGuardFilter actually blocks paid-tier-only features on the
 * FREE plan (the default for every workspace created by ProwosmaTestBase)
 * rather than the pricing page being purely cosmetic — this filter existed
 * before this test did, but had no automated coverage confirming it
 * actually fires.
 */
@DisplayName("PlanGuardFilter — plan-tier feature gating")
class PlanGuardFilterTest extends ProwosmaTestBase {

    @Test
    @DisplayName("FREE plan: PUT /api/workspaces/branding is blocked with 402 UPGRADE_REQUIRED")
    void freeplan_whiteLabelBlocked() throws Exception {
        mvc.perform(put("/api/workspaces/branding")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"primaryColor\":\"#123456\"}"))
           .andExpect(status().isPaymentRequired())
           .andExpect(jsonPath("$.error").value("UPGRADE_REQUIRED"));
    }

    @Test
    @DisplayName("GET requests are never blocked by the plan guard, even for gated features")
    void getRequests_alwaysPass() throws Exception {
        // Regression guard for the filter's own "GET/OPTIONS always pass through" shortcut —
        // a read of branding settings should never require an upgrade, only writing.
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .get("/api/workspaces/branding")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(result -> {
               int status = result.getResponse().getStatus();
               org.junit.jupiter.api.Assertions.assertNotEquals(402, status,
                   "GET requests must never be blocked by PlanGuardFilter");
           });
    }
}
