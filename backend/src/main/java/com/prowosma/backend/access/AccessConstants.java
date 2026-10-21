package com.prowosma.backend.access;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Vocabulary of the department / project access model. Nothing here is specific to any one
 * company: scopes, visibilities and capabilities are fixed building blocks, while departments,
 * profiles and project role slots are plain data an admin defines per workspace.
 *
 * Pure Java on purpose (no Spring, no Mongo) so the rules can be unit-tested in isolation.
 */
public final class AccessConstants {
    private AccessConstants() {}

    // ── What a person with a given access profile may SEE ───────────────────────
    /** Everything in the workspace (the workspace owner, and legacy members with no profile). */
    public static final String MODE_ALL = "ALL";
    /** Their own departments' projects, projects they are named on, and work assigned to them. */
    public static final String MODE_DEPARTMENTS = "MY_DEPARTMENTS";
    /** Only work assigned to them (assignee / watcher / creator), and the projects that work sits in. */
    public static final String MODE_ASSIGNED = "ASSIGNED_ONLY";
    public static final List<String> ALL_MODES = List.of(MODE_ALL, MODE_DEPARTMENTS, MODE_ASSIGNED);

    // ── Who a PROJECT is visible to ─────────────────────────────────────────────
    /** Anyone whose scope reaches workspace-visible projects (legacy default). */
    public static final String VIS_WORKSPACE = "WORKSPACE";
    /** Members of the project's departments, plus people named on the project. */
    public static final String VIS_DEPARTMENTS = "DEPARTMENTS";
    /** Only people named on the project (members, role-slot holders, approvers, creator). */
    public static final String VIS_MEMBERS = "MEMBERS_ONLY";
    public static final List<String> ALL_VISIBILITIES = List.of(VIS_WORKSPACE, VIS_DEPARTMENTS, VIS_MEMBERS);

    // ── Capabilities a profile can grant (checked only for restricted profiles) ──
    public static final String CAP_CREATE_PROJECT = "CREATE_PROJECT";
    public static final String CAP_CREATE_TASK = "CREATE_TASK";
    public static final String CAP_ALLOCATE_TASKS = "ALLOCATE_TASKS";
    public static final String CAP_APPROVE = "APPROVE";
    public static final String CAP_VIEW_FINANCIALS = "VIEW_FINANCIALS";
    public static final String CAP_USE_MEETING_ASSISTANT = "USE_MEETING_ASSISTANT";
    public static final List<String> ALL_CAPABILITIES = List.of(
            CAP_CREATE_PROJECT, CAP_CREATE_TASK, CAP_ALLOCATE_TASKS,
            CAP_APPROVE, CAP_VIEW_FINANCIALS, CAP_USE_MEETING_ASSISTANT);

    /** Group kinds. Only DEPARTMENT groups take part in access decisions. */
    public static final String GROUP_DEPARTMENT = "DEPARTMENT";
    public static final String GROUP_TEAM = "TEAM";

    public static String norm(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    public static String normalizeMode(String mode) {
        if (mode == null) return null;
        String m = mode.trim().toUpperCase(Locale.ROOT);
        return ALL_MODES.contains(m) ? m : null;
    }

    /** A null / blank visibility means "legacy": workspace-wide. An unknown value is rejected (null result with isKnown=false). */
    public static String normalizeVisibility(String v) {
        if (v == null || v.isBlank()) return VIS_WORKSPACE;
        String x = v.trim().toUpperCase(Locale.ROOT);
        return ALL_VISIBILITIES.contains(x) ? x : null;
    }

    public static boolean intersects(Set<String> a, Set<String> b) {
        if (a == null || b == null) return false;
        for (String x : a) if (b.contains(x)) return true;
        return false;
    }
}
