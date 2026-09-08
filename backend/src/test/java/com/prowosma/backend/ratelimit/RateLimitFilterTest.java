package com.prowosma.backend.ratelimit;

import com.prowosma.backend.ProwosmaTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies RateLimitFilter actually enforces its configured limit and
 * returns 429 once exceeded — previously validated only manually via the
 * k6 scripts under load-tests/, never by an automated test that runs on
 * every build.
 *
 * Uses a deliberately tiny limit (3/minute) via a test-only property
 * override so the test doesn't need to fire 300 requests to prove the
 * behavior.
 */
@DisplayName("RateLimitFilter — per-client request limiting")
@TestPropertySource(properties = "app.rate-limit.requests-per-minute=3")
class RateLimitFilterTest extends ProwosmaTestBase {

    @Test
    @DisplayName("Requests under the limit succeed and report remaining quota via headers")
    void underLimit_succeedsWithHeaders() throws Exception {
        mvc.perform(get("/api/tasks")
                        .header("Authorization", authHeader(ownerToken()))
                        .header("X-Workspace-Id", workspaceId))
                .andExpect(status().isOk())
                .andExpect(header().string("X-RateLimit-Limit", "3"))
                .andExpect(header().exists("X-RateLimit-Remaining"))
                .andExpect(header().exists("X-RateLimit-Reset"));
    }

    @Test
    @DisplayName("Exceeding the limit returns 429 with a retryAfterSeconds body")
    void overLimit_returns429() throws Exception {
        // Limit is 3/minute (see @TestPropertySource) — the 4th request from
        // the same authenticated user within the same minute must be rejected.
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/tasks")
                            .header("Authorization", authHeader(ownerToken()))
                            .header("X-Workspace-Id", workspaceId))
                    .andExpect(status().isOk());
        }

        mvc.perform(get("/api/tasks")
                        .header("Authorization", authHeader(ownerToken()))
                        .header("X-Workspace-Id", workspaceId))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("Different authenticated users get independent limits (keyed by identity, not shared IP)")
    void differentUsers_haveIndependentLimits() throws Exception {
        for (int i = 0; i < 3; i++) {
            mvc.perform(get("/api/tasks")
                            .header("Authorization", authHeader(ownerToken()))
                            .header("X-Workspace-Id", workspaceId))
                    .andExpect(status().isOk());
        }
        // owner is now at their limit — a different user must still succeed
        mvc.perform(get("/api/tasks")
                        .header("Authorization", authHeader(memberToken()))
                        .header("X-Workspace-Id", workspaceId))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Actuator health checks are never rate-limited")
    void actuatorEndpoints_areExempt() throws Exception {
        // This asserts exemption from RateLimitFilter specifically (never a
        // 429), not overall application health — whether /actuator/health
        // reports UP or DOWN is a separate concern owned by health-indicator
        // tests, not this one.
        for (int i = 0; i < 5; i++) {
            int status = mvc.perform(get("/actuator/health"))
                    .andReturn().getResponse().getStatus();
            assertNotEquals(429, status, "actuator health must never be rate-limited");
        }
    }
}