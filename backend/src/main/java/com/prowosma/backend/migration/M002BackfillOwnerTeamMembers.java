package com.prowosma.backend.migration;

import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.User;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.UserRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

/**
 * WorkspaceService.create() now gives a workspace's owner an explicit
 * TeamMember record (role="OWNER") at creation time — see its own comment
 * for why: before that, the owner's access was purely inferred from
 * Workspace.ownerEmail in RoleGuardFilter, so the owner never showed up in
 * their own Team > Members list and nothing in the UI could say "you are
 * the Owner".
 *
 * That fix only runs for workspaces created AFTER it was written, though —
 * every workspace created before then still has no owner TeamMember row,
 * which is exactly the "Members (0) / No team members yet" a real owner
 * sees on their own long-since-created workspace. This migration is the
 * one-time backfill for those pre-existing workspaces, using the identical
 * logic (same role, same color derivation, same name lookup) so a
 * backfilled owner is indistinguishable from one created the normal way.
 *
 * Idempotent: only inserts where no matching TeamMember already exists,
 * so re-running (which shouldn't happen — see MigrationRunner's own
 * completed-migration tracking — but is worth being safe against anyway)
 * is a no-op the second time.
 */
@Component
@RequiredArgsConstructor
public class M002BackfillOwnerTeamMembers implements Migration {

    private final WorkspaceRepository workspaceRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;

    @Override
    public String id() {
        return "2026-09-13-002-backfill-owner-team-members";
    }

    @Override
    public String description() {
        return "Creates a TeamMember(role=OWNER) record for every workspace's owner that doesn't already have one";
    }

    @Override
    public void migrate(MongoTemplate template) {
        int created = 0;
        for (Workspace workspace : workspaceRepository.findAll()) {
            String ownerEmail = workspace.getOwnerEmail();
            String orgId = workspace.getId();
            if (ownerEmail == null || ownerEmail.isBlank() || orgId == null) continue;

            if (teamMemberRepository.existsByEmailAndOrganizationId(ownerEmail, orgId)) continue;

            TeamMember owner = new TeamMember();
            owner.setOrganizationId(orgId);
            owner.setEmail(ownerEmail);
            owner.setName(
                    userRepository.findByEmail(ownerEmail).map(User::getName).orElse(ownerEmail)
            );
            owner.setRole("OWNER");
            owner.setColor("#" + String.format("%06x", (ownerEmail.hashCode() & 0xffffff) | 0x400000));
            teamMemberRepository.save(owner);
            created++;
        }
        org.slf4j.LoggerFactory.getLogger(getClass())
                .info("[M002BackfillOwnerTeamMembers] Created {} missing owner TeamMember record(s)", created);
    }
}
