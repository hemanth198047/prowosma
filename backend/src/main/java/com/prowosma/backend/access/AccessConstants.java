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
    /** Create, change and delete planning records: goals, sprints, epics, releases, risks, decisions, change requests, programmes, meetings. */
    public static final String CAP_MANAGE_PLANNING = "MANAGE_PLANNING";
    public static final List<String> ALL_CAPABILITIES = List.of(
            CAP_CREATE_PROJECT, CAP_CREATE_TASK, CAP_ALLOCATE_TASKS,
            CAP_APPROVE, CAP_VIEW_FINANCIALS, CAP_USE_MEETING_ASSISTANT, CAP_MANAGE_PLANNING);

    // ── Documents ───────────────────────────────────────────────────────────────
    /** Creator and the people the doc is shared with. */
    public static final String AUD_PRIVATE = "PRIVATE";
    /** Members of the doc's departments (plus creator and anyone it is shared with, where sharing is on). */
    public static final String AUD_DEPARTMENTS = "DEPARTMENTS";
    /** Everyone in the workspace. Only unrestricted people can choose it. */
    public static final String AUD_WORKSPACE = "WORKSPACE";
    public static final List<String> ALL_AUDIENCES = List.of(AUD_PRIVATE, AUD_DEPARTMENTS, AUD_WORKSPACE);

    /** Workspace setting: how documents are shared between people. */
    public static final String DOC_MODE_DEPARTMENTS = "DEPARTMENTS";       // by department only
    public static final String DOC_MODE_PRIVATE_SHARED = "PRIVATE_SHARED"; // creator + people it is shared with only
    public static final String DOC_MODE_BOTH = "BOTH";                      // each doc chooses
    public static final List<String> ALL_DOC_MODES = List.of(DOC_MODE_DEPARTMENTS, DOC_MODE_PRIVATE_SHARED, DOC_MODE_BOTH);

    /** Null / blank means a legacy doc made before access control (no audience): only its creator and people it is shared with see it. Unknown values return null from {@link #isValidAudience}. */
    public static String normalizeAudience(String a) {
        if (a == null || a.isBlank()) return null;
        String x = a.trim().toUpperCase(Locale.ROOT);
        return ALL_AUDIENCES.contains(x) ? x : "?";
    }

    public static boolean isValidAudience(String a) { return a != null && ALL_AUDIENCES.contains(a.trim().toUpperCase(Locale.ROOT)); }

    /** Unknown or missing mode falls back to BOTH (the most flexible, and still fail-closed for anything not explicitly shared). */
    public static String normalizeDocMode(String m) {
        if (m == null) return DOC_MODE_BOTH;
        String x = m.trim().toUpperCase(Locale.ROOT);
        return ALL_DOC_MODES.contains(x) ? x : DOC_MODE_BOTH;
    }

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
