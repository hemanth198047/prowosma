package com.prowosma.backend.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.prowosma.backend.model.Notification;
import com.prowosma.backend.model.Task;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.NotificationRepository;
import com.prowosma.backend.repository.TaskRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end tenant isolation, through the real filters and the real Spring wiring.
 * Every scenario here was a genuine cross-workspace leak or write before the tenant guard
 * and the scoping fixes; each one seeds another workspace's real data so a regression
 * shows up as that data appearing, changing or disappearing.
 */
@DisplayName("Tenant isolation — end to end")
class TenantIsolationTest extends TwoWorkspaceTestBase {

    @Autowired private TaskRepository         taskRepository;
    @Autowired private NotificationRepository notificationRepository;
    @Autowired private ObjectMapper           objectMapper;

    private Task task(String workspace, String title) {
        Task t = new Task();
        t.setOrganizationId(workspace);
        t.setTitle(title);
        return taskRepository.save(t);
    }

    private Notification notification(String workspace, String title) {
        Notification n = new Notification();
        n.setOrganizationId(workspace);
        n.setTitle(title);
        n.setMessage("body of " + title);
        n.setRead(false);
        return notificationRepository.save(n);
    }

    // ── the guard is actually installed ──────────────────────────────────────

    @Test
    @DisplayName("workspace-owned repositories are wrapped by the tenant guard; User and Workspace are not")
    void guardIsInstalled() {
        assertThat(taskRepository.toString()).startsWith("TenantGuard[");
        assertThat(notificationRepository.toString()).startsWith("TenantGuard[");
        assertThat(userRepository.toString()).doesNotStartWith("TenantGuard[");
        assertThat(workspaceRepository.toString()).doesNotStartWith("TenantGuard[");
    }

    // ── by-id access (the repository guard) ──────────────────────────────────

