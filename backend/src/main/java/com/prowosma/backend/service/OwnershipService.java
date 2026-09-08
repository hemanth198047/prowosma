package com.prowosma.backend.service;

import com.prowosma.backend.config.WorkspaceContext;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Checks whether a user has permission to modify or delete a resource.
 * Rules:
 *   - OWNER of the workspace → can do anything
 *   - ADMIN in the workspace → can do anything
 *   - MEMBER → can only edit/delete resources they created
 *   - VIEWER → blocked by RoleGuardFilter before reaching here
 */
@Service
@RequiredArgsConstructor
public class OwnershipService {

    private final WorkspaceRepository workspaceRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final WorkspaceContext workspaceContext;

    /**
     * Returns true if the user can modify/delete the given resource.
     *
     * @param userEmail  JWT email of the current user
     * @param createdBy  Email of whoever created the resource (may be null for old records)
     */
    public boolean canModify(String userEmail, String createdBy) {
        if (userEmail == null) return false;

        // OWNER of the workspace can do anything
        String workspaceId = workspaceContext.getWorkspaceId();
        if (workspaceId != null) {
            workspaceRepository.findById(workspaceId).ifPresent(ws -> {});
            boolean isOwner = workspaceRepository.findById(workspaceId)
                    .map(ws -> userEmail.equals(ws.getOwnerEmail()))
                    .orElse(false);
            if (isOwner) return true;

            // ADMIN in the workspace can do anything
            boolean isAdmin = teamMemberRepository
                    .findByEmailAndOrganizationId(userEmail, workspaceId)
                    .map(m -> "ADMIN".equals(m.getRole()))
                    .orElse(false);
            if (isAdmin) return true;
        }

        // MEMBER: can only modify resources they created
        // If createdBy is null (old records before this feature), allow modification
        if (createdBy == null || createdBy.isBlank()) return true;

        return userEmail.equals(createdBy);
    }
}