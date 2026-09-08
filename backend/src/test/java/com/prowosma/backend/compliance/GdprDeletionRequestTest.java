package com.prowosma.backend.compliance;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies POST /api/security/gdpr/delete-request actually records and
 * schedules a real deletion, rather than returning a promised deletion
 * date that nothing backs — see SecurityController's own comment on
 * this fix, and GdprDeletionSchedulerService for what acts on it.
 */
@DisplayName("GDPR deferred deletion request")
class GdprDeletionRequestTest extends ProwosmaTestBase {

    @Test
    @DisplayName("Requesting deletion actually persists a scheduled deletion date ~30 days out")
    void requestDeletion_persistsScheduledDate() throws Exception {
        mvc.perform(post("/api/security/gdpr/delete-request")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        var user = userRepository.findByEmail(ownerEmail).orElseThrow();
        assertNotNull(user.getGdprDeletionRequestedAt(), "Request timestamp must actually be persisted");
        assertNotNull(user.getGdprDeletionScheduledFor(), "Scheduled deletion date must actually be persisted");

        long daysOut = java.time.Duration.between(LocalDateTime.now(), user.getGdprDeletionScheduledFor()).toDays();
        assertTrue(daysOut >= 29 && daysOut <= 30, "Should be scheduled ~30 days out, was " + daysOut);
    }

    @Test
    @DisplayName("Cancelling a pending request clears the schedule — account is no longer at risk of deletion")
    void cancelRequest_clearsSchedule() throws Exception {
        mvc.perform(post("/api/security/gdpr/delete-request")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        assertNotNull(userRepository.findByEmail(ownerEmail).orElseThrow().getGdprDeletionScheduledFor());

        mvc.perform(post("/api/security/gdpr/delete-request/cancel")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());

        assertNull(userRepository.findByEmail(ownerEmail).orElseThrow().getGdprDeletionScheduledFor());
    }

    @Test
    @DisplayName("Cancelling with no pending request returns 400, not a false success")
    void cancelWithNoPendingRequest_returns400() throws Exception {
        mvc.perform(post("/api/security/gdpr/delete-request/cancel")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isBadRequest());
    }
}
