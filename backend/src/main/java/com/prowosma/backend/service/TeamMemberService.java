package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class TeamMemberService {

    private final TeamMemberRepository teamMemberRepository;
    private final ActivityLogService   activityLogService;
    private final WorkspaceContext     workspaceContext;
    private final BillingService       billingService;
    private final WorkspaceRepository  workspaceRepository;

    /**
     * Role-escalation guard shared by create()/update() below.
     *
     * Why this exists: previously ANY Admin (or, via the direct "+ Add
     * Member" endpoint, arguably anyone who could reach it) could hand out
     * the ADMIN role to someone else. In practice that meant the set of
     * Admins only ever grew — every invited Admin could invite more
     * Admins — which is exactly the "everyone ends up Admin" behavior
     * reported by early testers. Granting ADMIN (or editing the role of an
     * existing Admin) is now restricted to the workspace OWNER only. A
     * plain Admin can still invite/manage MEMBER and VIEWER.
     */
    private void assertCanAssignRole(String requesterEmail, String orgId,
                                      String targetRole, String previousRole) {
        boolean touchesAdmin = "ADMIN".equals(targetRole) || "ADMIN".equals(previousRole);
        if (!touchesAdmin) return;

        boolean requesterIsOwner = orgId != null && requesterEmail != null &&
                workspaceRepository.findById(orgId)
                        .map(Workspace::getOwnerEmail)
                        .map(ownerEmail -> ownerEmail.equalsIgnoreCase(requesterEmail))
                        .orElse(false);
        if (!requesterIsOwner) {
            throw new RuntimeException(
                    "Only the workspace Manager can grant or change the Admin role. " +
                    "Ask your Manager to make this change, or pick Member/Viewer instead.");
        }
    }

    public List<TeamMember> getAll() {
        return teamMemberRepository.findByOrganizationId(workspaceContext.getWorkspaceId());
    }

    public TeamMember getById(String id) {
        return teamMemberRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Team member not found"));
    }

    public Optional<TeamMember> getByEmail(String email) {
        // Scope to active workspace — avoids returning wrong role when user
        // belongs to multiple workspaces
        String orgId = workspaceContext.getWorkspaceId();
        if (orgId == null) return Optional.empty();   // no workspace => no lookup (was: any workspace's member with that email)
        return teamMemberRepository.findByEmailAndOrganizationId(email, orgId);
    }

    public TeamMember create(TeamMember member) {
        return create(member, null);
    }

    public TeamMember create(TeamMember member, String requesterEmail) {
        String orgId = workspaceContext.getWorkspaceId();
        // Scoped to this workspace, not global - existsByEmail() previously
        // blocked adding someone who already belongs to a DIFFERENT
        // workspace (a false positive), while not actually being the thing
        // that guards against the case that matters: the same person twice
        // in the SAME workspace. That real guard is now the unique index on
        // team_members(organizationId, email) - this check just gives a
        // clean 409 instead of letting the insert hit that index and 500.
        if (teamMemberRepository.existsByEmailAndOrganizationId(member.getEmail(), orgId))
            throw new RuntimeException("Email already exists");
        // Same check InvitationController runs before creating an invite —
        // this endpoint is a second way to add a member and was missing it
        // entirely, letting a workspace exceed its plan's seat limit by
        // using this path instead of the invite flow.
        billingService.assertSeatAvailable(orgId);
        assertCanAssignRole(requesterEmail, orgId, member.getRole(), null);
        member.setOrganizationId(orgId);
        TeamMember saved = teamMemberRepository.save(member);
        activityLogService.logFull("TEAM", saved.getId(), saved.getEmail(),
                "WORKSPACE_JOINED", null, saved.getRole(), null,
                null, null, null);
        return saved;
    }

    public TeamMember update(String id, TeamMember updated) {
        return update(id, updated, null);
    }

    public TeamMember update(String id, TeamMember updated, String requesterEmail) {
        TeamMember existing = getById(id);
        if ("OWNER".equals(existing.getRole())) {
            throw new RuntimeException(
                    "The workspace Manager's role can't be changed here — "
                  + "ownership is tied to who created the workspace.");
        }
        String oldRole = existing.getRole();
        assertCanAssignRole(requesterEmail, existing.getOrganizationId(), updated.getRole(), oldRole);
        existing.setName(updated.getName());
        existing.setEmail(updated.getEmail());
        existing.setRole(updated.getRole());
        existing.setAvatar(updated.getAvatar());
        existing.setColor(updated.getColor());
        TeamMember saved = teamMemberRepository.save(existing);
        // Log role change separately if role changed
        if (!oldRole.equals(saved.getRole())) {
            activityLogService.logFull("TEAM", saved.getId(), saved.getEmail(),
                    "ROLE_CHANGED", oldRole, saved.getRole(), null,
                    null, null, null);
        }
        return saved;
    }

    public void delete(String id) {
        TeamMember member = getById(id);
        if ("OWNER".equals(member.getRole())) {
            throw new RuntimeException(
                    "The workspace Manager can't be removed from the team here — "
                  + "transfer or delete the workspace instead.");
        }
        activityLogService.logFull("TEAM", id, member.getEmail(),
                "USER_REMOVED", member.getRole(), null, null,
                null, null, null);
        teamMemberRepository.deleteById(id);
    }
}
