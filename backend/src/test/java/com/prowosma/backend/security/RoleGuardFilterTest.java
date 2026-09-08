package com.prowosma.backend.security;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.repository.TeamMemberRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Fix-4: Security smoke tests for RoleGuardFilter.
 *
 * Covers:
 *   T1  OWNER can POST tasks
 *   T2  VIEWER is blocked from POST tasks → 403
 *   T3  MEMBER cannot POST to /api/team → 403
 *   T4  ADMIN can POST to /api/team → not 403
 *   T5  Unauthenticated workspace DELETE → 401
 *   T6  VIEWER can GET tasks → 200
 */
@DisplayName("RoleGuardFilter — role enforcement")
class RoleGuardFilterTest extends ProwosmaTestBase {

    @Autowired
    private TeamMemberRepository teamMemberRepository;

    private static final String TASK_JSON =
        "{\"title\":\"Test Task\",\"status\":\"TODO\",\"priority\":\"MEDIUM\"}";

    @Test
    @DisplayName("T1: OWNER can POST /api/tasks")
    void owner_canCreateTask() throws Exception {
        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK_JSON))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T2: VIEWER is blocked from POST /api/tasks → 403")
    void viewer_blockedFromMutation() throws Exception {
        upsert(viewerMember());

        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(TASK_JSON))
           .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("T3: MEMBER cannot POST /api/team → 403")
    void member_cannotManageTeam() throws Exception {
        upsert(regularMember());

        mvc.perform(post("/api/team")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"new@test.com\",\"role\":\"MEMBER\"}"))
           .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("T4: ADMIN can POST /api/team (not 403)")
    void admin_canManageTeam() throws Exception {
        upsert(adminMember());

        int statusCode = mvc.perform(post("/api/team")
                .header("Authorization", authHeader(adminToken()))
                .header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"new2@test.com\",\"role\":\"MEMBER\",\"name\":\"New\"}"))
           .andReturn().getResponse().getStatus();
        assertNotEquals(403, statusCode, "ADMIN should not be forbidden from /api/team");
    }

    @Test
    @DisplayName("T5: Unauthenticated workspace DELETE → 401")
    void unauthenticated_workspaceDelete_isForbidden() throws Exception {
        // 401, not 403: with SecurityConfig now enforcing .authenticated()
        // at the Spring Security layer (see SecurityConfigTest), a request
        // with no credentials at all is rejected before it ever reaches
        // WorkspaceController - it never gets the chance to make its own
        // "you're not the owner" 403 decision. 401 is also the more
        // correct status here regardless: this is "who are you", not
        // "you're not allowed".
        mvc.perform(delete("/api/workspaces/" + workspaceId)
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("T6: VIEWER can GET /api/tasks → 200")
    void viewer_canReadTasks() throws Exception {
        upsert(viewerMember());

        mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
    }

    // ── Helpers ───────────────────────────────────────────────

    /**
     * Idempotent save - if a TeamMember already exists for this exact
     * (organizationId, email) pair, updates its role instead of inserting
     * a second row. workspaceId is freshly randomized per test in
     * baseSetup(), so in the normal case this is just a plain insert; this
     * only matters if team_members ever ends up non-empty for that pair
     * before this line runs, which the blind save() used to turn into a
     * raw DuplicateKeyException failing the test for a reason unrelated to
     * what it's actually verifying (role enforcement).
     */
    private TeamMember upsert(TeamMember member) {
        return teamMemberRepository
                .findAllByEmailAndOrganizationId(member.getEmail(), member.getOrganizationId())
                .stream().findFirst()
                .map(existing -> {
                    existing.setRole(member.getRole());
                    return teamMemberRepository.save(existing);
                })
                .orElseGet(() -> teamMemberRepository.save(member));
    }

    private TeamMember viewerMember() {
        TeamMember m = new TeamMember();
        m.setEmail(memberEmail); m.setOrganizationId(workspaceId); m.setRole("VIEWER");
        return m;
    }
    private TeamMember regularMember() {
        TeamMember m = new TeamMember();
        m.setEmail(memberEmail); m.setOrganizationId(workspaceId); m.setRole("MEMBER");
        return m;
    }
    private TeamMember adminMember() {
        TeamMember m = new TeamMember();
        m.setEmail(adminEmail); m.setOrganizationId(workspaceId); m.setRole("ADMIN");
        return m;
    }
}