    @Test
    @DisplayName("a task in another workspace can't be read by id — with the header, or with the header left out")
    void foreignTask_cannotBeRead() throws Exception {
        Task foreign = task(otherWorkspaceId, "secret roadmap");

        String withHeader = mvc.perform(get("/api/tasks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken()))
                .header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound())
           .andReturn().getResponse().getContentAsString();
        assertThat(withHeader).doesNotContain("secret roadmap");

        // Leaving the header out used to skip every check and return the task.
        String withoutHeader = mvc.perform(get("/api/tasks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isNotFound())
           .andReturn().getResponse().getContentAsString();
        assertThat(withoutHeader).doesNotContain("secret roadmap");
    }

    @Test
    @DisplayName("a task in another workspace can't be edited or deleted by id")
    void foreignTask_cannotBeChangedOrDeleted() throws Exception {
        Task foreign = task(otherWorkspaceId, "untouchable");

        mvc.perform(put("/api/tasks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"hijacked\"}"))
           .andExpect(status().isNotFound());
        mvc.perform(patch("/api/tasks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"hijacked\"}"))
           .andExpect(status().isNotFound());
        mvc.perform(delete("/api/tasks/" + foreign.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());

        Task after = taskRepository.findById(foreign.getId()).orElseThrow();
        assertThat(after.getTitle()).isEqualTo("untouchable");
    }

    @Test
    @DisplayName("a task in the caller's own workspace still works")
    void ownTask_stillWorks() throws Exception {
        Task mine = task(workspaceId, "my task");

        mvc.perform(get("/api/tasks/" + mine.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        mvc.perform(delete("/api/tasks/" + mine.getId())
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        assertThat(taskRepository.findById(mine.getId())).isEmpty();
    }

    // ── notifications: no global fallback, no cross-workspace bulk actions ───

    @Test
    @DisplayName("notifications: leaving out the workspace header no longer returns every workspace's notifications")
    void notifications_noHeader_returnsNothing() throws Exception {
        notification(otherWorkspaceId, "leak-check");
        notification(workspaceId, "mine");

        String list = mvc.perform(get("/api/notifications")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        assertThat(objectMapper.readTree(list).size()).isEqualTo(0);

        String count = mvc.perform(get("/api/notifications/count")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        assertThat(objectMapper.readTree(count).get("count").asLong()).isEqualTo(0L);
    }

    @Test
    @DisplayName("notifications: 'clear all' and 'mark all read' only touch the caller's workspace")
    void notifications_bulkActionsStayInWorkspace() throws Exception {
        Notification mine = notification(workspaceId, "mine");
        Notification foreign = notification(otherWorkspaceId, "foreign");

        mvc.perform(patch("/api/notifications/read-all")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        assertThat(notificationRepository.findById(mine.getId()).orElseThrow().isRead()).isTrue();
        assertThat(notificationRepository.findById(foreign.getId()).orElseThrow().isRead()).isFalse();

        mvc.perform(delete("/api/notifications")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk());
        assertThat(notificationRepository.findById(mine.getId())).isEmpty();
        assertThat(notificationRepository.findById(foreign.getId())).isPresent();     // used to be wiped too
    }

    // ── security dashboard: workspace users only ─────────────────────────────

    @Test
    @DisplayName("security dashboard: sessions and user counts cover this workspace's users, not the whole platform")
    void securityDashboard_isWorkspaceScoped() throws Exception {
        User outsider = new User();
        outsider.setEmail("outsider@elsewhere.com");
        outsider.setName("Outsider");
        outsider.setPassword(passwordEncoder.encode("pass"));
        outsider.setRole("USER");
        outsider.setLoginSessions(new ArrayList<>(List.of(session("203.0.113.9", "Firefox / Linux"))));
        userRepository.save(outsider);

        User member = userRepository.findByEmail(memberEmail).orElseThrow();
        member.setLoginSessions(new ArrayList<>(List.of(session("198.51.100.7", "Chrome / macOS"))));
        userRepository.save(member);

        String sessions = mvc.perform(get("/api/security/sessions/all")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        List<String> emails = new ArrayList<>();
        objectMapper.readTree(sessions).get("data").forEach(n -> emails.add(n.get("email").asText()));
        assertThat(emails).contains(memberEmail);                       // proves the endpoint isn't just empty
        assertThat(emails).doesNotContain("outsider@elsewhere.com", otherOwnerEmail);

        String stats = mvc.perform(get("/api/security/stats")
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isOk())
           .andReturn().getResponse().getContentAsString();
        JsonNode json = objectMapper.readTree(stats);
        assertThat(json.get("totalUsers").asLong()).isEqualTo(3L);      // owner + admin + member, not the 5 users that exist
    }

    private static User.LoginSession session(String ip, String agent) {
        User.LoginSession s = new User.LoginSession();
        s.setIpAddress(ip);
        s.setUserAgent(agent);
        return s;
    }

    // ── team lookup by email ─────────────────────────────────────────────────

    @Test
    @DisplayName("team by-email: no workspace means no lookup, and other workspaces' members can't be enumerated")
    void teamByEmail_isScoped() throws Exception {
        TeamMember elsewhere = new TeamMember();
        elsewhere.setOrganizationId(otherWorkspaceId);
        elsewhere.setEmail("someone@elsewhere.com");
        elsewhere.setName("Someone Elsewhere");
        elsewhere.setRole("ADMIN");
        teamMemberRepository.save(elsewhere);

        // No workspace at all used to search every workspace for that email.
        mvc.perform(get("/api/team/by-email?email=someone@elsewhere.com")
                .header("Authorization", authHeader(ownerToken())))
           .andExpect(status().isNotFound());

        // Naming another workspace explicitly used to work for any caller.
        mvc.perform(get("/api/team/by-email?email=someone@elsewhere.com&workspaceId=" + otherWorkspaceId)
                .header("Authorization", authHeader(ownerToken())).header("X-Workspace-Id", workspaceId))
           .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("team by-email: a user can still resolve their own role, even before the workspace header is set (RoleContext's first load)")
    void teamByEmail_selfLookupStillWorks() throws Exception {
        mvc.perform(get("/api/team/by-email?email=" + memberEmail + "&workspaceId=" + workspaceId)
                .header("Authorization", authHeader(memberToken())))
           .andExpect(status().isOk());
    }
}
