package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.repository.TeamMemberRepository;
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
        if (orgId != null) {
            return teamMemberRepository.findByEmailAndOrganizationId(email, orgId);
        }
        return teamMemberRepository.findByEmail(email);
    }

    public TeamMember create(TeamMember member) {
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
        member.setOrganizationId(orgId);
        TeamMember saved = teamMemberRepository.save(member);
        activityLogService.logFull("TEAM", saved.getId(), saved.getEmail(),
                "WORKSPACE_JOINED", null, saved.getRole(), null,
                null, null, null);
        return saved;
    }

    public TeamMember update(String id, TeamMember updated) {
        TeamMember existing = getById(id);
        if ("OWNER".equals(existing.getRole())) {
            throw new RuntimeException(
                    "The workspace Owner's role can't be changed here — "
                  + "ownership is tied to who created the workspace.");
        }
        String oldRole = existing.getRole();
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
                    "The workspace Owner can't be removed from the team here — "
                  + "transfer or delete the workspace instead.");
        }
        activityLogService.logFull("TEAM", id, member.getEmail(),
                "USER_REMOVED", member.getRole(), null, null,
                null, null, null);
        teamMemberRepository.deleteById(id);
    }
}
