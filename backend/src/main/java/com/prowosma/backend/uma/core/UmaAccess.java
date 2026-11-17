package com.prowosma.backend.uma.core;

import com.prowosma.backend.model.TeamMember;
import com.prowosma.backend.model.Workspace;
import com.prowosma.backend.repository.TeamMemberRepository;
import com.prowosma.backend.repository.WorkspaceRepository;
import com.prowosma.backend.service.VisibilityService;
import com.prowosma.backend.uma.model.UmaMeeting;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Optional;

/**
 * Who may see or change a meeting. The same rule as the existing assistant (kept separate so either can change or retire alone):
 * attending a meeting never grants access — only the person who added it, admins, people it is shared with, or everyone in the
 * workspace when it is made visible to the workspace. Restricted (department / assigned-work) profiles never get blanket access.
 */
@Component
public class UmaAccess {
    private final WorkspaceRepository workspaces;
    private final TeamMemberRepository members;
    private final VisibilityService visibility;

    public UmaAccess(WorkspaceRepository workspaces, TeamMemberRepository members, VisibilityService visibility) {
        this.workspaces = workspaces;
        this.members = members;
        this.visibility = visibility;
    }

    public record Caller(String email, String role, boolean restricted) {
        public boolean admin() { return ("OWNER".equals(role) || "ADMIN".equals(role)) && !restricted; }
        public boolean viewer() { return "VIEWER".equals(role); }
    }

    public Caller caller(String workspaceId, String email) {
        String e = email == null ? null : email.toLowerCase(Locale.ROOT);
        String role;
        Optional<Workspace> ws = workspaces.findById(workspaceId);
        if (e != null && ws.isPresent() && e.equalsIgnoreCase(ws.get().getOwnerEmail())) role = "OWNER";
        else role = members.findAllByEmailAndOrganizationId(email, workspaceId).stream().findFirst().map(TeamMember::getRole).orElse("NONE");
        boolean restricted;
        try { restricted = visibility.isRestricted(); } catch (RuntimeException outsideRequest) { restricted = false; }
        return new Caller(e, role, restricted);
    }

    public boolean canRead(UmaMeeting m, Caller c) {
        if (c.admin()) return true;
        if (c.email() != null && c.email().equalsIgnoreCase(m.getCreatedBy())) return true;
        if (m.getSharedWith() != null && m.getSharedWith().stream().anyMatch(s -> s.equalsIgnoreCase(c.email()))) return true;
        return !c.restricted() && "WORKSPACE".equals(m.getVisibility()) && !"NONE".equals(c.role());
    }

    /** Change content, approve actions, delete, share: the person who added it, or an admin. Viewers never. */
    public boolean canManage(UmaMeeting m, Caller c) {
        if (c.viewer()) return false;
        return c.admin() || (c.email() != null && c.email().equalsIgnoreCase(m.getCreatedBy()));
    }

    public void requireRead(UmaMeeting m, Caller c) { if (m == null || !canRead(m, c)) throw UmaException.notFound(); }

    public void requireManage(UmaMeeting m, Caller c) {
        requireRead(m, c);
        if (!canManage(m, c))
            throw new UmaException(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Only the person who added this meeting, or an admin, can change it.");
    }

    public void requireCanCreate(Caller c) {
        if (c.viewer() || "NONE".equals(c.role()))
            throw new UmaException(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "Viewers can read meetings shared with them but can't add meetings.");
    }
}
