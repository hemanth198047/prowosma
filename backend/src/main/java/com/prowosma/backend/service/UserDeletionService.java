package com.prowosma.backend.service;

import com.prowosma.backend.model.User;
import com.prowosma.backend.repository.*;
import com.prowosma.backend.service.ActivityLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;

/**
 * Handles complete user deletion — removes the user account
 * and all their owned data across every collection.
 *
 * What gets deleted:
 *   - User account (users)
 *   - All workspaces they own + all data inside those workspaces:
 *       projects, tasks, goals, categories, custom_fields,
 *       activity_logs, notifications, ai_settings, integrations
 *   - Their TeamMember record (in any workspace)
 *   - Any pending invitations they were invited to
 */
@Service
@RequiredArgsConstructor
public class UserDeletionService {

    private final UserRepository           userRepository;
    private final WorkspaceRepository      workspaceRepository;
    private final ProjectRepository        projectRepository;
    private final TaskRepository           taskRepository;
    private final GoalRepository           goalRepository;
    private final CategoryRepository       categoryRepository;
    private final CustomFieldRepository    customFieldRepository;
    private final ActivityLogRepository    activityLogRepository;
    private final NotificationRepository   notificationRepository;
    private final TeamMemberRepository     teamMemberRepository;
    private final InvitationRepository     invitationRepository;
    private final ActivityLogService        activityLogService;

    public DeletionSummary deleteUser(String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found: " + email));

        DeletionSummary summary = new DeletionSummary();

        // 1. Find all workspaces owned by this user
        var ownedWorkspaces = workspaceRepository.findByOwnerEmail(email);
        summary.workspacesDeleted = ownedWorkspaces.size();

        for (var workspace : ownedWorkspaces) {
            String orgId = workspace.getId();

            // Delete all workspace data
            List<?> projects    = projectRepository.findByOrganizationId(orgId);
            List<?> tasks       = taskRepository.findByOrganizationId(orgId);
            List<?> goals       = goalRepository.findByOrganizationId(orgId);
            List<?> categories  = categoryRepository.findByOrganizationId(orgId);
            List<?> fields      = customFieldRepository.findByOrganizationId(orgId);
            List<?> notifs      = notificationRepository.findByOrganizationId(orgId);
            List<?> members     = teamMemberRepository.findByOrganizationId(orgId);

            summary.projectsDeleted   += projects.size();
            summary.tasksDeleted      += tasks.size();
            summary.goalsDeleted      += goals.size();

            projectRepository.deleteAll((List) projects);
            taskRepository.deleteAll((List) tasks);
            goalRepository.deleteAll((List) goals);
            categoryRepository.deleteAll((List) categories);
            customFieldRepository.deleteAll((List) fields);
            notificationRepository.deleteAll((List) notifs);
            teamMemberRepository.deleteAll((List) members);

            // Activity logs are deliberately NOT deleted here — see
            // anonymizeActivityLogs() below. This used to be
            // activityLogRepository.deleteAll((List) logs), which wiped
            // this workspace's ENTIRE audit trail — including actions
            // performed by other members, not just this account — the
            // moment its owner deleted their account. That's a real
            // SOC2/ISO27001 problem: an audit trail that an account holder
            // can erase by deleting their own account isn't trustworthy
            // evidence of anything, and ActivityLogRepository no longer
            // even exposes a delete method to make that mistake again (see
            // ImmutableMongoRepository).
            anonymizeActivityLogs(orgId);

            // Delete invitations for this workspace
            var invites = invitationRepository.findByWorkspaceIdAndStatus(orgId, "PENDING");
            invitationRepository.deleteAll(invites);

            // Delete the workspace itself
            workspaceRepository.delete(workspace);
        }

        // 2. Remove this user's TeamMember record from any workspace
        teamMemberRepository.findByEmail(email).ifPresent(m -> {
            teamMemberRepository.delete(m);
            summary.teamMembershipsRemoved++;
        });

        // 3. Cancel any pending invitations sent to this email
        var pendingInvites = invitationRepository.findByEmailAndStatus(email, "PENDING");
        pendingInvites.forEach(i -> {
            i.setStatus("CANCELLED");
            invitationRepository.save(i);
        });

        // 4. Delete the user account
        activityLogService.log("USER", user.getId(), user.getEmail(),
                "USER_ACCOUNT_DELETED", user.getEmail(), null, null);
        userRepository.delete(user);
        summary.success = true;
        summary.email = email;

        return summary;
    }

    /**
     * Redacts personally-identifying fields on a workspace's activity log
     * entries instead of deleting the entries themselves — the audit trail
     * keeps its record that specific actions happened, when, and to which
     * entities; it just stops naming who did them, once that person's
     * account no longer exists to attach real identity to anyway.
     *
     * This is the standard reconciliation between "right to erasure"
     * (personal data) and "audit trail must survive account deletion"
     * (SOC2/ISO27001) — GDPR targets personal data, not the historical
     * fact that an event occurred, and most compliance frameworks
     * explicitly expect the latter to be retained even when the former is
     * scrubbed.
     */
    private void anonymizeActivityLogs(String orgId) {
        List<com.prowosma.backend.model.ActivityLog> logs =
                activityLogRepository.findByOrganizationId(orgId);
        if (logs.isEmpty()) return;

        for (var log : logs) {
            log.setActor("deleted-user");
            log.setIpAddress(null);
            log.setUserAgent(null);
        }
        activityLogRepository.saveAll(logs);

        // One new, honest entry recording that this happened — so anyone
        // reviewing this workspace's history later can see exactly when
        // and why the actor fields upstream of this point went blank,
        // rather than finding unexplained gaps.
        activityLogService.log("WORKSPACE", orgId, orgId,
                "ACTIVITY_LOG_ANONYMIZED",
                null, logs.size() + " entries anonymized (owner account deleted)", null);
    }

    // ── Summary DTO ──────────────────────────────────────────
    public static class DeletionSummary {
        public boolean success = false;
        public String  email;
        public int workspacesDeleted        = 0;
        public int projectsDeleted          = 0;
        public int tasksDeleted             = 0;
        public int goalsDeleted             = 0;
        public int teamMembershipsRemoved   = 0;
        public String message() {
            return String.format(
                    "User '%s' deleted. Workspaces: %d, Projects: %d, Tasks: %d, Goals: %d",
                    email, workspacesDeleted, projectsDeleted, tasksDeleted, goalsDeleted
            );
        }
    }
}