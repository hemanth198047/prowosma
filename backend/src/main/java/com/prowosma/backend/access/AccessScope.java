package com.prowosma.backend.access;

import java.util.HashSet;
import java.util.Set;

import static com.prowosma.backend.access.AccessConstants.*;

/**
 * What one caller may see and do in one workspace. Built once per request by the visibility
 * service; every rule lives here so it can be tested without a database.
 *
 * Fail-closed principles:
 *  - an unrestricted scope is only ever produced for: access control switched off, the workspace
 *    owner, a profile with scope ALL, or a member with no profile when no default profile is set
 *    (legacy behaviour — nothing changes until an admin assigns profiles);
 *  - anything unknown (a project with an unrecognised visibility, a deleted profile) is treated
 *    as the most restrictive option.
 */
public final class AccessScope {

    private static final AccessScope UNRESTRICTED =
            new AccessScope(false, "", null, MODE_ALL, Set.of(), false, Set.of(), "Unrestricted");

    private final boolean enforced;
    private final String email;
    private final String memberId;
    private final String mode;
    private final Set<String> departmentIds;
    private final boolean departmentAdmin;
    private final Set<String> capabilities;
    private final String profileName;

    private AccessScope(boolean enforced, String email, String memberId, String mode, Set<String> departmentIds,
                        boolean departmentAdmin, Set<String> capabilities, String profileName) {
        this.enforced = enforced;
        this.email = norm(email);
        this.memberId = memberId;
        this.mode = mode;
        this.departmentIds = departmentIds;
        this.departmentAdmin = departmentAdmin;
        this.capabilities = capabilities;
        this.profileName = profileName;
    }

    public static AccessScope unrestricted() { return UNRESTRICTED; }

    /** Access control is on and this caller has a profile. A mode of ALL still yields an unrestricted scope. */
    public static AccessScope of(String email, String memberId, String mode, Set<String> departmentIds,
                                 boolean departmentAdmin, Set<String> capabilities, String profileName) {
        String m = normalizeMode(mode);
        if (m == null) m = MODE_ASSIGNED; // unknown mode: most restrictive
        return new AccessScope(true, email, memberId, m,
                departmentIds == null ? Set.of() : Set.copyOf(departmentIds),
                departmentAdmin && MODE_DEPARTMENTS.equals(m),
                capabilities == null ? Set.of() : Set.copyOf(capabilities),
                profileName == null ? "" : profileName);
    }

    // ── identity ────────────────────────────────────────────────────────────────
    public boolean isRestricted() { return enforced && !MODE_ALL.equals(mode); }
    public String email() { return email; }
    public String memberId() { return memberId; }
    public String mode() { return mode; }
    public Set<String> departmentIds() { return departmentIds; }
    public boolean isDepartmentAdmin() { return departmentAdmin; }
    public Set<String> capabilities() { return capabilities; }
    public String profileName() { return profileName; }

    public boolean has(String capability) { return !isRestricted() || capabilities.contains(capability); }

    // ── tasks ───────────────────────────────────────────────────────────────────
    /** Assignee, watcher or creator: an explicit personal link to the task. */
    public boolean isPersonallyLinked(TaskFacts t) {
        if (t == null) return false;
        if (memberId != null && t.assigneeIds().contains(memberId)) return true;
        if (!email.isEmpty() && (t.watcherEmails().contains(email) || email.equals(t.creatorEmail()))) return true;
        return false;
    }

    /** {@code project} may be null for a task with no project, or when the project no longer exists. */
    public boolean canSeeTask(TaskFacts t, ProjectFacts project) {
        if (!isRestricted()) return true;
        if (t == null) return false;
        if (isPersonallyLinked(t)) return true;
        if (project == null || MODE_ASSIGNED.equals(mode)) return false;
        return projectVisibleByRule(project);
    }

    // ── projects ────────────────────────────────────────────────────────────────
    public boolean isInvolved(ProjectFacts p) { return p != null && !email.isEmpty() && p.involvedEmails().contains(email); }

    /**
     * @param hasLinkedTask whether the caller is assigned to / watching / created at least one task in
     *                      the project (the project then has to be shown so that work has a home)
     */
    public boolean canSeeProject(ProjectFacts p, boolean hasLinkedTask) {
        if (!isRestricted()) return true;
        if (p == null) return false;
        if (isInvolved(p) || hasLinkedTask) return true;
        return projectVisibleByRule(p);
    }

    /** Visibility by the project's own settings only (no personal links). Not for ASSIGNED_ONLY. */
    private boolean projectVisibleByRule(ProjectFacts p) {
        if (MODE_ASSIGNED.equals(mode)) return false;
        if (isInvolved(p)) return true;
        return switch (p.visibility()) {
            case VIS_WORKSPACE -> true;
            case VIS_DEPARTMENTS -> intersects(departmentIds, p.departmentIds());
            default -> false; // MEMBERS_ONLY and anything unknown
        };
    }

    /** Change who can see the project, delete it, change its role slots: owner / ALL, its creator, or an admin of one of its departments. */
    public boolean canManageProject(ProjectFacts p) {
        if (!isRestricted()) return true;
        if (p == null) return false;
        if (!email.isEmpty() && email.equals(p.creatorEmail())) return true;
        return departmentAdmin && intersects(departmentIds, p.departmentIds());
    }

    /** Edit the project's ordinary fields (name, status, dates): managers, plus people named on it. */
    public boolean canEditProject(ProjectFacts p) {
        if (!isRestricted()) return true;
        if (MODE_ASSIGNED.equals(mode)) return false;
        return canManageProject(p) || isInvolved(p);
    }

    /** Which visibility a caller may put on a project they create or manage. */
    public boolean mayUseVisibility(String visibility) {
        if (!isRestricted()) return true;
        return !VIS_WORKSPACE.equals(visibility);   // workspace-wide sharing is for unrestricted callers
    }

    /** Departments a restricted caller may attach to a project. */
    public Set<String> attachableDepartments(Set<String> requested) {
        if (!isRestricted()) return requested == null ? Set.of() : requested;
        Set<String> out = new HashSet<>();
        if (requested != null) for (String d : requested) if (departmentIds.contains(d)) out.add(d);
        return out;
    }
}
