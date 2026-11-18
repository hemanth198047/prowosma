package com.prowosma.backend.project;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.Project;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.tenant.TwoWorkspaceTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Archiving a project through the API: it was a button with no server behind it. */
class ProjectArchiveTest extends TwoWorkspaceTestBase {
    @Autowired ObjectMapper om;
    String projectId;

    @BeforeEach
    void project() {
        Project p = new Project();
        p.setOrganizationId(workspaceId); p.setName("Diwali ad shoot"); p.setStatus("PAUSED"); p.setCreatedBy(ownerEmail);
        projectId = mongoTemplate.save(p).getId();
    }

    MvcResult call(String path, String token, String ws) throws Exception {
        return mvc.perform(post("/api/projects/" + projectId + path).header("Authorization", authHeader(token)).header("X-Workspace-Id", ws)).andReturn();
    }

    @Test
    void archiveKeepsTheProject_andUnarchiveRestoresItsStatus() throws Exception {
        MvcResult r = call("/archive", ownerToken(), workspaceId);
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode a = om.readTree(r.getResponse().getContentAsString());
        assertThat(a.get("archived").asBoolean()).isTrue();
        assertThat(a.get("status").asText()).isEqualTo("ARCHIVED");
        Project stored = mongoTemplate.findById(projectId, Project.class);
        assertThat(stored.getArchivedBy()).isEqualTo(ownerEmail);
        assertThat(stored.getArchivedAt()).isNotNull();

        assertThat(call("/archive", ownerToken(), workspaceId).getResponse().getStatus()).isEqualTo(200);   // twice is harmless
        assertThat(mongoTemplate.findById(projectId, Project.class).getStatusBeforeArchive()).isEqualTo("PAUSED");

        JsonNode u = om.readTree(call("/unarchive", ownerToken(), workspaceId).getResponse().getContentAsString());
        assertThat(u.get("archived").asBoolean()).isFalse();
        assertThat(u.get("status").asText()).isEqualTo("PAUSED");
        assertThat(mongoTemplate.findById(projectId, Project.class).getArchivedAt()).isNull();
    }

    @Test
    void adminsCanArchive_viewersCant() throws Exception {
        assertThat(call("/archive", adminToken(), workspaceId).getResponse().getStatus()).isEqualTo(200);
        User v = new User(); v.setEmail("viewer@test.com"); v.setName("V"); v.setPassword(passwordEncoder.encode("pass")); v.setRole("USER");
        userRepository.save(v);
        TeamMember tm = new TeamMember(); tm.setOrganizationId(workspaceId); tm.setEmail("viewer@test.com"); tm.setName("V"); tm.setRole("VIEWER");
        teamMemberRepository.save(tm);
        assertThat(call("/unarchive", jwtUtil.generateToken("viewer@test.com"), workspaceId).getResponse().getStatus()).isEqualTo(403);
        assertThat(mongoTemplate.findById(projectId, Project.class).isArchived()).isTrue();
    }

    @Test
    void anotherWorkspaceCantArchiveIt() throws Exception {
        int status = call("/archive", otherOwnerToken(), otherWorkspaceId).getResponse().getStatus();
        assertThat(status).isBetween(400, 499);
        assertThat(mongoTemplate.findById(projectId, Project.class).isArchived()).isFalse();
    }
}
