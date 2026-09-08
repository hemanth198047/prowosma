package com.prowosma.backend.security;

import com.prowosma.backend.ProwosmaTestBase;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers the tenant-isolation vulnerability found and fixed earlier in this
 * project: WorkspaceFilter used to copy the client-supplied X-Workspace-Id
 * header into request scope with no check that the caller actually belonged
 * to that workspace, and RoleGuardFilter separately defaulted a non-member
 * to "MEMBER" instead of denying them — together, any authenticated user
 * could read or write any other workspace's data just by sending its ID.
 *
 * Neither of the existing security test files (RoleGuardFilterTest,
 * SecurityConfigTest) actually exercised this specific scenario — they
 * test role *levels* within a workspace the caller already belongs to, not
 * cross-workspace access by someone with no relationship to the target
 * workspace at all. This is that missing coverage, so a future change
 * can't silently reopen the hole without a test failing.
 */
@DisplayName("Workspace isolation — cross-tenant access must be denied")
class WorkspaceIsolationTest extends ProwosmaTestBase {

    @Autowired private TeamMemberRepository teamMemberRepository;

    /**
     * Creates a second workspace, owned by a user who has nothing to do
     * with the primary workspace/users ProwosmaTestBase already set up —
     * the "other tenant" in every test below.
     */
    private String createOtherWorkspace() {
        Workspace ws = new Workspace();
        ws.setId(UUID.randomUUID().toString());
        ws.setName("Other Tenant's Workspace");
        ws.setOwnerEmail("other-tenant-owner@test.com");
        ws.setCurrency("USD");
        ws.setDateFormat("MM/DD/YYYY");
        return workspaceRepository.save(ws).getId();
    }

    @Test
    @DisplayName("T1: A non-member reading another workspace's tasks is forbidden, not silently empty")
    void nonMember_cannotReadOtherWorkspacesTasks() throws Exception {
        String otherWorkspaceId = createOtherWorkspace();

        // memberEmail belongs to the PRIMARY workspace (via ProwosmaTestBase),
        // not this one — this is exactly the attack: a real, valid, logged-in
        // user pointing their token at a workspace they were never invited to.
        mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("T2: A non-member creating a task in another workspace is forbidden")
    void nonMember_cannotWriteToOtherWorkspace() throws Exception {
        String otherWorkspaceId = createOtherWorkspace();

        mvc.perform(post("/api/tasks")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", otherWorkspaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"Injected Task\",\"status\":\"TODO\",\"priority\":\"MEDIUM\"}"))
           .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("T3: The actual owner of that other workspace CAN access it")
    void actualOwner_canAccessTheirOwnOtherWorkspace() throws Exception {
        String otherWorkspaceId = createOtherWorkspace();
        String otherOwnerToken = jwtUtil.generateToken("other-tenant-owner@test.com");

        // Sanity check that the fix denies non-members (T1/T2) without also
        // accidentally denying everyone — the actual owner must still get in.
        mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(otherOwnerToken))
                .header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T4: A real TeamMember of the other workspace (not just its owner) CAN access it")
    void actualTeamMember_canAccessTheWorkspaceTheyBelongTo() throws Exception {
        String otherWorkspaceId = createOtherWorkspace();

        // memberEmail is NOT a member of this workspace yet — add them for
        // real this time, then confirm they're let in. Proves the check is
        // "are you actually a member", not just "are you the owner".
        TeamMember m = new TeamMember();
        m.setEmail(memberEmail);
        m.setOrganizationId(otherWorkspaceId);
        m.setRole("MEMBER");
        teamMemberRepository.save(m);

        mvc.perform(get("/api/tasks")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isOk());
    }

    @Test
    @DisplayName("T5: Cross-tenant isolation holds for a second resource type too (projects), not just tasks")
    void nonMember_cannotReadOtherWorkspacesProjects() throws Exception {
        String otherWorkspaceId = createOtherWorkspace();

        mvc.perform(get("/api/projects")
                .header("Authorization", authHeader(memberToken()))
                .header("X-Workspace-Id", otherWorkspaceId))
           .andExpect(status().isForbidden());
    }
}
