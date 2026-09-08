package com.prowosma.backend.region;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.Workspace;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies the data-residency honesty fix: a workspace must not be able
 * to declare a data region this deployment has no real infrastructure
 * for. Without MONGODB_URI_EU/US/UK/APAC set (the test profile sets
 * none), every region except "UNSET" must be rejected — the whole point
 * being that a region dropdown must never silently imply a compliance
 * guarantee that isn't real.
 */
@DisplayName("WorkspaceService — data region enforcement")
class DataRegionEnforcementTest extends ProwosmaTestBase {

    @Autowired private com.prowosma.backend.service.WorkspaceService workspaceService;

    @Test
    @DisplayName("Declaring a region with no configured infrastructure is rejected (no test region URIs are set)")
    void declaringUnbackedRegion_isRejected() throws Exception {
        Workspace update = new Workspace();
        update.setDataRegion("EU");

        mvc.perform(put("/api/workspaces/" + workspaceId)
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"dataRegion\":\"EU\"}"))
           .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Declaring UNSET is always allowed, even with no region infrastructure configured")
    void declaringUnset_isAlwaysAllowed() {
        Workspace ws = workspaceService.getById(workspaceId);
        ws.setDataRegion("UNSET");
        // Direct service call (not via the same-region-so-no-op HTTP path) —
        // proves the service method itself never rejects "UNSET".
        org.junit.jupiter.api.Assertions.assertDoesNotThrow(() -> workspaceService.update(workspaceId, ws));
    }
}
